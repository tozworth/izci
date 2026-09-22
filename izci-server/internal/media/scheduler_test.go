package media

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	appProtocol "github.com/dunsparce9/izci/izci-server/internal/protocol"
)

// TestSchedulerStartupWindow proves a fresh peer gets the seek target and
// its startup window first, then forward fill.
func TestSchedulerStartupWindow(t *testing.T) {
	times := []float64{0, 1000, 2000, 3000, 4000}
	got := PlanRenderClusters(PlanInput{
		ClusterTimeMs: times,
		TargetTimeMs:  0, AheadMs: 2500,
		PlayheadMs: 0, ProtectionMs: 1000,
		Sent: map[int]bool{},
	})
	// Startup window covers clusters 0,1,2 (0..2000 within 2500ms), then
	// forward fill 3,4.
	want := []int{0, 1, 2, 3, 4}
	if len(got) != len(want) {
		t.Fatalf("plan=%v want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("plan=%v want %v", got, want)
		}
	}
}

// TestSchedulerSeekJumpsQueue proves a seek target re-plans around the new
// position while skipping already-received and already-sent clusters.
func TestSchedulerSeekJumpsQueue(t *testing.T) {
	times := []float64{0, 1000, 2000, 3000, 4000, 5000}
	got := PlanRenderClusters(PlanInput{
		ClusterTimeMs: times,
		TargetTimeMs:  4000, AheadMs: 1500,
		PlayheadMs: 4000, ProtectionMs: 500,
		Received: [][2]int{{0, 2}},
		Sent:     map[int]bool{4: true},
	})
	// 4 already sent; startup window from 4 covers 4,5 -> only 5 new;
	// forward fill none left; holes before min(4,4): 0..3 minus received
	// -> only 3.
	want := []int{5, 3}
	if len(got) != len(want) {
		t.Fatalf("plan=%v want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("plan=%v want %v", got, want)
		}
	}
}

// TestSchedulerEmptyTimeline proves an empty manifest plans nothing.
func TestSchedulerEmptyTimeline(t *testing.T) {
	if got := PlanRenderClusters(PlanInput{Sent: map[int]bool{}}); len(got) != 0 {
		t.Fatalf("plan=%v want empty", got)
	}
}

// TestFrameFixtureCompat proves server framing satisfies the shared
// binary fixtures: the repo's valid frames decode, the invalid ones are
// rejected, and our encoder output round-trips through the decoder.
func TestFrameFixtureCompat(t *testing.T) {
	root := ".." + string(filepath.Separator) + ".." + string(filepath.Separator) + ".." + string(filepath.Separator)
	frames := filepath.Join(root, "tests", "multiplayer-protocol", "frames")
	for _, name := range []string{"valid-render-init.bin", "valid-render-cluster.bin"} {
		raw, err := os.ReadFile(filepath.Join(frames, name))
		if err != nil {
			t.Fatalf("fixture %s: %v", name, err)
		}
		f, err := appProtocol.DecodeRenderFrame(raw)
		if err != nil {
			t.Fatalf("valid fixture %s rejected: %v", name, err)
		}
		if f.RenderID == "" || len(f.Payload) == 0 {
			t.Fatalf("fixture %s decoded empty", name)
		}
		// Our encoder must reproduce an equivalent frame.
		enc := appProtocol.EncodeRenderFrame(f.RenderID, f.Epoch, f.ClusterIndex, f.FragmentOffset, f.Payload)
		rt, err := appProtocol.DecodeRenderFrame(enc)
		if err != nil {
			t.Fatalf("round trip %s: %v", name, err)
		}
		if rt.RenderID != f.RenderID || rt.Epoch != f.Epoch || rt.ClusterIndex != f.ClusterIndex ||
			rt.FragmentOffset != f.FragmentOffset || rt.FragmentLength != f.FragmentLength ||
			string(rt.Payload) != string(f.Payload) {
			t.Fatalf("round trip %s mismatch", name)
		}
	}
	for _, name := range []string{"invalid-render-bad-marker.bin", "invalid-render-length-mismatch.bin", "invalid-render-truncated.bin"} {
		raw, err := os.ReadFile(filepath.Join(frames, name))
		if err != nil {
			t.Fatalf("fixture %s: %v", name, err)
		}
		if _, err := appProtocol.DecodeRenderFrame(raw); err == nil {
			t.Fatalf("invalid fixture %s accepted", name)
		}
	}
}

// TestManifestFixtureCompat proves manifests built by the render job
// satisfy the same protocol validation as the browser host's fixtures.
func TestManifestFixtureCompat(t *testing.T) {
	deps := testDeps(t)
	dir := t.TempDir()
	path := genTone(t, dir, "tone.wav", append(sineArgs(2), "-ar", "44100")...)
	cache := testCache(t)
	m, _ := renderFile(t, cache, deps, path, "stream", "wav", "rev:fixture", 0)
	wire := map[string]any{"kind": "render.manifest", "manifest": manifestMap(m)}
	raw, _ := json.Marshal(wire)
	if ok, _, _, _ := appProtocol.ValidateMessage(raw); !ok {
		t.Fatal("server manifest rejected by protocol validation")
	}
	// The repo's own valid fixture passes the same gate; the invalid one
	// (bad total) does not.
	root := ".." + string(filepath.Separator) + ".." + string(filepath.Separator) + ".." + string(filepath.Separator)
	fixtures := filepath.Join(root, "tests", "multiplayer-protocol")
	valid, err := os.ReadFile(filepath.Join(fixtures, "valid-render-manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	if ok, _, _, _ := appProtocol.ValidateMessage(valid); !ok {
		t.Fatal("repo valid manifest rejected")
	}
	invalid, err := os.ReadFile(filepath.Join(fixtures, "invalid-render-manifest-bad-total.json"))
	if err != nil {
		t.Fatal(err)
	}
	if ok, _, _, _ := appProtocol.ValidateMessage(invalid); ok {
		t.Fatal("repo invalid manifest accepted")
	}
}

// manifestMap mirrors the host's wire encoding for validation tests.
func manifestMap(m Manifest) map[string]any {
	clusters := make([]map[string]any, len(m.Clusters))
	for i, c := range m.Clusters {
		clusters[i] = map[string]any{"index": c.Index, "timeMs": c.TimeMs, "sizeBytes": c.SizeBytes}
	}
	return map[string]any{
		"generationId": m.GenerationID, "renderId": m.RenderID,
		"trackId": m.TrackID, "sourceRevision": m.SourceRevision,
		"codec": m.Codec, "container": m.Container,
		"durationMs": m.DurationMs, "bitrateKbps": m.BitrateKbps,
		"clusterDurationMs": m.ClusterDurationMs, "clusters": clusters,
		"initSizeBytes": m.InitSizeBytes, "totalBytes": m.TotalBytes,
	}
}
