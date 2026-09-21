// Package signaling implements the signaling HTTP surface: strict routing under
// the configured path prefix, exact-origin CORS, no-store responses, request
// size limits, and stable JSON error codes.
//
// Phase 1 serves liveness (GET /healthz) and operator info (GET /v1/info).
// Auth, rooms, and the WebSocket signaling socket land in Phase 2; rooms,
// sessions, tickets, and signaling state stay in memory (no server database).
package signaling

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/dunsparce9/izci/izci-server/internal/config"
	appProtocol "github.com/dunsparce9/izci/izci-server/internal/protocol"
	"github.com/dunsparce9/izci/izci-server/internal/version"
)

const (
	// SignalingVersion is the server socket protocol version, separate from
	// the izci app (RTC/data-channel) protocol below.
	SignalingVersion = 1

	// AppProtocolMajor/Minor must match MULTIPLAYER_PROTOCOL_MAJOR/MINOR in
	// src/lib/services/multiplayer-protocol.ts. Major mismatch is
	// incompatible; minor mismatch alone is not an admission failure. See
	// TestInfoMatchesAppProtocol.
	AppProtocolMajor = appProtocol.Major
	AppProtocolMinor = appProtocol.Minor
)

// AppProtocolCapabilities advertises the facilities this server's admission
// understands. Absence means unavailable; unknown entries are ignored.
var AppProtocolCapabilities = append([]string(nil), appProtocol.Capabilities...)

// Stable error codes. Bodies carry only the code (no UI text, no internals).
// The "error" object may also carry "retryAfter" (seconds) for rate-limited.
const (
	CodeBadRequest       = "bad-request"
	CodeNotFound         = "not-found"
	CodeMethodNotAllowed = "method-not-allowed"
	CodeOriginForbidden  = "origin-forbidden"
	CodePayloadTooLarge  = "payload-too-large"

	// Phase 2 signaling/auth codes.
	CodeUnsupportedVersion = "unsupported-version"
	CodeUnauthorized       = "unauthorized"
	CodeRoomUnavailable    = "room-unavailable"
	CodeRoomFull           = "room-full"
	CodeRateLimited        = "rate-limited"
	CodeAttemptExpired     = "attempt-expired"
	CodeHostUnavailable    = "host-unavailable"
	CodeTicketExpired      = "ticket-expired"
	CodeTicketConsumed     = "ticket-consumed"
	CodeServerShuttingDown = "server-shutting-down"
)

// Timeouts applied to the underlying http.Server.
const (
	readHeaderTimeout = 5 * time.Second
	readTimeout       = 10 * time.Second
	writeTimeout      = 10 * time.Second
	idleTimeout       = 2 * time.Minute
)

// Server is the server HTTP server.
type Server struct {
	cfg     *config.Config
	logger  *log.Logger
	mux     *http.ServeMux
	proxies []netip.Prefix
	allowed map[string]struct{}
	closed  atomic.Bool

	// now is the clock for expiry. Tests inject a manual clock via
	// NewWithClock; production uses time.Now.
	now           func() time.Time
	hostKeyDigest [32]byte

	// relaySecret is the shared coturn REST secret (nil when no relay is
	// configured). Only the raw secret lives here; issued usernames and
	// passwords are derived per request and never stored.
	relaySecret []byte
	relayTtl    time.Duration

	mu           sync.Mutex
	sessions     map[string]*hostSession
	rooms        map[string]*room
	connTokens   map[string]*connection
	tickets      map[string]*ticket
	sockets      map[uint64]*socket
	nextSockID   uint64
	shuttingDown bool

	loginLimiter *limiterMap
	joinLimiter  *limiterMap
}

// New builds a Server from validated configuration and the operator host key.
// Only the key digest is retained; the raw key is never stored or logged.
func New(cfg *config.Config, logger *log.Logger, hostKey [32]byte) (*Server, error) {
	return NewWithClock(cfg, logger, hostKey, time.Now)
}

