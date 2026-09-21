package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func validJSON() string {
	return `{
		"publicBaseUrl": "https://server.example.com",
		"hostKeyFile": "/etc/izci-server/host-key"
	}`
}

func TestLoadDefaults(t *testing.T) {
	cfg, err := Load([]byte(validJSON()))
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Listen != DefaultListen {
		t.Errorf("Listen = %q, want %q", cfg.Listen, DefaultListen)
	}
	if cfg.PathPrefix != "" {
		t.Errorf("PathPrefix = %q, want empty", cfg.PathPrefix)
	}
	l := cfg.Limits
	if l.MaxRooms != 4 || l.MaxPeersPerRoom != 8 || l.MaxPendingAttemptsPerRoom != 8 {
		t.Errorf("room limits = %+v, want 4/8/8", l)
	}
	if l.MaxOpenSockets != 128 {
		t.Errorf("MaxOpenSockets = %d, want 128", l.MaxOpenSockets)
	}
	if time.Duration(l.HostSessionTTL) != 12*time.Hour {
		t.Errorf("HostSessionTTL = %v, want 12h", time.Duration(l.HostSessionTTL))
	}
	if time.Duration(l.RoomLeaseTTL) != 24*time.Hour {
		t.Errorf("RoomLeaseTTL = %v, want 24h", time.Duration(l.RoomLeaseTTL))
	}
	if time.Duration(l.SocketTicketTTL) != 30*time.Second {
		t.Errorf("SocketTicketTTL = %v", time.Duration(l.SocketTicketTTL))
	}
	if time.Duration(l.UnauthSocketTimeout) != 5*time.Second {
		t.Errorf("UnauthSocketTimeout = %v", time.Duration(l.UnauthSocketTimeout))
	}
	if time.Duration(l.AttemptTimeout) != 45*time.Second {
		t.Errorf("AttemptTimeout = %v", time.Duration(l.AttemptTimeout))
	}
	if time.Duration(l.HostReconnectGrace) != 90*time.Second {
		t.Errorf("HostReconnectGrace = %v", time.Duration(l.HostReconnectGrace))
	}
	if l.MaxJSONMessageBytes != 64*1024 || l.MaxSDPBytes != 50*1024 || l.MaxCandidateBytes != 4*1024 {
		t.Errorf("message limits = %d/%d/%d", l.MaxJSONMessageBytes, l.MaxSDPBytes, l.MaxCandidateBytes)
	}
	if l.MaxCandidatesPerSidePerAttempt != 128 {
		t.Errorf("MaxCandidatesPerSidePerAttempt = %d, want 128", l.MaxCandidatesPerSidePerAttempt)
	}
	if l.MaxSocketQueueMessages != 64 || l.MaxSocketQueueBytes != 256*1024 {
		t.Errorf("socket queue = %d/%d", l.MaxSocketQueueMessages, l.MaxSocketQueueBytes)
	}
	if time.Duration(l.HeartbeatInterval) != 20*time.Second || time.Duration(l.HeartbeatTimeout) != 10*time.Second {
		t.Errorf("heartbeat = %v/%v", time.Duration(l.HeartbeatInterval), time.Duration(l.HeartbeatTimeout))
	}
	if time.Duration(l.CleanupInterval) != 5*time.Second || time.Duration(l.ShutdownGrace) != 10*time.Second {
		t.Errorf("cleanup/shutdown = %v/%v", time.Duration(l.CleanupInterval), time.Duration(l.ShutdownGrace))
	}
	if got := cfg.PublicOrigin(); got != "https://server.example.com" {
		t.Errorf("PublicOrigin = %q", got)
	}
}

func TestLoadRejectsUnknownFields(t *testing.T) {
	for _, doc := range []string{
		`{"publicBaseUrl":"https://a.example","hostKeyFile":"k","bogus":1}`,
		`{"publicBaseUrl":"https://a.example","hostKeyFile":"k","limits":{"maxRooms":4,"bogus":1}}`,
	} {
		if _, err := Load([]byte(doc)); err == nil {
			t.Errorf("expected error for %s", doc)
		}
	}
}

