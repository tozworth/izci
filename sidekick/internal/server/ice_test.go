package server

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// iceCall issues POST /v1/ice against a test server with the given bearer
// and room, returning status plus the decoded body.
func iceCall(t *testing.T, s *Server, bearer, room string) (int, map[string]any) {
	t.Helper()
	var body []byte
	if room != "" {
		body, _ = json.Marshal(map[string]string{"roomId": room})
	} else {
		body = []byte("{}")
	}
	req := httptest.NewRequest(http.MethodPost, "/v1/ice", bytes.NewReader(body))
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	resp := rec.Result()
	defer resp.Body.Close()
	var v map[string]any
	if resp.StatusCode != http.StatusNoContent {
		if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
			t.Fatalf("decode ice body: %v", err)
		}
	}
	return resp.StatusCode, v
}

func iceServers(t *testing.T, v map[string]any) []any {
	t.Helper()
	servers, _ := v["iceServers"].([]any)
	return servers
}

func writeRelaySecret(t *testing.T, secret string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "relay-secret")
	if err := os.WriteFile(path, []byte(secret+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestIceEmptyByDefault(t *testing.T) {
	h := newHarness(t, "")
	token := h.login()
	room, _, _ := h.createRoom(token)
	status, v := h.post("/v1/ice", map[string]any{"roomId": room}, token)
	if status != http.StatusOK {
		t.Fatalf("host ice status = %d (%v)", status, v)
	}
	servers, _ := v["iceServers"].([]any)
	if len(servers) != 0 {
		t.Fatalf("default iceServers = %v, want empty", v["iceServers"])
	}
	if _, ok := v["expiresAt"]; ok {
		t.Fatalf("default ice must not carry expiresAt: %v", v)
	}
}

func loginVia(t *testing.T, s *Server, _ string) string {
	t.Helper()
	body, _ := json.Marshal(map[string]string{"hostKey": testHostKeyHex()})
	req := httptest.NewRequest(http.MethodPost, "/v1/host/sessions", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	resp := rec.Result()
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("login status = %d", resp.StatusCode)
	}
	var v map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		t.Fatal(err)
	}
	token, _ := v["sessionToken"].(string)
	if token == "" {
		t.Fatal("missing sessionToken")
	}
	return token
}

func createRoomVia(t *testing.T, s *Server, token string, extra map[string]any) map[string]any {
	t.Helper()
	bodyMap := map[string]any{}
	for k, v := range extra {
		bodyMap[k] = v
	}
	body, _ := json.Marshal(bodyMap)
	req := httptest.NewRequest(http.MethodPost, "/v1/rooms", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	resp := rec.Result()
	defer resp.Body.Close()
	var v map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		t.Fatalf("create room status = %d (%v)", resp.StatusCode, v)
	}
	return v
}

func joinVia(t *testing.T, s *Server, room, invite string) map[string]any {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"roomId": room, "invitationSecret": invite,
		"attemptNonce": "ice-test-nonce", "appProtocol": AppProtocolVersion,
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/join", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	resp := rec.Result()
	defer resp.Body.Close()
	var v map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("join status = %d (%v)", resp.StatusCode, v)
	}
	return v
}

func TestIceStunAndBareTurnWithoutRelay(t *testing.T) {
	cfg := testConfig(t, "")
	cfg.IceURLs = []string{"stun:stun.example.test:3478", "turn:turn.example.test:3478"}
	s := newTestServer(t, cfg, nil)
	token := loginVia(t, s, "")
	room := createRoomVia(t, s, token, nil)
	status, v := iceCall(t, s, token, room["roomId"].(string))
	if status != http.StatusOK {
		t.Fatalf("ice status = %d (%v)", status, v)
	}
	servers := iceServers(t, v)
	if len(servers) != 2 {
		t.Fatalf("iceServers = %v, want stun+turn", v["iceServers"])
	}
	for _, entry := range servers {
		m := entry.(map[string]any)
		if _, ok := m["username"]; ok {
			t.Fatalf("turn entry must be bare without a relay secret: %v", m)
		}
	}
	if _, ok := v["expiresAt"]; ok {
		t.Fatalf("bare ice must not carry expiresAt: %v", v)
	}
}

