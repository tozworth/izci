package media

import (
	"os"
	"path/filepath"
	"testing"
)

// TestCachePublishLookupRoundTrip proves a published render reads back
// byte-identical through the pin-held API.
func TestCachePublishLookupRoundTrip(t *testing.T) {
	c := testCache(t)
	key := RenderKey{SourceRevision: "1:10:20:0:abc", DecoderFamily: DecoderFFmpeg, DecoderVersion: "ffmpeg test", BitrateKbps: 96}
	m := Manifest{RenderID: "r1", TrackID: "t", SourceRevision: key.SourceRevision, Codec: "opus", Container: "webm",
		DurationMs: 3000, BitrateKbps: 96, ClusterDurationMs: 1000,
		Clusters:      []ManifestCluster{{Index: 0, TimeMs: 0, SizeBytes: 4}, {Index: 1, TimeMs: 1000, SizeBytes: 4}},
		InitSizeBytes: 8, TotalBytes: 16}
	init := []byte("initinit")
	clusters := [][]byte{[]byte("c0c0"), []byte("c1c1")}
	if err := c.Publish(key, m, init, clusters); err != nil {
		t.Fatal(err)
	}
	if _, ok := c.Lookup(key); !ok {
		t.Fatal("published entry not found")
	}
	c.Pin(key.String())
	defer c.Unpin(key.String())
	gotInit, err := c.ReadInit(key.String())
	if err != nil || string(gotInit) != string(init) {
		t.Fatalf("init round trip: %q %v", gotInit, err)
	}
	for i, want := range clusters {
		got, err := c.ReadCluster(key.String(), i)
		if err != nil || string(got) != string(want) {
			t.Fatalf("cluster %d round trip: %q %v", i, got, err)
		}
	}
	gotM, err := c.StoredManifest(key.String())
	if err != nil || gotM.RenderID != "r1" || len(gotM.Clusters) != 2 {
		t.Fatalf("manifest round trip: %+v %v", gotM, err)
	}
}

// TestCacheInvalidation proves a replaced source (new revision) misses
// the old entry and renders under a new key.
func TestCacheInvalidation(t *testing.T) {
	deps := testDeps(t)
	dir := t.TempDir()
	cache := testCache(t)
	path := genTone(t, dir, "v1.wav", append(sineArgs(2), "-ar", "44100")...)
	m1, k1 := renderFile(t, cache, deps, path, "stream", "wav", "rev:v1", 0)
	// Same path, new revision: must miss and re-render.
	m2, k2 := renderFile(t, cache, deps, path, "stream", "wav", "rev:v2", 0)
	if k1.String() == k2.String() {
		t.Fatal("revision change did not change cache key")
	}
	if m1.RenderID == m2.RenderID {
		t.Fatal("revision change reused render bytes")
	}
	if n := cache.EntryCount(); n != 2 {
		t.Fatalf("entries=%d want 2", n)
	}
}

// TestCacheLRUEviction proves unpinned entries evict oldest-first under
// the size cap while pinned entries survive.
func TestCacheLRUEviction(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "renders")
	c, err := OpenCache(dir, 2000)
	if err != nil {
		t.Fatal(err)
	}
	put := func(key, body string, size int) RenderKey {
		t.Helper()
		k := RenderKey{SourceRevision: key, DecoderFamily: DecoderFFmpeg, DecoderVersion: "v", BitrateKbps: 96}
		payload := make([]byte, size)
		for i := range payload {
			payload[i] = body[0]
		}
		m := Manifest{RenderID: key, TrackID: "t", SourceRevision: key, Codec: "opus", Container: "webm",
			DurationMs: 1000, BitrateKbps: 96, ClusterDurationMs: 1000,
			Clusters:      []ManifestCluster{{Index: 0, TimeMs: 0, SizeBytes: int64(size)}},
			InitSizeBytes: 8, TotalBytes: int64(8 + size)}
		if err := c.Publish(k, m, []byte("12345678"), [][]byte{payload}); err != nil {
			t.Fatal(err)
		}
		return k
	}
	kOld := put("old", "a", 400)
	kMid := put("mid", "b", 400)
	// Pin mid, then overflow: old (unpinned, oldest) must evict first.
	c.Pin(kMid.String())
	kNew := put("new", "c", 400)
	if _, ok := c.Lookup(kOld); ok {
		t.Fatal("oldest unpinned entry survived eviction")
	}
	if _, ok := c.Lookup(kMid); !ok {
		t.Fatal("pinned entry evicted")
	}
	if _, ok := c.Lookup(kNew); !ok {
		t.Fatal("new entry missing")
	}
	c.Unpin(kMid.String())
	if c.Pinned(kMid.String()) != 0 {
		t.Fatal("unpin did not release")
	}
}

// TestCachePartialNeverPublished proves a crashed publish (temp dir left
// behind, no manifest) is dropped on reopen instead of served.
func TestCachePartialNeverPublished(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "renders")
	c, err := OpenCache(dir, 64*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	// Simulate a crash mid-publish: temp dir with partial bytes, no rename.
	tmp, err := os.MkdirTemp(dir, "tmp-")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(tmp, "init.blob"), []byte("partial"), 0o644); err != nil {
		t.Fatal(err)
	}
	// And a directory with bytes but no manifest.json.
	broken := filepath.Join(dir, "broken-entry")
	if err := os.Mkdir(broken, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(broken, "init.blob"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	c2, err := OpenCache(dir, 64*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	if c2.EntryCount() != 0 {
		t.Fatalf("partial entries indexed: %d", c2.EntryCount())
	}
	_ = c
}

// TestCacheSurvivesRestart proves completed entries reload from disk with
// sizes intact (pins are session-scoped and correctly do not persist).
func TestCacheSurvivesRestart(t *testing.T) {
	deps := testDeps(t)
	dir := t.TempDir()
	shared := filepath.Join(dir, "renders")
	c1, err := OpenCache(shared, 64*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	path := genTone(t, dir, "tone.wav", append(sineArgs(2), "-ar", "44100")...)
	ctx, cancel := corpusCtx()
	defer cancel()
	m, key, err := RenderTrack(ctx, FFmpegSettings{}, deps, c1, RenderRequest{
		TrackID: "t", AbsPath: path, Kind: "stream", Extension: "wav",
		SourceRevision: "rev:r", BitrateKbps: 96,
	})
	if err != nil {
		t.Fatal(err)
	}
	c1.Pin(key.String())
	before := c1.TotalBytes()
	c2, err := OpenCache(shared, 64*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := c2.Lookup(key); !ok {
		t.Fatal("entry lost across restart")
	}
	if c2.Pinned(key.String()) != 0 {
		t.Fatal("pins must not persist across restart")
	}
	got, err := c2.StoredManifest(key.String())
	if err != nil || got.RenderID != m.RenderID {
		t.Fatalf("manifest mismatch across restart: %+v %v", got, err)
	}
	if c2.TotalBytes() != before {
		t.Fatalf("size mismatch across restart: %d vs %d", c2.TotalBytes(), before)
	}
}
