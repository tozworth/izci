package signaling

import (
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/tozworth/izci/izci-server/internal/config"
)

func TestReadinessAndMetricsDoNotExposeSecrets(t *testing.T) {
	cfg := config.Default()
	cfg.PublicBaseURL = "https://server.example"
	cfg.HostKeyFile = "unused"
	s, err := New(&cfg, log.New(io.Discard, "", 0), [32]byte{1})
	if err != nil {
		t.Fatal(err)
	}
	s.SetRuntimeStatus(func() RuntimeStatus {
		return RuntimeStatus{Ready: true, LibraryReady: true, DependenciesReady: false, CacheReady: true, AdmissionReady: true, Peers: 2, Sessions: 3, CatalogTracks: 9, Metrics: map[string]uint64{"host_commands_total": 7}}
	})
	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"catalogTracks":9`) {
		t.Fatalf("ready: %d %s", rec.Code, rec.Body.String())
	}
	req = httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec = httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	body := rec.Body.String()
	if rec.Code != http.StatusOK || !strings.Contains(body, "izci_server_host_commands_total 7") {
		t.Fatalf("metrics: %d %s", rec.Code, body)
	}
	for _, secret := range []string{"invitation", "candidate", "sdp", "source_path"} {
		if strings.Contains(strings.ToLower(body), secret) {
			t.Fatalf("metrics exposed sensitive label %q", secret)
		}
	}
}

func TestReadinessUnavailableDuringShutdown(t *testing.T) {
	cfg := config.Default()
	cfg.PublicBaseURL = "https://server.example"
	cfg.HostKeyFile = "unused"
	s, err := New(&cfg, log.New(io.Discard, "", 0), [32]byte{1})
	if err != nil {
		t.Fatal(err)
	}
	s.closed.Store(true)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("ready status = %d", rec.Code)
	}
}
