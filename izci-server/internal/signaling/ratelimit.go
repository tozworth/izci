package signaling

import (
	"math"
	"time"
)

// Rate limits from the server plan. Login and join are tracked per source
// IP (clientIP, honoring trusted proxies); socket messages use a per-socket
// bucket instead of the shared map.
const (
	loginRatePerSec = 5.0 / 60.0
	loginBurst      = 5.0
	joinRatePerSec  = 30.0 / 60.0
	joinBurst       = 10.0

	socketMsgRatePerSec = 60.0
	socketMsgBurst      = 120.0

	limiterMaxEntries = 4096
	limiterIdleTTL    = 10 * time.Minute
)

// tokenBucket is a classic overflowing bucket: capacity burst, refill rate
// tokens per second.
type tokenBucket struct {
	tokens float64
	last   time.Time
	rate   float64
	burst  float64
}

func newBucket(rate, burst float64, now time.Time) *tokenBucket {
	return &tokenBucket{tokens: burst, last: now, rate: rate, burst: burst}
}

// take removes one token if available. It reports whether the request is
// allowed and, when denied, how many whole seconds to wait before retrying.
func (b *tokenBucket) take(now time.Time) (bool, int) {
	elapsed := now.Sub(b.last).Seconds()
	if elapsed > 0 {
		b.tokens = math.Min(b.burst, b.tokens+elapsed*b.rate)
		b.last = now
	}
	if b.tokens >= 1 {
		b.tokens--
		return true, 0
	}
	deficit := 1 - b.tokens
	wait := int(math.Ceil(deficit / b.rate))
	if wait < 1 {
		wait = 1
	}
	return false, wait
}

// limiterMap holds one bucket per key with idle expiry and a hard cap. When
// the map is full, new keys are rejected (reported as rate-limited) rather
// than evicting live buckets.
type limiterMap struct {
	buckets map[string]*tokenBucket
	max     int
	idleTTL time.Duration
	rate    float64
	burst   float64
}

func newLimiterMap(rate, burst float64, max int, idleTTL time.Duration) *limiterMap {
	return &limiterMap{
		buckets: make(map[string]*tokenBucket),
		max:     max,
		idleTTL: idleTTL,
		rate:    rate,
		burst:   burst,
	}
}

// allow checks the bucket for key. Unknown keys allocate a bucket unless the
// map is full, in which case the request is denied.
func (m *limiterMap) allow(key string, now time.Time) (bool, int) {
	b, ok := m.buckets[key]
	if !ok {
		if len(m.buckets) >= m.max {
			return false, 5
		}
		b = newBucket(m.rate, m.burst, now)
		m.buckets[key] = b
	}
	return b.take(now)
}

// prune removes buckets idle longer than the TTL.
func (m *limiterMap) prune(now time.Time) {
	for k, b := range m.buckets {
		if now.Sub(b.last) > m.idleTTL {
			delete(m.buckets, k)
		}
	}
}
