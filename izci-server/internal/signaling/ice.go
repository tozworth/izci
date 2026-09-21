package signaling

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"net/http"
	"strings"
	"time"
)

// Authenticated ICE configuration: POST /v1/ice hands the server's ICE
// setup to admitted peers so browsers need no local STUN/TURN settings.
// Hosts authenticate with their bearer (roomId required, ownership
// checked); guests authenticate with their own connection token.
//
// The response mirrors the configured iceUrls: stun:/stuns: URLs are
// returned bare, while turn:/turns: URLs carry standard coturn REST
// shared-secret credentials (username "expiry:opaque", password
// base64(HMAC-SHA1(secret, username))) with a 10-minute default expiry
// when a relay secret is configured. Without a relay secret, TURN URLs are
// still advertised but bare. With no iceUrls at all the server list is
// empty: the default ICE configuration is empty and relay-only clients
// fail with a useful client-side error instead of silent direct attempts.
//
// TURN issuance per connection is capped (maxIcePerConnection); hosts are
// not capped. Usernames carry a random opaque suffix so concurrent
// credentials never collide.

type iceServerEntry struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

type iceResponse struct {
	IceServers []iceServerEntry `json:"iceServers"`
	// ExpiresAt is the TURN credential expiry, present only when TURN
	// credentials were issued. STUN-only and empty configurations omit it;
	// those entries need no refresh.
	ExpiresAt *string `json:"expiresAt,omitempty"`
}

type iceRequest struct {
	RoomID string `json:"roomId,omitempty"`
}

func (s *Server) registerIceRoute() {
	p := s.cfg.PathPrefix
	s.mux.HandleFunc(p+"/v1/ice", s.handleIce)
}

// mintTurnCredential derives one coturn REST username/password pair. The
// username embeds the expiry epoch plus random opaque bytes; only the
// derivation inputs (never issued pairs) could reconstruct it, and issued
// pairs are never stored or logged.
func mintTurnCredential(secret []byte, ttl time.Duration, now time.Time) (username, password string, expiresAt time.Time) {
	var opaque [9]byte
	_, _ = rand.Read(opaque[:])
	expiresAt = now.Add(ttl)
	username = strings.Join([]string{
		strings.TrimSpace(timeToEpoch(expiresAt)),
		base64.RawURLEncoding.EncodeToString(opaque[:]),
	}, ":")
	mac := hmac.New(sha1.New, secret)
	_, _ = mac.Write([]byte(username))
	password = base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return username, password, expiresAt
}

func timeToEpoch(t time.Time) string {
	return itoa(t.Unix())
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func isTurnURL(raw string) bool {
	lower := strings.ToLower(raw)
	return strings.HasPrefix(lower, "turn:") || strings.HasPrefix(lower, "turns:")
}

// buildIceServers renders the configured URLs into RTC iceServers entries,
// issuing one TURN credential pair shared across every TURN URL when a
// relay secret is configured.
func (s *Server) buildIceServers(now time.Time) ([]iceServerEntry, *string) {
	urls := s.cfg.IceURLs
	if len(urls) == 0 {
		return []iceServerEntry{}, nil
	}
	var stun, turn []string
	for _, u := range urls {
		if isTurnURL(u) {
			turn = append(turn, u)
		} else {
			stun = append(stun, u)
		}
	}
	out := make([]iceServerEntry, 0, 2)
	if len(stun) > 0 {
		out = append(out, iceServerEntry{URLs: append([]string{}, stun...)})
	}
	var expiresAt *string
	if len(turn) > 0 {
		entry := iceServerEntry{URLs: append([]string{}, turn...)}
		if len(s.relaySecret) > 0 {
			username, password, exp := mintTurnCredential(s.relaySecret, s.relayTtl, now)
			entry.Username = username
			entry.Credential = password
			text := timeJSON(exp)
			expiresAt = &text
		}
		out = append(out, entry)
	}
	return out, expiresAt
}

func (s *Server) handleIce(w http.ResponseWriter, r *http.Request) {
	if !methodOnly(w, r, "POST, OPTIONS", http.MethodPost) {
		return
	}
	if s.isShuttingDown() {
		writeError(w, http.StatusServiceUnavailable, CodeServerShuttingDown)
		return
	}
	digest, ok := bearerDigest(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, CodeUnauthorized)
		return
	}
	var req iceRequest
	if r.ContentLength != 0 {
		if err := decodeStrictBody(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, CodeBadRequest)
			return
		}
	}
	if req.RoomID != "" && !validHexID(req.RoomID) {
		writeError(w, http.StatusBadRequest, CodeBadRequest)
		return
	}
	now := s.now()
	s.mu.Lock()
	// Host bearer: roomId required, caller must own the room.
	if s.sessionValidLocked(digest, now) != nil {
		if req.RoomID == "" {
			s.mu.Unlock()
			writeError(w, http.StatusBadRequest, CodeBadRequest)
			return
		}
		rm := s.getRoomLocked(req.RoomID, now)
		if rm == nil {
			s.mu.Unlock()
			writeError(w, http.StatusNotFound, CodeRoomUnavailable)
			return
		}
		if rm.ownerDigest != digest {
			s.mu.Unlock()
			writeError(w, http.StatusUnauthorized, CodeUnauthorized)
			return
		}
		servers, exp := s.buildIceServers(now)
		s.mu.Unlock()
		s.logCode("ice", "ok")
		writeJSON(w, http.StatusOK, iceResponse{IceServers: servers, ExpiresAt: exp})
		return
	}
	// Connection bearer: authorizes only its own connection, capped.
	conn, ok := s.connTokens[digestKey(digest)]
	if !ok {
		s.mu.Unlock()
		writeError(w, http.StatusUnauthorized, CodeUnauthorized)
		return
	}
	if conn.released {
		s.mu.Unlock()
		writeError(w, http.StatusGone, CodeAttemptExpired)
		return
	}
	if req.RoomID != "" && req.RoomID != conn.roomID {
		s.mu.Unlock()
		writeError(w, http.StatusUnauthorized, CodeUnauthorized)
		return
	}
	if s.getRoomLocked(conn.roomID, now) == nil {
		s.mu.Unlock()
		writeError(w, http.StatusNotFound, CodeRoomUnavailable)
		return
	}
	if conn.iceIssued >= s.cfg.MaxIcePerConnection {
		s.mu.Unlock()
		writeAPIError(w, http.StatusTooManyRequests, CodeRateLimited, 60, true)
		return
	}
	conn.iceIssued++
	servers, exp := s.buildIceServers(now)
	s.mu.Unlock()
	s.logCode("ice", "ok")
	writeJSON(w, http.StatusOK, iceResponse{IceServers: servers, ExpiresAt: exp})
}
