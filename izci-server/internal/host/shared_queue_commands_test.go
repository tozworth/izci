package host

import (
	"slices"
	"testing"

	"github.com/tozworth/izci/izci-server/internal/library"
)

func TestSharedQueueCommandsKeepCatalogAndNavigationTogether(t *testing.T) {
	h := testHost("queue-edit")
	tracks := []*library.Track{
		{ID: "a", VirtualPath: "/a.opus", Name: "a.opus", Extension: "opus", Kind: "stream"},
		{ID: "b", VirtualPath: "/b.opus", Name: "b.opus", Extension: "opus", Kind: "stream"},
		{ID: "c", VirtualPath: "/c.opus", Name: "c.opus", Extension: "opus", Kind: "stream"},
	}
	h.catalog.Load(tracks, []string{"a", "b"}, 1)
	h.sessions.Shared().SetQueue(h.catalog.QueueIDs())
	h.sessions.Shared().Activate("a")
	check := func(want []string) {
		t.Helper()
		if got := h.catalog.QueueIDs(); !slices.Equal(got, want) {
			t.Fatalf("catalog queue = %v, want %v", got, want)
		}
		if got := h.sessions.Shared().Queue(); !slices.Equal(got, want) {
			t.Fatalf("session queue = %v, want %v", got, want)
		}
	}
	if !h.applySharedQueueCommand("alice", "queue.add", []string{"c"}) {
		t.Fatal("add rejected")
	}
	copyID := h.catalog.QueueIDs()[2]
	if source, ok := queueCopySourceID(copyID); !ok || source != "c" {
		t.Fatalf("added queue ID = %q", copyID)
	}
	check([]string{"a", "b", copyID})
	if !h.applySharedQueueCommand("alice", "queue.add", []string{"a"}) {
		t.Fatal("duplicate add rejected")
	}
	duplicateID := h.catalog.QueueIDs()[3]
	if duplicateID == "a" || duplicateID == copyID {
		t.Fatalf("duplicate queue identity = %q", duplicateID)
	}
	if !h.applySharedQueueCommand("alice", "queue.remove", []string{duplicateID}) {
		t.Fatal("duplicate remove rejected")
	}
	check([]string{"a", "b", copyID})
	_, lib, _ := h.catalog.Snapshot()
	if len(lib) != 3 || h.catalog.Count() != 3 {
		t.Fatal("queue copy leaked into library")
	}
	reloaded := NewCatalog(50000, 100000)
	reloaded.Load(tracks, h.catalog.QueueIDs(), 2)
	if got, ok := reloaded.Get(copyID); !ok || got.Name != "c.opus" {
		t.Fatalf("queue copy lost on reload: %v", got)
	}
	if !h.applySharedQueueCommand("alice", "queue.remove", []string{copyID}) {
		t.Fatal("remove copy rejected")
	}
	check([]string{"a", "b"})
	if !h.applySharedQueueCommand("alice", "queue.play-next", []string{"c"}) {
		t.Fatal("play next rejected")
	}
	check([]string{"a", "c", "b"})
	h.sessions.Shared().Next()
	if current := h.sessions.Shared().CurrentTrackID(); current == nil || *current != "c" {
		t.Fatalf("next track = %v", current)
	}
	if !h.applySharedQueueCommand("alice", "queue.remove", []string{"c"}) {
		t.Fatal("remove rejected")
	}
	check([]string{"a", "b"})
	if !h.applySharedQueueCommand("alice", "queue.replace", []string{"b"}) {
		t.Fatal("replace rejected")
	}
	check([]string{"b"})
}

func TestExplicitEmptyCatalogQueueDoesNotRepopulate(t *testing.T) {
	catalog := NewCatalog(50000, 100000)
	tracks := []*library.Track{{ID: "a", VirtualPath: "/a.opus", Name: "a.opus", Extension: "opus", Kind: "stream"}}
	catalog.Load(tracks, []string{}, 1)
	if len(catalog.QueueIDs()) != 0 {
		t.Fatalf("explicitly empty queue was refilled: %v", catalog.QueueIDs())
	}
}