// NewWithClock builds a Server with an injected clock for tests.
func NewWithClock(cfg *config.Config, logger *log.Logger, hostKey [32]byte, now func() time.Time) (*Server, error) {
	if logger == nil {
		logger = log.Default()
	}
	if now == nil {
		now = time.Now
	}
	proxies, err := cfg.TrustedProxyPrefixes()
	if err != nil {
		return nil, err
	}
	var relaySecret []byte
	if strings.TrimSpace(cfg.RelaySecretFile) != "" {
		relaySecret, err = config.LoadRelaySecret(cfg.RelaySecretFile)
		if err != nil {
			return nil, err
		}
	}
	s := &Server{
		cfg:           cfg,
		logger:        logger,
		mux:           http.NewServeMux(),
		proxies:       proxies,
		allowed:       cfg.AllowedOriginSet(),
		now:           now,
		hostKeyDigest: sha256Sum(hostKey[:]),
		relaySecret:   relaySecret,
		relayTtl:      time.Duration(cfg.RelayCredentialTtl),
		sessions:      make(map[string]*hostSession),
		rooms:         make(map[string]*room),
		connTokens:    make(map[string]*connection),
		tickets:       make(map[string]*ticket),
		sockets:       make(map[uint64]*socket),
		loginLimiter:  newLimiterMap(loginRatePerSec, loginBurst, limiterMaxEntries, limiterIdleTTL),
		joinLimiter:   newLimiterMap(joinRatePerSec, joinBurst, limiterMaxEntries, limiterIdleTTL),
	}
	p := cfg.PathPrefix
	s.mux.HandleFunc(p+"/healthz", s.handleHealth)
	s.mux.HandleFunc(p+"/v1/info", s.handleInfo)
	s.registerSignalingRoutes()
	// JSON 404 for everything else (ServeMux's default is plain text).
	s.mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, CodeNotFound)
	})
	if p != "" {
		// Convenience alias so load balancers and container health
		// checks can probe a fixed path without knowing the prefix.
		// The versioned API stays strictly beneath the prefix.
		s.mux.HandleFunc("/healthz", s.handleHealth)
	}
	return s, nil
}

// Handler returns the full middleware chain. Exported for tests.
func (s *Server) Handler() http.Handler {
	var h http.Handler = s.mux
	h = s.withSecurityHeaders(h)
	h = s.withBodyLimit(h)
	h = s.withCORS(h)
	h = s.withLogging(h)
	h = s.withRecovery(h)
	return h
}

// ListenAndServe runs until ctx is cancelled or a fatal error occurs, then
// shuts down gracefully within the configured shutdown grace period.
func (s *Server) ListenAndServe(ctx context.Context) error {
	ln, err := net.Listen("tcp", s.cfg.Listen)
	if err != nil {
		return err
	}
	return s.Serve(ctx, ln)
}

// Serve runs on an existing listener (ephemeral ports in tests) with the same
// graceful-shutdown behavior as ListenAndServe.
func (s *Server) Serve(ctx context.Context, ln net.Listener) error {
	srv := &http.Server{
		Handler:           s.Handler(),
		ReadHeaderTimeout: readHeaderTimeout,
		ReadTimeout:       readTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
	}
	cleanupDone := make(chan struct{})
	go s.cleanupLoop(cleanupDone)
	errCh := make(chan error, 1)
	go func() {
		s.logger.Printf("izci-server listening on %s prefix=%q", ln.Addr(), s.cfg.PathPrefix)
		if err := srv.Serve(ln); err != nil && err != http.ErrServerClosed {
			errCh <- err
		} else {
			errCh <- nil
		}
	}()
	select {
	case <-ctx.Done():
	case err := <-errCh:
		close(cleanupDone)
		return err
	}
	grace := time.Duration(s.cfg.Limits.ShutdownGrace)
	shutCtx, cancel := context.WithTimeout(context.Background(), grace)
	defer cancel()
	s.closed.Store(true)
	s.markShuttingDown()
	s.logger.Printf("izci-server shutting down")
	if err := srv.Shutdown(shutCtx); err != nil {
		close(cleanupDone)
		return err
	}
	err := <-errCh
	close(cleanupDone)
	return err
}

