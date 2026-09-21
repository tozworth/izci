package protocol

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestSharedMessageFixtures replays tests/multiplayer-protocol/*.json through
// ValidateMessage in parity with the TypeScript fixture test.
func TestSharedMessageFixtures(t *testing.T) {
	dir := "../../../tests/multiplayer-protocol"
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read fixtures: %v", err)
	}
	count := 0
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".json") {
			continue
		}
		count++
		t.Run(name, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(dir, name))
			if err != nil {
				t.Fatal(err)
			}
			var value map[string]any
			if err := json.Unmarshal(data, &value); err != nil {
				t.Fatalf("invalid JSON: %v", err)
			}
			kind, _ := value["kind"].(string)
			// Source frames and chunks have dedicated handling.
			if kind == "file.begin" || kind == "file.end" || kind == "chunk" {
				ok, _, _, _ := ValidateMessage(data)
				wantValid := strings.HasPrefix(name, "valid-")
				if wantValid && !ok {
					t.Fatalf("valid frame rejected: %s", name)
				}
				if strings.HasPrefix(name, "invalid-") && ok {
					t.Fatalf("invalid frame accepted: %s", name)
				}
				return
			}
			if name == "valid-unknown-optional.json" {
				ok, ignored, critical, _ := ValidateMessage(data)
				if !ok || !ignored || critical {
					t.Fatalf("unknown optional should be safely ignored, ok=%v ignored=%v critical=%v", ok, ignored, critical)
				}
				return
			}
			if name == "valid-command-unsupported-type.json" {
				ok, ignored, _, _ := ValidateMessage(data)
				if !ok || ignored {
					t.Fatalf("unsupported command envelope should validate for nack")
				}
				var msg struct {
					Command json.RawMessage `json:"command"`
				}
				if err := json.Unmarshal(data, &msg); err != nil {
					t.Fatal(err)
				}
				env, envelopeOK := ValidateCommandEnvelope(msg.Command)
				if !envelopeOK {
					t.Fatalf("unsupported command envelope invalid")
				}
				if IsSupportedCommand(env.Type) {
					t.Fatalf("unsupported command reported as supported")
				}
				_ = env
				return
			}
			ok, ignored, _, _ := ValidateMessage(data)
			if strings.HasPrefix(name, "valid-") {
				if !ok {
					t.Fatalf("valid fixture rejected: %s", name)
				}
				if ignored && name != "valid-unknown-optional.json" {
					// Only the unknown-optional fixture may be ignored.
					t.Fatalf("valid fixture ignored: %s", name)
				}
				return
			}
			if !strings.HasPrefix(name, "invalid-") {
				t.Fatalf("fixture must start with valid- or invalid-")
			}
			if ok {
				t.Fatalf("invalid fixture accepted: %s", name)
			}
		})
	}
	if count == 0 {
		t.Fatalf("no fixtures in %s", dir)
	}
}

// TestSharedBinaryFrames decodes tests/multiplayer-protocol/frames/*.bin.
func TestSharedBinaryFrames(t *testing.T) {
	dir := "../../../tests/multiplayer-protocol/frames"
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read frames: %v", err)
	}
	if len(entries) == 0 {
		t.Fatalf("no frames in %s", dir)
	}
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".bin") {
			continue
		}
		t.Run(name, func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(dir, name))
			if err != nil {
				t.Fatal(err)
			}
			_, err = DecodeRenderFrame(data)
			if strings.HasPrefix(name, "valid-") && err != nil {
				t.Fatalf("valid frame decode failed: %v", err)
			}
			if strings.HasPrefix(name, "invalid-") && err == nil {
				t.Fatalf("invalid frame decoded")
			}
		})
	}
}

// TestSharedTranscripts validates ordering and generation ownership.
func TestSharedTranscripts(t *testing.T) {
	dir := "../../../tests/multiplayer-protocol/transcripts"
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read transcripts: %v", err)
	}
	if len(entries) == 0 {
		t.Fatalf("no transcripts in %s", dir)
	}
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
			var transcript Transcript
			if err := json.Unmarshal(data, &transcript); err != nil {
				t.Fatal(err)
			}
			if len(transcript.Steps) == 0 {
				t.Fatalf("empty transcript")
			}
			if err := ValidateTranscript(transcript); err != nil {
				t.Fatalf("transcript invalid: %v", err)
			}
		})
	}
}
