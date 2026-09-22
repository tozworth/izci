package media

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

// Bounded render coordinator. Concurrent requests for one cache key share a
// single in-flight render; encoder subprocesses are capped; queued work is
// served FIFO with the shared session ahead of Freeplay (a Freeplay peer
// must never starve the shared session); abandoned work — every waiter
// gone before start, or gone while running — is dropped or cancelled so
// seek thrash and disconnects cannot pile up encoders.

// DefaultMaxEncoders caps concurrent encoder subprocesses when unconfigured.
const DefaultMaxEncoders = 2

// Lane distinguishes shared-session renders (priority) from Freeplay.
type Lane int

const (
	LaneShared Lane = iota
	LaneFreeplay
)

type renderCall struct {
	key       RenderKey
	req       RenderRequest
	waiters   int
	started   bool
	cancel    context.CancelFunc
	done      chan struct{}
	manifest  Manifest
	renderKey RenderKey
	err       error
	queuedAt  time.Time
}

// Coordinator owns the render queue and encoder slots. There is exactly
// one per server process; sessions never encode directly.
type Coordinator struct {
	mu             sync.Mutex
	cache          *Cache
	ffmpeg         FFmpegSettings
	deps           Dependencies
	sem            chan struct{}
	sharedQ        []*renderCall
	freeQ          []*renderCall
	inflight       map[string]*renderCall
	activeJobs     int
	maxObserved    int
	closed         bool
	cacheHits      atomic.Uint64
	rendered       atomic.Uint64
	failures       atomic.Uint64
	queueWaitNanos atomic.Uint64
}

// NewCoordinator builds a coordinator over an open cache. maxEncoders <= 0
// selects DefaultMaxEncoders.
func NewCoordinator(cache *Cache, ffmpeg FFmpegSettings, deps Dependencies, maxEncoders int) *Coordinator {
	if maxEncoders <= 0 {
		maxEncoders = DefaultMaxEncoders
	}
	return &Coordinator{
		cache:    cache,
		ffmpeg:   ffmpeg,
		deps:     deps,
		sem:      make(chan struct{}, maxEncoders),
		inflight: map[string]*renderCall{},
	}
}

// AcquireResult is one shared render: the cache key (to pin) plus the
// stored manifest (generation unbound).
type AcquireResult struct {
	Key      RenderKey
	Manifest Manifest
}

// Acquire returns the rendition for req, rendering it if needed. Callers in
// the shared session pass LaneShared; Freeplay passes LaneFreeplay.
// Concurrent callers for one key share the completed or in-flight render;
// each pins the cache entry independently after Acquire returns.
func (c *Coordinator) Acquire(ctx context.Context, lane Lane, req RenderRequest) (AcquireResult, error) {
	c.mu.Lock()
	closed := c.closed
	c.mu.Unlock()
	if closed {
		return AcquireResult{}, context.Canceled
	}
	key, err := c.keyFor(req)
	if err != nil {
		return AcquireResult{}, err
	}
	// Fast path: completed entry, no queueing.
	if _, ok := c.cache.Lookup(key); ok {
		stored, err := c.cache.StoredManifest(key.String())
		if err == nil {
			c.cacheHits.Add(1)
			return bindAcquireResult(AcquireResult{Key: key, Manifest: stored}, req), nil
		}
	}
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return AcquireResult{}, context.Canceled
	}
	if call, ok := c.inflight[key.String()]; ok {
		call.waiters++
		c.mu.Unlock()
		res, err := c.wait(ctx, call)
		return bindAcquireResult(res, req), err
	}
	call := &renderCall{key: key, req: req, waiters: 1, done: make(chan struct{}), queuedAt: time.Now()}
	c.inflight[key.String()] = call
	if lane == LaneShared {
		c.sharedQ = append(c.sharedQ, call)
	} else {
		c.freeQ = append(c.freeQ, call)
	}
	c.pumpLocked()
	c.mu.Unlock()
	res, err := c.wait(ctx, call)
	return bindAcquireResult(res, req), err
}

// Close rejects new work, cancels every active encoder, and releases queued
// waiters. It is idempotent and is used during bounded graceful shutdown.
func (c *Coordinator) Close() {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return
	}
	c.closed = true
	for _, call := range c.inflight {
		if call.cancel != nil {
			call.cancel()
		}
		if !call.started {
			call.err = context.Canceled
			close(call.done)
		}
	}
	c.sharedQ, c.freeQ = nil, nil
	c.mu.Unlock()
}

func bindAcquireResult(res AcquireResult, req RenderRequest) AcquireResult {
	// Track identity is delivery metadata, not byte identity. Two catalog
	// items may legitimately share a source revision/cache entry, so never
	// leak the first request's track ID through a cache hit or dedup waiter.
	res.Manifest.TrackID = req.TrackID
	res.Manifest.SourceRevision = req.SourceRevision
	return res
}

