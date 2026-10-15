package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tozworth/izci/izci-server/internal/config"
)

// syncBuffer is a goroutine-safe log sink for asserting on startup lines.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// TestServeCombinedBootsHost proves `serve` runs signaling plus the embedded
// dedicated host: the host acquires a room and completes socket auth over
// loopback, while a browser-style client can retrieve and join that exact
// dedicated room with minor skew (and is rejected on major mismatch).
func TestServeCombinedBootsHost(t *testing.T) {
	dir := t.TempDir()
	var keyRaw [32]byte
	if _, err := rand.Read(keyRaw[:]); err != nil {
		t.Fatal(err)
	}
	keyHex := hex.EncodeToString(keyRaw[:])
	keyPath := filepath.Join(dir, "host-key")
	if err := os.WriteFile(keyPath, []byte(keyHex+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	// Ephemeral port: bind once to discover it, then release. Residual
	// collision risk is acceptable for a loopback test.
	probe, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := probe.Addr().(*net.TCPAddr).Port
	_ = probe.Close()

	cfgDoc := fmt.Sprintf(`{"listen":"127.0.0.1:%d","publicBaseUrl":"http://127.0.0.1:%d/signal","pathPrefix":"/signal","hostKeyFile":%q}`,
		port, port, keyPath)
	cfg, err := config.Load([]byte(cfgDoc))
	if err != nil {
		t.Fatal(err)
	}
	var key [32]byte
	copy(key[:], keyRaw[:])

	logs := &syncBuffer{}
	logger := log.New(logs, "", 0)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- runCombined(ctx, cfg, key, logger, "test-host") }()

	base := fmt.Sprintf("http://127.0.0.1:%d", port)
	apiBase := base + "/signal"
	deadline := time.Now().Add(15 * time.Second)
	for {
		out := logs.String()
		if strings.Contains(out, `"event":"host.room.acquired"`) && strings.Contains(out, `"event":"host.signaling.ready"`) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("embedded host did not become ready; logs:\n%s", out)
		}
		select {
		case err := <-done:
			t.Fatalf("runCombined exited early: %v; logs:\n%s", err, logs.String())
		case <-time.After(100 * time.Millisecond):
		}
	}

	client := &http.Client{Timeout: 5 * time.Second}
	post := func(path, bearer string, body any) (int, map[string]any) {
		t.Helper()
		var buf bytes.Buffer
		if body != nil {
			if err := json.NewEncoder(&buf).Encode(body); err != nil {
				t.Fatal(err)
			}
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiBase+path, &buf)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var v map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&v)
		return resp.StatusCode, v
	}
	get := func(path, bearer string) (int, map[string]any) {
		t.Helper()
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiBase+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer "+bearer)
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var v map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&v)
		return resp.StatusCode, v
	}
	status, body := post("/v1/host/sessions", "", map[string]any{"hostKey": keyHex})
	if status != http.StatusCreated {
		t.Fatalf("login: status=%d body=%v", status, body)
	}
	session := body["sessionToken"].(string)
	status, body = get("/v1/dedicated-room", session)
	if status != http.StatusOK {
		t.Fatalf("get dedicated room: status=%d body=%v", status, body)
	}
	roomID := body["roomId"].(string)
	invite := body["invitationSecret"].(string)
	status, _ = post("/v1/join", "", map[string]any{
		"roomId": roomID, "invitationSecret": invite,
		"attemptNonce": "0123456789abcdef", "appProtocolMajor": 1, "appProtocolMinor": 99,
	})
	if status != http.StatusCreated {
		t.Fatalf("minor-skew join must admit: status=%d", status)
	}
	status, body = post("/v1/join", "", map[string]any{
		"roomId": roomID, "invitationSecret": invite,
		"attemptNonce": "fedcba9876543210", "appProtocolMajor": 999,
	})
	if status == http.StatusCreated {
		t.Fatalf("major mismatch must not admit")
	}
	if errObj, ok := body["error"].(map[string]any); !ok || errObj["code"] != "unsupported-version" {
		t.Fatalf("major mismatch must report unsupported-version: %v", body)
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("clean shutdown: %v", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatalf("runCombined did not shut down")
	}
}