func TestIceTurnCredentialsWithRelay(t *testing.T) {
	cfg := testConfig(t, "")
	cfg.IceURLs = []string{"stun:stun.example.test:3478", "turn:turn.example.test:3478"}
	cfg.RelaySecretFile = writeRelaySecret(t, "correct horse battery staple relay")
	s := newTestServer(t, cfg, nil)
	token := loginVia(t, s, "")
	room := createRoomVia(t, s, token, nil)
	status, v := iceCall(t, s, token, room["roomId"].(string))
	if status != http.StatusOK {
		t.Fatalf("ice status = %d (%v)", status, v)
	}
	servers := iceServers(t, v)
	if len(servers) != 2 {
		t.Fatalf("iceServers = %v", v["iceServers"])
	}
	var turn map[string]any
	for _, entry := range servers {
		m := entry.(map[string]any)
		urls, _ := m["urls"].([]any)
		if len(urls) > 0 && strings.HasPrefix(strings.ToLower(urls[0].(string)), "turn:") {
			turn = m
		}
	}
	if turn == nil {
		t.Fatalf("no turn entry in %v", v["iceServers"])
	}
	username, _ := turn["username"].(string)
	credential, _ := turn["credential"].(string)
	if username == "" || credential == "" {
		t.Fatalf("turn entry lacks credentials: %v", turn)
	}
	parts := strings.Split(username, ":")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		t.Fatalf("username must be expiry:opaque, got %q", username)
	}
	// The credential must verify as standard coturn REST shared-secret output.
	mac := hmac.New(sha1.New, []byte("correct horse battery staple relay"))
	_, _ = mac.Write([]byte(username))
	want := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	if credential != want {
		t.Fatalf("credential does not match HMAC-SHA1 REST derivation")
	}
	expRaw, ok := v["expiresAt"].(string)
	if !ok || expRaw == "" {
		t.Fatalf("turn ice must carry expiresAt: %v", v)
	}
	exp, err := time.Parse(time.RFC3339, expRaw)
	if err != nil {
		t.Fatalf("expiresAt not RFC3339: %v", err)
	}
	if delta := time.Until(exp); delta < 9*time.Minute || delta > 11*time.Minute {
		t.Fatalf("credential ttl = %v, want ~10m", delta)
	}
}

func TestIceCredentialUsernamesAreOpaque(t *testing.T) {
	cfg := testConfig(t, "")
	cfg.IceURLs = []string{"turn:turn.example.test:3478"}
	cfg.RelaySecretFile = writeRelaySecret(t, "another relay secret value")
	s := newTestServer(t, cfg, nil)
	token := loginVia(t, s, "")
	room := createRoomVia(t, s, token, nil)
	seen := map[string]bool{}
	for i := 0; i < 4; i++ {
		status, v := iceCall(t, s, token, room["roomId"].(string))
		if status != http.StatusOK {
			t.Fatalf("ice status = %d", status)
		}
		servers := iceServers(t, v)
		m := servers[0].(map[string]any)
		username, _ := m["username"].(string)
		if seen[username] {
			t.Fatalf("duplicate opaque username %q", username)
		}
		seen[username] = true
		if strings.Contains(username, "host") || strings.Contains(username, room["roomId"].(string)) {
			t.Fatalf("username leaks identity material: %q", username)
		}
	}
}

func TestIceConnectionScopeAndCap(t *testing.T) {
	cfg := testConfig(t, "")
	cfg.IceURLs = []string{"stun:stun.example.test:3478"}
	cfg.MaxIcePerConnection = 2
	s := newTestServer(t, cfg, nil)
	token := loginVia(t, s, "")
	room := createRoomVia(t, s, token, nil)
	join := joinVia(t, s, room["roomId"].(string), room["invitationSecret"].(string))
	connToken := join["connectionToken"].(string)

	for i := 0; i < 2; i++ {
		if status, _ := iceCall(t, s, connToken, ""); status != http.StatusOK {
			t.Fatalf("ice call %d status = %d", i, status)
		}
	}
	status, v := iceCall(t, s, connToken, "")
	if status != http.StatusTooManyRequests {
		t.Fatalf("over-cap ice status = %d (%v)", status, v)
	}
	errObj, _ := v["error"].(map[string]any)
	if errObj["code"] != CodeRateLimited {
		t.Fatalf("over-cap code = %v", v)
	}

	// A connection bearer for another room is rejected, not honored.
	other := createRoomVia(t, s, token, nil)
	if status, _ := iceCall(t, s, connToken, other["roomId"].(string)); status != http.StatusUnauthorized {
		t.Fatalf("wrong-room ice status = %d", status)
	}
	if status, _ := iceCall(t, s, "", ""); status != http.StatusUnauthorized {
		t.Fatalf("missing bearer ice status = %d", status)
	}
}