func TestLoadInvalid(t *testing.T) {
	table := []struct {
		name string
		doc  string
	}{
		{"empty", ``},
		{"blank", `   `},
		{"not-json", `{`},
		{"trailing", validJSON() + ` {}`},
		{"array", `[]`},
		{"missing-base-url", `{"hostKeyFile":"k"}`},
		{"missing-key-file", `{"publicBaseUrl":"https://a.example"}`},
		{"empty-key-file", `{"publicBaseUrl":"https://a.example","hostKeyFile":"  "}`},
		{"bad-listen", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","listen":"nodocs"}`},
		{"bad-listen-port", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","listen":"127.0.0.1:99999"}`},
		{"http-wan", `{"publicBaseUrl":"http://server.example.com","hostKeyFile":"k"}`},
		{"bad-scheme", `{"publicBaseUrl":"ftp://server.example.com","hostKeyFile":"k"}`},
		{"base-with-query", `{"publicBaseUrl":"https://server.example.com/?x=1","hostKeyFile":"k"}`},
		{"base-with-creds", `{"publicBaseUrl":"https://u@server.example.com","hostKeyFile":"k"}`},
		{"prefix-mismatch", `{"publicBaseUrl":"https://h.example/other","hostKeyFile":"k","pathPrefix":"/server"}`},
		{"prefix-no-slash", `{"publicBaseUrl":"https://h.example","hostKeyFile":"k","pathPrefix":"server"}`},
		{"prefix-trailing-slash", `{"publicBaseUrl":"https://h.example/","hostKeyFile":"k","pathPrefix":"/server/"}`},
		{"prefix-dotdot", `{"publicBaseUrl":"https://h.example","hostKeyFile":"k","pathPrefix":"/../x"}`},
		{"origin-with-path", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","allowedOrigins":["https://b.example/app"]}`},
		{"origin-bad-scheme", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","allowedOrigins":["file:///x"]}`},
		{"origin-with-creds", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","allowedOrigins":["https://u@b.example"]}`},
		{"origin-duplicate", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","allowedOrigins":["https://b.example","https://b.example/"]}`},
		{"bad-proxy", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","trustedProxies":["not-an-ip"]}`},
		{"bad-duration-type", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","limits":{"attemptTimeout":45}}`},
		{"bad-duration-value", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","limits":{"attemptTimeout":"soon"}}`},
		{"duration-out-of-range", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","limits":{"attemptTimeout":"1ms"}}`},
		{"rooms-zero", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","limits":{"maxRooms":0}}`},
		{"rooms-huge", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","limits":{"maxRooms":999999}}`},
		{"desc-control", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","description":"a\u0000b"}`},
		{"bad-ice-scheme", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","iceUrls":["https://turn.example/x"]}`},
		{"bad-relay-ttl-type", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","relayCredentialTtl":600}`},
		{"bad-relay-ttl-range", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","relayCredentialTtl":"30s"}`},
		{"bad-ice-cap", `{"publicBaseUrl":"https://a.example","hostKeyFile":"k","maxIcePerConnection":0}`},
	}
	for _, tc := range table {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Load([]byte(tc.doc)); err == nil {
				t.Errorf("expected error for %s", tc.name)
			}
		})
	}
}

func TestLoadValidVariants(t *testing.T) {
	docs := []string{
		// loopback http is allowed for local development
		`{"publicBaseUrl":"http://127.0.0.1:8787","hostKeyFile":"k"}`,
		`{"publicBaseUrl":"http://localhost:8787","hostKeyFile":"k"}`,
		// prefix must match the base URL path
		`{"publicBaseUrl":"https://h.example/server","hostKeyFile":"k","pathPrefix":"/server"}`,
		// bare IPs and CIDRs in trusted proxies
		`{"publicBaseUrl":"https://a.example","hostKeyFile":"k","trustedProxies":["10.0.0.1","10.0.0.0/8"]}`,
		// custom durations and limits
		`{"publicBaseUrl":"https://a.example","hostKeyFile":"k","limits":{"attemptTimeout":"60s","maxRooms":2}}`,
		// STUN/TURN URLs
		`{"publicBaseUrl":"https://a.example","hostKeyFile":"k","iceUrls":["stun:stun.example:3478","turns:turn.example:5349"]}`,
		// Relay credentials with a custom TTL and issuance cap
		`{"publicBaseUrl":"https://a.example","hostKeyFile":"k","relaySecretFile":"/etc/izci-server/relay-secret","relayCredentialTtl":"5m","maxIcePerConnection":4}`,
	}
	for i, doc := range docs {
		if _, err := Load([]byte(doc)); err != nil {
			t.Errorf("doc %d: %v", i, err)
		}
	}
}

func TestLoadHostKey(t *testing.T) {
	dir := t.TempDir()
	write := func(name, content string) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		return p
	}
	hexKey := strings.Repeat("ab", 32)
	key, err := LoadHostKey(write("ok", hexKey+"\n"))
	if err != nil {
		t.Fatalf("valid key: %v", err)
	}
	if len(key) != HostKeyLength {
		t.Fatalf("key length = %d", len(key))
	}
	if _, err := LoadHostKey(write("upper", "  "+strings.ToUpper(hexKey)+"  ")); err != nil {
		t.Errorf("uppercase/whitespace key: %v", err)
	}
	for name, content := range map[string]string{
		"short":     strings.Repeat("ab", 16),
		"long":      strings.Repeat("ab", 33),
		"nonhex":    strings.Repeat("zz", 32),
		"empty":     "",
		"spaces":    "   \n",
		"multiline": hexKey + "\n" + hexKey,
	} {
		p := write(name, content)
		if _, err := LoadHostKey(p); err == nil {
			t.Errorf("expected error for %s", name)
		} else if prefix := strings.TrimSpace(content); len(prefix) >= 4 && strings.Contains(err.Error(), prefix[:4]) {
			t.Errorf("error leaks key material: %v", err)
		}
	}
	if _, err := LoadHostKey(filepath.Join(dir, "missing")); err == nil {
		t.Errorf("expected error for missing file")
	}
}

func TestLoadRelaySecret(t *testing.T) {
	dir := t.TempDir()
	write := func(name, content string) string {
		p := filepath.Join(dir, name)
		if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
		return p
	}
	secret, err := LoadRelaySecret(write("ok", "correct horse battery staple\n"))
	if err != nil {
		t.Fatalf("valid secret: %v", err)
	}
	if string(secret) != "correct horse battery staple" {
		t.Fatalf("secret not trimmed: %q", secret)
	}
	for name, content := range map[string]string{
		"short":  "secret!",
		"empty":  "",
		"spaces": "   \n",
		"long":   strings.Repeat("s", 513),
	} {
		p := write(name, content)
		if _, err := LoadRelaySecret(p); err == nil {
			t.Errorf("expected error for %s", name)
		} else if trimmed := strings.TrimSpace(content); trimmed != "" && strings.Contains(err.Error(), trimmed) {
			t.Errorf("error leaks secret material: %v", err)
		}
	}
	if _, err := LoadRelaySecret(filepath.Join(dir, "missing")); err == nil {
		t.Errorf("expected error for missing file")
	}
}

func TestExampleConfigLoads(t *testing.T) {
	data, err := os.ReadFile("../../config.example.json")
	if err != nil {
		t.Skipf("example config not present: %v", err)
	}
	// The example points at a placeholder secret path; only the JSON shape
	// and non-secret validation are exercised here.
	cfg, err := Load(data)
	if err != nil {
		t.Fatalf("example config invalid: %v", err)
	}
	if cfg.Listen != "127.0.0.1:8787" {
		t.Errorf("example listen = %q", cfg.Listen)
	}
}
