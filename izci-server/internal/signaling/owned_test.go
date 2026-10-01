package signaling

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOwnedServerOnlyPipeOwnerCanHost(t *testing.T) {
	cfg := testConfig(t, "")
	cfg.Limits.MaxRooms = 1
	server, owner, err := NewOwned(cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	other, foreignOwner, err := NewOwned(cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = other
	call := func(path, bearer, body string) int {
		r := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(body))
		if bearer != "" {
			r.Header.Set("Authorization", "Bearer "+bearer)
		}
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		return w.Code
	}
	for _, address := range []string{"127.0.0.1:1234", "192.168.1.10:1234"} {
		r := httptest.NewRequest(http.MethodPost, "/v1/host/sessions", bytes.NewBufferString(`{"hostKey":"`+testHostKeyHex()+`"}`))
		r.RemoteAddr = address
		w := httptest.NewRecorder()
		server.Handler().ServeHTTP(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("public login from %s: %d", address, w.Code)
		}
	}
	for _, bearer := range []string{"", foreignOwner} {
		if status := call("/v1/rooms", bearer, `{"capacity":4}`); status != http.StatusUnauthorized {
			t.Fatalf("foreign owner: %d", status)
		}
	}
	if status := call("/v1/rooms", owner, `{"capacity":4}`); status != http.StatusCreated {
		t.Fatalf("pipe owner: %d", status)
	}
	if status := call("/v1/rooms", owner, `{"capacity":4}`); status == http.StatusCreated {
		t.Fatal("owned server created a second party")
	}
}
