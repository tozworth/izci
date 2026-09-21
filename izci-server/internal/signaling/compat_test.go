package signaling

import (
	"net/http"
	"testing"
)

// TestJoinCompatibilityMatrix covers Phase 0 admission: same-major minor skew
// both directions admits, unknown capabilities admit, major mismatch rejects.
func TestJoinCompatibilityMatrix(t *testing.T) {
	h := newHarness(t, "")
	token := h.login()
	roomID, _, invite := h.createRoom(token)

	// Current minor admits.
	if status, _ := h.joinMajor(roomID, invite, "compat-minor-01", AppProtocolMajor, AppProtocolMinor, nil); status != http.StatusCreated {
		t.Fatalf("current minor join = %d", status)
	}
	// Higher minor admits (additive).
	if status, _ := h.joinMajor(roomID, invite, "compat-minor-02", AppProtocolMajor, AppProtocolMinor+5, nil); status != http.StatusCreated {
		t.Fatalf("higher minor join = %d", status)
	}
	// Unknown capabilities admit (ignored).
	if status, _ := h.joinMajor(roomID, invite, "compat-caps-001", AppProtocolMajor, AppProtocolMinor, []string{"source-file", "future-cap"}); status != http.StatusCreated {
		t.Fatalf("unknown caps join = %d", status)
	}
	// Major mismatch rejects.
	if status, v := h.joinMajor(roomID, invite, "compat-major-01", AppProtocolMajor+1, 0, nil); status != http.StatusBadRequest || errCodeMap(v) != CodeUnsupportedVersion {
		t.Fatalf("major mismatch = %d %v", status, v)
	}
	// Legacy exact-version field without the new major rejects.
	if status, v := h.post("/v1/join", map[string]any{
		"roomId": roomID, "invitationSecret": invite,
		"attemptNonce": "compat-legacy1", "appProtocol": 29,
	}, ""); status != http.StatusBadRequest || errCodeMap(v) != CodeUnsupportedVersion {
		t.Fatalf("legacy field = %d %v", status, v)
	}
}
