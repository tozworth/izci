package server

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestContractFixtures replays the shared JSON fixtures from
// tests/multiplayer-sidekick-contract/ (also used by Phase 3 browser helpers)
// through the stateless wire checks. Server/state behavior is covered by the
// exchange tests instead.
func TestContractFixtures(t *testing.T) {
	dir := "../../../tests/multiplayer-sidekick-contract"
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read fixtures: %v", err)
	}
	if len(entries) == 0 {
		t.Fatalf("no fixtures in %s", dir)
	}
	const maxSDP = 50 * 1024
	const maxCand = 4 * 1024
	const maxCands = 128
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".json") {
			continue
		}
		t.Run(name, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(dir, name))
			if err != nil {
				t.Fatal(err)
			}
			var env Envelope
			dec := json.NewDecoder(bytes.NewReader(data))
			dec.DisallowUnknownFields()
			strictOK := dec.Decode(&env) == nil && !dec.More()
			envCode := ""
			if strictOK {
				envCode = validateFixtureEnvelope(env)
			}
			semCode := ""
			if strictOK && envCode == "" && clientMessageTypes[env.Type] {
				_, _, _, semCode = validateClientSemantics(env, maxSDP, maxCand, maxCands)
			}
			wantValid := strings.HasPrefix(name, "valid-")
			if wantValid {
				if !strictOK {
					t.Fatalf("valid fixture fails strict decode")
				}
				if envCode != "" {
					t.Fatalf("valid fixture envelope code = %q", envCode)
				}
				if clientMessageTypes[env.Type] && semCode != "" {
					t.Fatalf("valid fixture semantics code = %q", semCode)
				}
				return
			}
			if !strings.HasPrefix(name, "invalid-") {
				t.Fatalf("fixture must start with valid- or invalid-")
			}
			if strictOK && envCode == "" && semCode == "" {
				t.Fatalf("invalid fixture was accepted")
			}
		})
	}
}
