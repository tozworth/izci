package signaling

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/tozworth/izci/izci-server/internal/config"
)

func testConfig(t *testing.T, prefix string) *config.Config {
	t.Helper()
	doc := `{"publicBaseUrl":"https://server.example.test","hostKeyFile":"test-key"}`
	cfg, err := config.Load([]byte(doc))
	if err != nil {
		t.Fatal(err)
	}
	cfg.PathPrefix = ""
	if prefix != "" {
		cfg.PublicBaseURL = "https://server.example.test" + prefix
		cfg.PathPrefix = prefix
		if err := cfg.Validate(); err != nil {
			t.Fatal(err)
		}
	}
	return cfg
}

func newTestServer(t *testing.T, cfg *config.Config, logOut io.Writer) *Server {
	t.Helper()
	if logOut == nil {
		logOut = io.Discard
	}
	var key [32]byte
	// Deterministic test operator key; login tests use its hex form.
	for i := range key {
		key[i] = byte(i + 1)
	}
	s, err := New(cfg, log.New(logOut, "", 0), key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// testHostKeyHex returns the hex operator key matching newTestServer.
func testHostKeyHex() string {
	var key [32]byte
	for i := range key {
		key[i] = byte(i + 1)
	}
	return hex.EncodeToString(key[:])
}

func decodeBody(t *testing.T, resp *http.Response) map[string]any {
	t.Helper()
	defer resp.Body.Close()
	var v map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	return v
}

func errorCode(t *testing.T, resp *http.Response) string {
	t.Helper()
	v := decodeBody(t, resp)
	errObj, ok := v["error"].(map[string]any)
	if !ok {
		t.Fatalf("missing error object in %v", v)
	}
	code, _ := errObj["code"].(string)
	return code
}

func TestHealth(t *testing.T) {
	s := newTestServer(t, testConfig(t, ""), nil)
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	resp := rec.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	v := decodeBody(t, resp)
	if v["status"] != "ok" {
		t.Errorf("status = %v", v["status"])
	}
	if resp.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("missing no-store header")
	}
}

func TestInfo(t *testing.T) {
	cfg := testConfig(t, "")
	cfg.Description = "Test operator"
	cfg.Contact = "ops@example.test"
	cfg.IceURLs = []string{"stun:stun.example.test:3478"}
	s := newTestServer(t, cfg, nil)

	req := httptest.NewRequest(http.MethodGet, "/v1/info", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	resp := rec.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var v struct {
		SignalingVersion int      `json:"signalingVersion"`
		AppMajor         int      `json:"appProtocolMajor"`
		AppMinor         int      `json:"appProtocolMinor"`
		AppCapabilities  []string `json:"appCapabilities"`
		Description      string   `json:"description"`
		Contact          string   `json:"contact"`
		IceURLs          []string `json:"iceUrls"`
		Limits           struct {
			MaxRooms           int `json:"maxRooms"`
			MaxPeersPerRoom    int `json:"maxPeersPerRoom"`
			MaxPendingAttempts int `json:"maxPendingAttemptsPerRoom"`
		} `json:"limits"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if v.SignalingVersion != SignalingVersion {
		t.Errorf("signalingVersion = %d", v.SignalingVersion)
	}
	if v.AppMajor != AppProtocolMajor {
		t.Errorf("appProtocolMajor = %d", v.AppMajor)
	}
	if v.AppMinor != AppProtocolMinor {
		t.Errorf("appProtocolMinor = %d", v.AppMinor)
	}
	if len(v.AppCapabilities) == 0 {
		t.Errorf("appCapabilities empty")
	}
	if v.Description != "Test operator" || v.Contact != "ops@example.test" {
		t.Errorf("operator = %q / %q", v.Description, v.Contact)
	}
	if len(v.IceURLs) != 1 {
		t.Errorf("iceUrls = %v", v.IceURLs)
	}
	if v.Limits.MaxRooms != 4 || v.Limits.MaxPeersPerRoom != 8 || v.Limits.MaxPendingAttempts != 8 {
		t.Errorf("limits = %+v", v.Limits)
	}
}

// TestInfoMatchesAppProtocol keeps the advertised app protocol in sync with
// the frontend's MULTIPLAYER_PROTOCOL_MAJOR/MINOR.
func TestInfoMatchesAppProtocol(t *testing.T) {
	data, err := os.ReadFile("../../../src/lib/services/multiplayer-protocol.ts")
	if err != nil {
		t.Skipf("frontend protocol source not present: %v", err)
	}
	majorRe := regexp.MustCompile(`MULTIPLAYER_PROTOCOL_MAJOR\s*=\s*(\d+)`)
	minorRe := regexp.MustCompile(`MULTIPLAYER_PROTOCOL_MINOR\s*=\s*(\d+)`)
	majorMatch := majorRe.FindSubmatch(data)
	minorMatch := minorRe.FindSubmatch(data)
	if majorMatch == nil || minorMatch == nil {
		t.Fatalf("protocol major/minor not found in frontend source")
	}
	var wantMajor, wantMinor int
	if err := json.Unmarshal(majorMatch[1], &wantMajor); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(minorMatch[1], &wantMinor); err != nil {
		t.Fatal(err)
	}
	if AppProtocolMajor != wantMajor {
		t.Errorf("AppProtocolMajor = %d, frontend = %d", AppProtocolMajor, wantMajor)
	}
	if AppProtocolMinor != wantMinor {
		t.Errorf("AppProtocolMinor = %d, frontend = %d", AppProtocolMinor, wantMinor)
	}
}

func TestPrefixedRoutes(t *testing.T) {
	s := newTestServer(t, testConfig(t, "/party"), nil)
	h := s.Handler()
	get := func(path string) *http.Response {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Result()
	}
	if resp := get("/party/healthz"); resp.StatusCode != http.StatusOK {
		t.Errorf("/party/healthz = %d", resp.StatusCode)
		resp.Body.Close()
	} else {
		resp.Body.Close()
	}
	if resp := get("/party/v1/info"); resp.StatusCode != http.StatusOK {
		t.Errorf("/party/v1/info = %d", resp.StatusCode)
		resp.Body.Close()
	} else {
		resp.Body.Close()
	}
	if resp := get("/v1/info"); resp.StatusCode != http.StatusNotFound {
		t.Errorf("unprefixed /v1/info = %d, want 404", resp.StatusCode)
		resp.Body.Close()
	} else if code := errorCode(t, resp); code != CodeNotFound {
		t.Errorf("unprefixed /v1/info code = %q", code)
	}
	// Documented liveness alias for probes that do not know the prefix.
	if resp := get("/healthz"); resp.StatusCode != http.StatusOK {
		t.Errorf("root /healthz alias = %d, want 200", resp.StatusCode)
		resp.Body.Close()
	} else {
		resp.Body.Close()
	}
}

func TestMethodsAndNotFound(t *testing.T) {
	s := newTestServer(t, testConfig(t, ""), nil)
	h := s.Handler()
	req := httptest.NewRequest(http.MethodPost, "/healthz", strings.NewReader("hi"))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	resp := rec.Result()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("POST /healthz = %d, want 405", resp.StatusCode)
	}
	if allow := resp.Header.Get("Allow"); !strings.Contains(allow, "GET") {
		t.Errorf("Allow = %q", allow)
	}
	if code := errorCode(t, resp); code != CodeMethodNotAllowed {
		t.Errorf("code = %q", code)
	}
	if resp.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("error response missing no-store")
	}

	req = httptest.NewRequest(http.MethodGet, "/nope", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if resp := rec.Result(); resp.StatusCode != http.StatusNotFound {
		t.Errorf("GET /nope = %d, want 404", resp.StatusCode)
		resp.Body.Close()
	} else if code := errorCode(t, resp); code != CodeNotFound {
		t.Errorf("code = %q", code)
	}
}

func TestCORS(t *testing.T) {
	cfg := testConfig(t, "")
	cfg.AllowedOrigins = []string{"https://app.example.test"}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
	s := newTestServer(t, cfg, nil)
	h := s.Handler()

	// Forbidden origin is rejected before routing.
	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	req.Header.Set("Origin", "https://evil.example.test")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	resp := rec.Result()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("forbidden origin status = %d, want 403", resp.StatusCode)
	}
	if code := errorCode(t, resp); code != CodeOriginForbidden {
		t.Errorf("code = %q", code)
	}
	if resp.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("forbidden origin got ACAO header")
	}

	// Allowed origin passes with an echo and Vary.
	for _, origin := range []string{"https://app.example.test", "https://server.example.test"} {
		req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
		req.Header.Set("Origin", origin)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		resp := rec.Result()
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("origin %s status = %d", origin, resp.StatusCode)
		}
		if got := resp.Header.Get("Access-Control-Allow-Origin"); got != origin {
			t.Errorf("origin %s ACAO = %q", origin, got)
		}
		if vary := resp.Header.Get("Vary"); !strings.Contains(vary, "Origin") {
			t.Errorf("origin %s missing Vary: Origin", origin)
		}
	}

	// Preflight from an allowed origin.
	req = httptest.NewRequest(http.MethodOptions, "/v1/info", nil)
	req.Header.Set("Origin", "https://app.example.test")
	req.Header.Set("Access-Control-Request-Method", "POST")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	resp = rec.Result()
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("preflight status = %d, want 204", resp.StatusCode)
	}
	if allow := resp.Header.Get("Access-Control-Allow-Methods"); !strings.Contains(allow, "POST") {
		t.Errorf("preflight methods = %q", allow)
	}

	// Preflight from a forbidden origin.
	req = httptest.NewRequest(http.MethodOptions, "/v1/info", nil)
	req.Header.Set("Origin", "https://evil.example.test")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if resp := rec.Result(); resp.StatusCode != http.StatusForbidden {
		t.Errorf("forbidden preflight = %d, want 403", resp.StatusCode)
		resp.Body.Close()
	} else {
		resp.Body.Close()
	}

	// Preflight to an unknown path.
	req = httptest.NewRequest(http.MethodOptions, "/nope", nil)
	req.Header.Set("Origin", "https://app.example.test")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if resp := rec.Result(); resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown preflight = %d, want 404", resp.StatusCode)
		resp.Body.Close()
	} else {
		resp.Body.Close()
	}
}

func TestOversizedBody(t *testing.T) {
	s := newTestServer(t, testConfig(t, ""), nil)
	h := s.Handler()
	big := bytes.Repeat([]byte("x"), 64*1024+1)

	// Known length over the limit.
	req := httptest.NewRequest(http.MethodPost, "/healthz", bytes.NewReader(big))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if resp := rec.Result(); resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("oversized status = %d, want 413", resp.StatusCode)
		resp.Body.Close()
	} else if code := errorCode(t, resp); code != CodePayloadTooLarge {
		t.Errorf("code = %q", code)
	}

	// Unknown (chunked) length over the limit.
	req = httptest.NewRequest(http.MethodPost, "/healthz", bytes.NewReader(big))
	req.ContentLength = -1
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if resp := rec.Result(); resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Errorf("chunked oversized status = %d, want 413", resp.StatusCode)
		resp.Body.Close()
	} else {
		resp.Body.Close()
	}

	// Small bodies still reach routing (405, not 413).
	req = httptest.NewRequest(http.MethodPost, "/healthz", strings.NewReader("hi"))
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if resp := rec.Result(); resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("small POST status = %d, want 405", resp.StatusCode)
		resp.Body.Close()
	} else {
		resp.Body.Close()
	}
}

func TestLogsRedactSecrets(t *testing.T) {
	var logs bytes.Buffer
	s := newTestServer(t, testConfig(t, ""), &logs)
	h := s.Handler()

	secretBody := "invitation-secret-abc123-ticket-xyz"
	req := httptest.NewRequest(http.MethodPost, "/healthz", strings.NewReader(secretBody))
	req.Header.Set("Authorization", "Bearer host-session-token-abc123")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	rec.Result().Body.Close()

	out := logs.String()
	if strings.Contains(out, secretBody) {
		t.Errorf("logs contain request body")
	}
	if strings.Contains(out, "host-session-token-abc123") {
		t.Errorf("logs contain Authorization header")
	}
	if !strings.Contains(out, "POST /healthz") {
		t.Errorf("logs missing request line: %q", out)
	}
}

func TestTrustedProxyIP(t *testing.T) {
	mk := func(proxies ...string) (*Server, *bytes.Buffer) {
		cfg := testConfig(t, "")
		cfg.TrustedProxies = proxies
		if err := cfg.Validate(); err != nil {
			t.Fatal(err)
		}
		var buf bytes.Buffer
		return newTestServer(t, cfg, &buf), &buf
	}
	do := func(s *Server, buf *bytes.Buffer) string {
		buf.Reset()
		req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
		req.RemoteAddr = "127.0.0.1:1234"
		req.Header.Set("X-Forwarded-For", "203.0.113.7, 10.0.0.1")
		rec := httptest.NewRecorder()
		s.Handler().ServeHTTP(rec, req)
		rec.Result().Body.Close()
		return buf.String()
	}
	s, buf := mk("127.0.0.0/8")
	if out := do(s, buf); !strings.Contains(out, "203.0.113.7") {
		t.Errorf("trusted proxy should use XFF: %q", out)
	}
	s, buf = mk()
	if out := do(s, buf); strings.Contains(out, "203.0.113.7") || !strings.Contains(out, "127.0.0.1") {
		t.Errorf("untrusted proxy must use peer address: %q", out)
	}
}

func TestServeShutdown(t *testing.T) {
	cfg := testConfig(t, "")
	cfg.Listen = "127.0.0.1:0"
	s := newTestServer(t, cfg, nil)
	ln, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- s.Serve(ctx, ln) }()
	base := "http://" + ln.Addr().String()

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(base + "/healthz")
	if err != nil {
		cancel()
		t.Fatalf("pre-shutdown GET: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		cancel()
		t.Fatalf("pre-shutdown status = %d", resp.StatusCode)
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Serve: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatalf("server did not shut down")
	}
	if _, err := client.Get(base + "/healthz"); err == nil {
		t.Errorf("expected connection failure after shutdown")
	}
}

func TestMissingSecrets(t *testing.T) {
	if _, err := config.LoadFile("/nonexistent-server-config.json"); err == nil {
		t.Errorf("expected error for missing config file")
	}
	if _, err := config.LoadHostKey("/nonexistent-server-key"); err == nil {
		t.Errorf("expected error for missing key file")
	}
}