// cleanupLoop expires sessions, rooms, attempts, tickets, and idle limiter
// buckets on the configured cleanup interval until done is closed.
func (s *Server) cleanupLoop(done <-chan struct{}) {
	interval := time.Duration(s.cfg.Limits.CleanupInterval)
	if interval <= 0 {
		interval = 5 * time.Second
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-done:
			return
		case <-t.C:
			s.Cleanup()
		}
	}
}

// withSecurityHeaders applies no-store caching to every response.
func (s *Server) withSecurityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// withCORS enforces exact-origin access for browser requests. Requests
// without an Origin header (curl, health checks, server-to-server) pass
// through. A breadth-first preflight handler answers OPTIONS; anything with
// a forbidden Origin is rejected before routing.
func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "" {
			next.ServeHTTP(w, r)
			return
		}
		if _, ok := s.allowed[origin]; !ok {
			writeError(w, http.StatusForbidden, CodeOriginForbidden)
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Vary", "Origin")
		if r.Method == http.MethodOptions {
			if !s.knownPath(r.URL.Path) {
				writeError(w, http.StatusNotFound, CodeNotFound)
				return
			}
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) knownPath(p string) bool {
	prefix := s.cfg.PathPrefix
	if p == prefix+"/healthz" || p == prefix+"/v1/info" {
		return true
	}
	for _, suffix := range []string{
		"/v1/host/sessions",
		"/v1/host/session",
		"/v1/rooms",
		"/v1/rooms/",
		"/v1/join",
		"/v1/socket-tickets",
		"/v1/socket",
		"/v1/ice",
	} {
		if p == prefix+suffix {
			return true
		}
	}
	if strings.HasPrefix(p, prefix+"/v1/rooms/") {
		return true
	}
	return prefix != "" && p == "/healthz"
}

// withBodyLimit caps request bodies at the configured JSON message size.
// Known Content-Length overruns are rejected up front; anything else is
// wrapped (or buffered for unknown lengths) so handlers can never read past
// the limit. Phase 2 POST handlers reuse r.Body as-is.
func (s *Server) withBodyLimit(next http.Handler) http.Handler {
	limit := int64(s.cfg.Limits.MaxJSONMessageBytes)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Body == nil {
			next.ServeHTTP(w, r)
			return
		}
		if r.ContentLength > limit {
			writeError(w, http.StatusRequestEntityTooLarge, CodePayloadTooLarge)
			return
		}
		if r.ContentLength < 0 {
			// Unknown (chunked) length: buffer up to limit+1 now so the
			// cap holds even for handlers that never read the body.
			buf, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
			_ = r.Body.Close()
			if err != nil {
				writeError(w, http.StatusBadRequest, CodeBadRequest)
				return
			}
			if int64(len(buf)) > limit {
				writeError(w, http.StatusRequestEntityTooLarge, CodePayloadTooLarge)
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(buf))
			r.ContentLength = int64(len(buf))
		} else {
			r.Body = http.MaxBytesReader(w, r.Body, limit)
		}
		next.ServeHTTP(w, r)
	})
}

// scrubPath redacts room IDs from logged paths. Room IDs ride in URLs
// (resume/renew/rotate/delete) and must not land in logs alongside secrets.
func scrubPath(p string) string {
	var out []string
	seg := strings.Split(p, "/")
	for i, s := range seg {
		if i > 0 && seg[i-1] == "rooms" && s != "" {
			out = append(out, "{room}")
			continue
		}
		out = append(out, s)
	}
	return strings.Join(out, "/")
}