func TestIcePrefixedAndShutdown(t *testing.T) {
	h := newHarness(t, "/party")
	token := h.login()
	room, _, _ := h.createRoom(token)
	status, v := h.post("/v1/ice", map[string]any{"roomId": room}, token)
	if status != http.StatusOK {
		t.Fatalf("prefixed ice status = %d (%v)", status, v)
	}
	if _, ok := v["iceServers"]; !ok {
		t.Fatalf("prefixed ice body = %v", v)
	}
}

func TestRecreateRoomAfterRestart(t *testing.T) {
	h := newHarness(t, "")
	token := h.login()
	roomID, owner, invite := h.createRoom(token)

	// Same IDs recreate the room after it vanishes (simulated restart by
	// deleting it with the owner session, then recreating).
	if status := h.del("/v1/rooms/"+roomID, token); status != http.StatusNoContent {
		t.Fatalf("delete status = %d", status)
	}
	status, v := h.post("/v1/rooms", map[string]any{
		"roomId": roomID, "ownerSecret": owner, "invitationSecret": invite,
	}, token)
	if status != http.StatusCreated {
		t.Fatalf("recreate status = %d (%v)", status, v)
	}
	if strMap(v, "roomId") != roomID || strMap(v, "invitationSecret") != invite {
		t.Fatalf("recreate changed saved IDs: %v", v)
	}
	// The saved invitation admits guests again.
	joinStatus, _ := h.join(roomID, invite, "recreate-nonce-1", AppProtocolVersion)
	if joinStatus != http.StatusCreated {
		t.Fatalf("join after recreate = %d", joinStatus)
	}
}

func TestRecreateRejectsCollisions(t *testing.T) {
	h := newHarness(t, "")
	token := h.login()
	roomID, _, _ := h.createRoom(token)

	// Partial recreate shapes are bad requests.
	if status, _ := h.post("/v1/rooms", map[string]any{"roomId": roomID}, token); status != http.StatusBadRequest {
		t.Fatalf("partial recreate status = %d", status)
	}
	// Collision without the owner secret is a conflict, indistinguishable
	// from an unavailable room.
	status, v := h.post("/v1/rooms", map[string]any{
		"roomId":           roomID,
		"ownerSecret":      strings.Repeat("a", 43),
		"invitationSecret": strings.Repeat("b", 43),
	}, token)
	if status != http.StatusConflict {
		t.Fatalf("collision status = %d (%v)", status, v)
	}
	if errCodeMap(v) != CodeRoomUnavailable {
		t.Fatalf("collision code = %v", v)
	}
	// Malformed IDs are rejected before any registry lookup.
	if status, _ := h.post("/v1/rooms", map[string]any{
		"roomId":           "not-a-room",
		"ownerSecret":      strings.Repeat("a", 43),
		"invitationSecret": strings.Repeat("b", 43),
	}, token); status != http.StatusBadRequest {
		t.Fatalf("malformed recreate status = %d", status)
	}
}

func TestRecreateAdoptsLiveRoomWithOwnerSecret(t *testing.T) {
	h := newHarness(t, "")
	token := h.login()
	roomID, owner, invite := h.createRoom(token)

	// The owning session re-creating its live room is idempotent adoption.
	status, v := h.post("/v1/rooms", map[string]any{
		"roomId": roomID, "ownerSecret": owner, "invitationSecret": invite,
	}, token)
	if status != http.StatusOK {
		t.Fatalf("adopt status = %d (%v)", status, v)
	}
	if strMap(v, "roomId") != roomID {
		t.Fatalf("adopt changed room: %v", v)
	}
	// Another logged-in tab without the owner secret cannot take it over.
	other := h.login()
	badStatus, badBody := h.post("/v1/rooms", map[string]any{
		"roomId":           roomID,
		"ownerSecret":      strings.Repeat("c", 43),
		"invitationSecret": strings.Repeat("d", 43),
	}, other)
	if badStatus != http.StatusConflict || errCodeMap(badBody) != CodeRoomUnavailable {
		t.Fatalf("takeover = %d (%v)", badStatus, badBody)
	}
}
