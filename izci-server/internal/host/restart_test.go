package host

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tozworth/izci/izci-server/internal/library"
	"github.com/tozworth/izci/izci-server/internal/media"
	"github.com/tozworth/izci/izci-server/internal/persistence"
)

// TestRestartPreservesIdentityAndCatalog proves restarting preserves server
// identity and catalog stability without persisting live playback machinery
// (peers, clocks, preparation barriers, transfer buffers).
func TestRestartPreservesIdentityAndCatalog(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "state.db")
	musicDir := filepath.Join(dir, "music")
	if err := os.MkdirAll(musicDir, 0o755); err != nil {
		t.Fatal(err)
	}
	abs := filepath.Join(musicDir, "song.mp3")
	if err := os.WriteFile(abs, []byte("audio-bytes-restart"), 0o644); err != nil {
		t.Fatal(err)
	}
	roots, err := library.ResolveRoots([]library.Root{{Mount: "/music", Path: musicDir}})
	if err != nil {
		t.Fatal(err)
	}

	// First boot.
	store1, err := persistence.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	id1, _ := store1.ServerID()
	files1, err := library.Scan(roots, 4)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := store1.Reconcile(files1, []string{"/music"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	tracks1, _ := store1.ListTracks()
	if len(tracks1) != 1 {
		t.Fatalf("tracks1 = %d", len(tracks1))
	}
	stableID := tracks1[0].ID
	cat1 := NewCatalog(50000, 100000)
	h1 := NewHost(HostConfig{
		Name: "test", Catalog: cat1, Policy: media.Policy{Mode: media.ModeAlways},
		Store: store1, ServerID: id1,
	})
	h1.SetLibraryTracks(tracks1, 7)
	attachFakeControl(h1, "alice")
	attachFakeMedia(h1, "alice")
	h1.HandleControlText("alice", sharedHello("alice"))
	h1.HandleControlText("alice", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "collection.activate", "commandId": "c1", "collection": "library", "itemId": stableID},
	}))
	if h1.PeerCount() != 1 {
		t.Fatalf("peer count = %d", h1.PeerCount())
	}
	if cur := h1.SharedSession().CurrentTrackID(); cur == nil {
		t.Fatalf("current must be set before restart")
	}
	h1.persistSharedState()
	_ = store1.Close()

	// Second boot with the same database file.
	store2, err := persistence.Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer store2.Close()
	id2, _ := store2.ServerID()
	if id1 != id2 {
		t.Fatalf("identity changed across restart: %q vs %q", id1, id2)
	}
	files2, err := library.Scan(roots, 4)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, err := store2.Reconcile(files2, []string{"/music"}, time.Now()); err != nil {
		t.Fatal(err)
	}
	tracks2, _ := store2.ListTracks()
	if len(tracks2) != 1 || tracks2[0].ID != stableID {
		t.Fatalf("catalog ID must be stable across restart: %v vs %s", tracks2, stableID)
	}
	cat2 := NewCatalog(50000, 100000)
	h2 := NewHost(HostConfig{
		Name: "test", Catalog: cat2, Policy: media.Policy{Mode: media.ModeAlways},
		Store: store2, ServerID: id2,
	})
	h2.SetLibraryTracks(tracks2, 8)
	if h2.PeerCount() != 0 {
		t.Fatalf("restart must not persist peers")
	}
	if cur := h2.SharedSession().CurrentTrackID(); cur != nil {
		t.Fatalf("restart must not persist live clocks/current playback, got %q", *cur)
	}
	if _, _, prep := h2.SharedSession().Snapshot(); prep != nil {
		t.Fatalf("restart must not persist preparation barriers")
	}
	if h2.CatalogView().Count() != 1 {
		t.Fatalf("catalog must be stable across restart")
	}
	if got, ok := h2.CatalogView().Get(stableID); !ok || got.VirtualPath != "/music/song.mp3" {
		t.Fatalf("stable catalog record missing after restart")
	}
	// Queue stability: library order persists as the shared queue.
	if q := h2.CatalogView().QueueIDs(); len(q) != 1 || q[0] != stableID {
		t.Fatalf("queue must be stable across restart: %v", q)
	}
}