// withLogging records one line per request: method, scrubbed path, status,
// duration, and client IP. It never logs headers (Authorization), bodies, or
// secrets.
func (s *Server) withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		s.logger.Printf("%s %s %d %s %s", r.Method, scrubPath(r.URL.Path), rec.status,
			time.Since(start).Round(time.Millisecond), s.clientIP(r))
	})
}

func (s *Server) withRecovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				s.logger.Printf("izci-server panic: %v", v)
				writeError(w, http.StatusInternalServerError, CodeBadRequest)
			}
		}()
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

var errNoHijack = errors.New("signaling: response writer does not support hijacking")

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

// Hijack passes websocket upgrades through the logging wrapper; without it
// Accept would fail because the wrapped writer is not a Hijacker.
func (r *statusRecorder) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := r.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errNoHijack
	}
	return hj.Hijack()
}

// clientIP returns the direct peer address, or the leftmost X-Forwarded-For
// entry when the peer is a configured trusted proxy.
func (s *Server) clientIP(r *http.Request) string {
	peer := r.RemoteAddr
	host, _, err := net.SplitHostPort(peer)
	if err != nil {
		host = peer
	}
	peerAddr, err := netip.ParseAddr(host)
	if err != nil {
		return host
	}
	if !s.fromTrustedProxy(peerAddr) {
		return peerAddr.String()
	}
	for _, part := range strings.Split(r.Header.Get("X-Forwarded-For"), ",") {
		if fwd, err := netip.ParseAddr(strings.TrimSpace(part)); err == nil {
			return fwd.String()
		}
	}
	return peerAddr.String()
}

func (s *Server) fromTrustedProxy(addr netip.Addr) bool {
	for _, p := range s.proxies {
		if p.Contains(addr) {
			return true
		}
	}
	return false
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET, OPTIONS")
		writeError(w, http.StatusMethodNotAllowed, CodeMethodNotAllowed)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "version": version.Version})
}

type infoLimits struct {
	MaxRooms                  int `json:"maxRooms"`
	MaxPeersPerRoom           int `json:"maxPeersPerRoom"`
	MaxPendingAttemptsPerRoom int `json:"maxPendingAttemptsPerRoom"`
}

type infoResponse struct {
	SignalingVersion int        `json:"signalingVersion"`
	AppMajor         int        `json:"appProtocolMajor"`
	AppMinor         int        `json:"appProtocolMinor"`
	AppCapabilities  []string   `json:"appCapabilities"`
	Description      string     `json:"description"`
	Contact          string     `json:"contact"`
	IceURLs          []string   `json:"iceUrls"`
	Limits           infoLimits `json:"limits"`
}

func (s *Server) handleInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET, OPTIONS")
		writeError(w, http.StatusMethodNotAllowed, CodeMethodNotAllowed)
		return
	}
	ice := s.cfg.IceURLs
	if ice == nil {
		ice = []string{}
	}
	writeJSON(w, http.StatusOK, infoResponse{
		SignalingVersion: SignalingVersion,
		AppMajor:         AppProtocolMajor,
		AppMinor:         AppProtocolMinor,
		AppCapabilities:  append([]string(nil), AppProtocolCapabilities...),
		Description:      s.cfg.Description,
		Contact:          s.cfg.Contact,
		IceURLs:          ice,
		Limits: infoLimits{
			MaxRooms:                  s.cfg.Limits.MaxRooms,
			MaxPeersPerRoom:           s.cfg.Limits.MaxPeersPerRoom,
			MaxPendingAttemptsPerRoom: s.cfg.Limits.MaxPendingAttemptsPerRoom,
		},
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeAPIError(w, status, code, 0, false)
}

// writeAPIError renders {"error":{"code":...}} plus an optional retryAfter
// for rate-limited responses.
func writeAPIError(w http.ResponseWriter, status int, code string, retryAfter int, hasRetry bool) {
	w.Header().Set("Content-Type", "application/json")
	if hasRetry {
		w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error": map[string]any{"code": code, "retryAfter": retryAfter},
		})
		return
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]string{"code": code}})
}