// keyFor resolves the cache key without rendering. Unknown kinds and
// unavailable decoders fail here so waiters never queue on them.
func (c *Coordinator) keyFor(req RenderRequest) (RenderKey, error) {
	if c.cache == nil {
		return RenderKey{}, &ErrInvalidRenderRequest{}
	}
	if req.TrackID == "" || req.SourceRevision == "" || req.AbsPath == "" {
		return RenderKey{}, &ErrInvalidRenderRequest{}
	}
	family, err := DecoderFor(req.Kind, req.Extension)
	if err != nil {
		return RenderKey{}, err
	}
	version := decoderVersion(c.deps, family)
	if version == "" {
		return RenderKey{}, &ErrDecoderUnavailable{Decoder: family}
	}
	bitrate := normalizeRenderBitrate(req.BitrateKbps)
	return RenderKey{
		SourceRevision: req.SourceRevision,
		Subsong:        req.Subsong,
		DecoderFamily:  family,
		DecoderVersion: version,
		BitrateKbps:    bitrate,
	}, nil
}

// ErrInvalidRenderRequest is deliberately path-free so callers can log it
// without exposing the server's library layout.
type ErrInvalidRenderRequest struct{}

func (*ErrInvalidRenderRequest) Error() string { return "media: incomplete render request" }

// wait blocks until the call completes, abandoning the queue slot when ctx
// ends first. A waiter that leaves a queued, otherwise-unshared call
// removes it; a waiter that leaves a running unshared call cancels it and
// detaches it from the dedup table so a fresh waiter starts clean work.
func (c *Coordinator) wait(ctx context.Context, call *renderCall) (AcquireResult, error) {
	select {
	case <-call.done:
		if call.err != nil {
			return AcquireResult{}, call.err
		}
		return AcquireResult{Key: call.renderKey, Manifest: call.manifest}, nil
	default:
	}
	select {
	case <-ctx.Done():
		c.mu.Lock()
		call.waiters--
		if call.waiters <= 0 {
			if !call.started {
				c.removeQueuedLocked(call)
			} else if call.cancel != nil {
				call.cancel()
			}
			if c.inflight[call.key.String()] == call {
				delete(c.inflight, call.key.String())
			}
		}
		c.mu.Unlock()
		// A result that landed concurrently still counts.
		select {
		case <-call.done:
			if call.err != nil {
				return AcquireResult{}, call.err
			}
			return AcquireResult{Key: call.renderKey, Manifest: call.manifest}, nil
		default:
			return AcquireResult{}, ctx.Err()
		}
	case <-call.done:
		if call.err != nil {
			return AcquireResult{}, call.err
		}
		return AcquireResult{Key: call.renderKey, Manifest: call.manifest}, nil
	}
}

// removeQueuedLocked drops a queued call. Callers hold mu.
func (c *Coordinator) removeQueuedLocked(call *renderCall) {
	for _, q := range []*[]*renderCall{&c.sharedQ, &c.freeQ} {
		for i, queued := range *q {
			if queued == call {
				*q = append((*q)[:i], (*q)[i+1:]...)
				return
			}
		}
	}
}

// pumpLocked starts queued jobs while encoder slots are free. The shared
// lane always drains first. Callers hold mu.
func (c *Coordinator) pumpLocked() {
	for {
		select {
		case c.sem <- struct{}{}:
		default:
			return
		}
		var call *renderCall
		if len(c.sharedQ) > 0 {
			call = c.sharedQ[0]
			c.sharedQ = c.sharedQ[1:]
		} else if len(c.freeQ) > 0 {
			call = c.freeQ[0]
			c.freeQ = c.freeQ[1:]
		} else {
			<-c.sem
			return
		}
		if call.waiters <= 0 {
			// Abandoned while queued: drop it and free the slot.
			if c.inflight[call.key.String()] == call {
				delete(c.inflight, call.key.String())
			}
			<-c.sem
			continue
		}
		call.started = true
		c.queueWaitNanos.Add(uint64(time.Since(call.queuedAt)))
		ctx, cancel := context.WithCancel(context.Background())
		call.cancel = cancel
		c.activeJobs++
		if c.activeJobs > c.maxObserved {
			c.maxObserved = c.activeJobs
		}
		go c.run(ctx, call)
	}
}

// run executes one render, publishes waiting callers, and frees its slot.
func (c *Coordinator) run(ctx context.Context, call *renderCall) {
	manifest, key, err := RenderTrack(ctx, c.ffmpeg, c.deps, c.cache, call.req)
	c.mu.Lock()
	call.manifest = manifest
	call.renderKey = key
	call.err = err
	if err != nil {
		c.failures.Add(1)
	} else {
		c.rendered.Add(1)
	}
	// An abandoned running call is detached so a later request can start
	// fresh work for the same key. Do not let the old completion delete
	// that newer call from the dedup table.
	if c.inflight[call.key.String()] == call {
		delete(c.inflight, call.key.String())
	}
	close(call.done)
	c.activeJobs--
	c.mu.Unlock()
	<-c.sem
	c.mu.Lock()
	c.pumpLocked()
	c.mu.Unlock()
}

type CoordinatorStats struct{ CacheHits, Rendered, Failures, QueueWaitNanos uint64 }

func (c *Coordinator) Stats() CoordinatorStats {
	return CoordinatorStats{CacheHits: c.cacheHits.Load(), Rendered: c.rendered.Load(), Failures: c.failures.Load(), QueueWaitNanos: c.queueWaitNanos.Load()}
}

// MaxObservedConcurrency reports the peak simultaneous renders (tests).
func (c *Coordinator) MaxObservedConcurrency() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.maxObserved
}

// QueuedJobs reports queued (not yet started) jobs per lane (tests).
func (c *Coordinator) QueuedJobs() (shared, freeplay int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.sharedQ), len(c.freeQ)
}
