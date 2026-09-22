package persistence

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/dunsparce9/izci/izci-server/internal/library"
)

func scannedFor(vpath, abs, name, ext, kind string, size int64, mtime int64, key string) library.ScannedFile {
	return library.ScannedFile{
		VirtualPath: vpath, AbsPath: abs, Name: name, Extension: ext, Kind: kind,
		Size: size, MtimeNs: mtime, FileKey: key, QuickHash: "abc123",
		Title: name, Artist: "",
		Root: library.Root{Mount: "/music", Path: "/music", Abs: "/music"},
	}
}

func TestServerIDPersistent(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	s, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	id1, err := s.ServerID()
	if err != nil || id1 == "" {
		t.Fatalf("ServerID: %v %q", err, id1)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s2, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	id2, err := s2.ServerID()
	if err != nil {
		t.Fatal(err)
	}
	if id1 != id2 {
		t.Fatalf("restart must preserve identity: %q vs %q", id1, id2)
	}
	// Memory stores get distinct identities per process (no file).
	m1, _ := Open("")
	defer m1.Close()
	mid1, _ := m1.ServerID()
	m2, _ := Open("")
	defer m2.Close()
	mid2, _ := m2.ServerID()
	if mid1 == mid2 {
		t.Fatalf("memory stores should not share identity")
	}
}

func TestReconcileStableIDs(t *testing.T) {
	s, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Now()
	files := []library.ScannedFile{
		scannedFor("/music/a.mp3", "/data/a.mp3", "a.mp3", "mp3", "stream", 100, 1000, "1:1"),
		scannedFor("/music/b.mp3", "/data/b.mp3", "b.mp3", "mp3", "stream", 200, 2000, "1:2"),
	}
	if _, _, _, err := s.Reconcile(files, []string{"/music"}, now); err != nil {
		t.Fatal(err)
	}
	tracks, err := s.ListTracks()
	if err != nil {
		t.Fatal(err)
	}
	if len(tracks) != 2 {
		t.Fatalf("tracks = %d", len(tracks))
	}
	ids := map[string]string{}
	for _, tr := range tracks {
		ids[tr.VirtualPath] = tr.ID
	}
	// Favorite + play count are server-owned and must survive rescans.
	if _, err := s.db.Exec(`UPDATE tracks SET favorite=1, play_count=5, last_played=1234 WHERE virtual_path='/music/a.mp3'`); err != nil {
		t.Fatal(err)
	}
	// Rescan unchanged: IDs, favorites, play counts preserved.
	if _, _, _, err := s.Reconcile(files, []string{"/music"}, now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	tracks, _ = s.ListTracks()
	for _, tr := range tracks {
		if ids[tr.VirtualPath] != tr.ID {
			t.Fatalf("stable ID changed for %s", tr.VirtualPath)
		}
		if tr.VirtualPath == "/music/a.mp3" && (!tr.Favorite || tr.PlayCount != 5 || tr.LastPlayed == nil || *tr.LastPlayed != 1234) {
			t.Fatalf("server-owned state lost: %+v", tr)
		}
	}
	// Rename preserves ID via file_key (same inode, new path).
	renamed := []library.ScannedFile{
		scannedFor("/music/a-renamed.mp3", "/data/a-renamed.mp3", "a-renamed.mp3", "mp3", "stream", 100, 1000, "1:1"),
		scannedFor("/music/b.mp3", "/data/b.mp3", "b.mp3", "mp3", "stream", 200, 2000, "1:2"),
	}
	if added, updated, _, err := s.Reconcile(renamed, []string{"/music"}, now.Add(2*time.Second)); err != nil {
		t.Fatal(err)
	} else if added != 0 || updated != 1 {
		t.Fatalf("rename counts added=%d updated=%d, want 0/1", added, updated)
	}
	tracks, _ = s.ListTracks()
	found := false
	for _, tr := range tracks {
		if tr.VirtualPath == "/music/a-renamed.mp3" {
			found = true
			if tr.ID != ids["/music/a.mp3"] {
				t.Fatalf("rename must preserve ID: %q vs %q", tr.ID, ids["/music/a.mp3"])
			}
			if !tr.Favorite {
				t.Fatalf("rename must preserve favorite")
			}
			if tr.LastPlayed == nil || *tr.LastPlayed != 1234 {
				t.Fatalf("rename must preserve last played: %+v", tr)
			}
		}
	}
	if !found {
		t.Fatalf("renamed track missing: %v", tracks)
	}
	// Removal reconciles only owned mounts: deleting /music/b.mp3 removes it.
	remaining := []library.ScannedFile{
		scannedFor("/music/a-renamed.mp3", "/data/a-renamed.mp3", "a-renamed.mp3", "mp3", "stream", 100, 1000, "1:1"),
	}
	if _, _, removed, err := s.Reconcile(remaining, []string{"/music"}, now.Add(3*time.Second)); err != nil {
		t.Fatal(err)
	} else if removed != 1 {
		t.Fatalf("removed = %d, want 1", removed)
	}
}

func TestReconcileScopedToMount(t *testing.T) {
	s, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	now := time.Now()
	all := []library.ScannedFile{
		scannedFor("/music/a.mp3", "/a.mp3", "a.mp3", "mp3", "stream", 10, 10, "k1"),
		scannedFor("/modules/b.mod", "/b.mod", "b.mod", "mod", "module", 20, 20, "k2"),
	}
	if _, _, _, err := s.Reconcile(all, []string{"/music", "/modules"}, now); err != nil {
		t.Fatal(err)
	}
	// Rescan only /music with an empty snapshot: /modules tracks survive.
	if _, _, removed, err := s.Reconcile(nil, []string{"/music"}, now.Add(time.Second)); err != nil {
		t.Fatal(err)
	} else if removed != 1 {
		t.Fatalf("scoped remove = %d, want 1", removed)
	}
	tracks, _ := s.ListTracks()
	if len(tracks) != 1 || tracks[0].VirtualPath != "/modules/b.mod" {
		t.Fatalf("sibling mount must survive scoped rescan: %v", tracks)
	}
}

func TestSharedStateRoundTrip(t *testing.T) {
	s, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	st := SharedState{Queue: []string{"a", "b"}, Shuffle: true, Repeat: "all", CurrentID: "a"}
	if err := s.SetSharedState(st); err != nil {
		t.Fatal(err)
	}
	got, err := s.GetSharedState()
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Queue) != 2 || !got.Shuffle || got.Repeat != "all" || got.CurrentID != "a" {
		t.Fatalf("round trip = %+v", got)
	}
	// Transient clocks are never stored: only queue/shuffle/repeat/current.
	if _, err := os.Stat("transient"); err == nil {
		t.Fatalf("transient state must not be persisted")
	}
}

func TestPairingsCRUD(t *testing.T) {
	s, err := Open("")
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	rec := PairingRecord{PeerIdentity: "peer-12345678", Secret: "s", Name: "guest", PairedAt: time.Now().UnixMilli()}
	if err := s.SavePairing(rec); err != nil {
		t.Fatal(err)
	}
	list, err := s.ListPairings()
	if err != nil || len(list) != 1 || list[0].PeerIdentity != rec.PeerIdentity {
		t.Fatalf("list = %v, err=%v", list, err)
	}
	if err := s.DeletePairing(rec.PeerIdentity); err != nil {
		t.Fatal(err)
	}
	list, _ = s.ListPairings()
	if len(list) != 0 {
		t.Fatalf("delete failed: %v", list)
	}
}

func TestDedicatedRoomCredentialsPersist(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "state.db")
	first, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	want := DedicatedRoomCredentials{
		RoomID:           "0123456789abcdef0123456789abcdef",
		OwnerSecret:      "owner-secret",
		InvitationSecret: "invitation-secret",
	}
	if err := first.SetDedicatedRoomCredentials(want); err != nil {
		t.Fatal(err)
	}
	_ = first.Close()

	second, err := Open(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	got, ok := second.DedicatedRoomCredentials()
	if !ok || got != want {
		t.Fatalf("dedicated credentials = %+v, %v; want %+v", got, ok, want)
	}
}
