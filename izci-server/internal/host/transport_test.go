package host

import (
	"strings"
	"testing"
	"time"
)

// TestTransportSequencingWithRealFiles exercises queue activation, transport
// controls, seeks, next/previous, repeat, shuffle, play-next, and ended
// handling against the real catalog and source-file delivery.
func TestTransportSequencingWithRealFiles(t *testing.T) {
	h, ids := testHostWithLibrary(t, map[string]string{
		"/music/a.mp3": "aaa",
		"/music/b.mp3": "bbb",
		"/music/c.mp3": "ccc",
	})
	aID, bID, cID := ids["/music/a.mp3"], ids["/music/b.mp3"], ids["/music/c.mp3"]
	attachFakeControl(h, "alice")
	attachFakeMedia(h, "alice")
	h.HandleControlText("alice", sharedHello("alice"))
	ctrl := getControl(h, "alice")

	activate := func(itemID, cmdID string) string {
		nBefore := len(ctrl.Sent())
		h.HandleControlText("alice", marshal(map[string]any{
			"kind": "command", "command": map[string]any{"type": "collection.activate", "commandId": cmdID, "collection": "library", "itemId": itemID},
		}))
		for _, text := range ctrl.Sent()[nBefore:] {
			m := decodeKind(t, text)
			if m["kind"] == "ack" && m["commandId"] == cmdID && m["accepted"] != true {
				t.Fatalf("activate %s must ack", itemID)
			}
		}
		var gen string
		waitFor(t, 5*time.Second, func() bool {
			gen = latestGeneration(t, ctrl)
			return gen != ""
		}, "generation after activate")
		waitFor(t, 5*time.Second, func() bool {
			return getMedia(h, "alice").BinaryBytes() > 0
		}, "transfer after activate")
		// Ready to release the barrier so the next command starts fresh.
		h.HandleControlText("alice", marshal(map[string]any{"kind": "playback.ready", "generationId": gen}))
		waitFor(t, 5*time.Second, func() bool {
			return hasStartWithGen(ctrl, gen)
		}, "start after ready")
		return gen
	}

	genA := activate(aID, "act-a")
	if cur := h.SharedSession().CurrentTrackID(); cur == nil || *cur != aID {
		t.Fatalf("current = %v, want %s", cur, aID)
	}

	// Seek bumps the epoch and broadcasts a new playback snapshot without a
	// new transfer (source-file seeks are client-local).
	epochBefore := h.SharedSession().SeekEpoch()
	h.HandleControlText("alice", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "transport.seek", "commandId": "seek1", "seconds": 42},
	}))
	if epoch := h.SharedSession().SeekEpoch(); epoch != epochBefore+1 {
		t.Fatalf("seek epoch = %d, want %d", epoch, epochBefore+1)
	}

	// Next advances to b with a new generation + transfer.
	nBefore := len(ctrl.Sent())
	h.HandleControlText("alice", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "transport.next", "commandId": "next1"},
	}))
	foundAck := false
	for _, text := range ctrl.Sent()[nBefore:] {
		m := decodeKind(t, text)
		if m["kind"] == "ack" && m["commandId"] == "next1" && m["accepted"] == true {
			foundAck = true
		}
	}
	if !foundAck {
		t.Fatalf("next must ack")
	}
	var genB string
	waitFor(t, 5*time.Second, func() bool {
		genB = latestGeneration(t, ctrl)
		return genB != "" && genB != genA
	}, "next generation")
	if cur := h.SharedSession().CurrentTrackID(); cur == nil || *cur != bID {
		t.Fatalf("after next current = %v, want %s", cur, bID)
	}
	h.HandleControlText("alice", marshal(map[string]any{"kind": "playback.ready", "generationId": genB}))
	waitFor(t, 5*time.Second, func() bool { return hasStartWithGen(ctrl, genB) }, "start after next")

	// Previous returns to a.
	h.HandleControlText("alice", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "transport.previous", "commandId": "prev1"},
	}))
	waitFor(t, 5*time.Second, func() bool {
		if cur := h.SharedSession().CurrentTrackID(); cur != nil && *cur == aID {
			return true
		}
		return false
	}, "previous to a")

	// Shuffle and repeat are per-session and broadcast via state.
	h.HandleControlText("alice", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "queue.shuffle", "commandId": "sh1"},
	}))
	if !h.SharedSession().ShuffleEnabled() {
		t.Fatalf("shuffle must enable")
	}
	h.HandleControlText("alice", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "queue.repeat", "commandId": "rep1"},
	}))
	if h.SharedSession().RepeatMode() == "off" {
		t.Fatalf("repeat must cycle off->all")
	}

	// Play-next inserts c; ended on b then advances through upNext.
	h.HandleControlText("alice", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "queue.play-next", "commandId": "pn1", "collection": "queue", "itemIds": []string{cID}},
	}))
	// Current is a; force ended on the current generation to advance.
	_, delivery, _ := h.SharedSession().Snapshot()
	h.HandleControlText("alice", marshal(map[string]any{
		"kind": "playback.ended", "generationId": delivery.GenerationID, "trackId": *delivery.TrackID,
	}))
	waitFor(t, 5*time.Second, func() bool {
		if cur := h.SharedSession().CurrentTrackID(); cur != nil && *cur == cID {
			return true
		}
		return false
	}, "ended must advance through play-next to c")

	// Pause/resume/stop sequencing.
	h.HandleControlText("alice", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "transport.pause", "commandId": "pa1"},
	}))
	h.HandleControlText("alice", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "transport.play", "commandId": "pl1"},
	}))
	h.HandleControlText("alice", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "transport.stop", "commandId": "st1"},
	}))
	if cur := h.SharedSession().CurrentTrackID(); cur != nil {
		t.Fatalf("stop must clear current, got %q", *cur)
	}
	_ = bID
	_ = strings.Repeat
}

func TestCatalogLimitsApplied(t *testing.T) {
	// Build 5 tracks directly via library.Track.
	h, _ := testHostWithLibrary(t, map[string]string{
		"/music/1.mp3": "1",
		"/music/2.mp3": "2",
		"/music/3.mp3": "3",
		"/music/4.mp3": "4",
		"/music/5.mp3": "5",
	})
	// Shrink bounds and re-snapshot.
	h.catalog.maxPer = 2
	h.catalog.maxTotal = 3
	q, lib, favs := h.catalog.Snapshot()
	if len(q) > 2 || len(lib) > 2 {
		t.Fatalf("per-collection cap: q=%d lib=%d", len(q), len(lib))
	}
	if len(q)+len(lib)+len(favs) > 3 {
		t.Fatalf("total cap: %d+%d+%d", len(q), len(lib), len(favs))
	}
}

func TestCatalogSnapshotDoesNotAdvanceRevision(t *testing.T) {
	h, _ := testHostWithLibrary(t, map[string]string{"/music/a.mp3": "a"})
	if got := h.catalogRevision.Load(); got != 1 {
		t.Fatalf("initial revision = %d", got)
	}
	attachFakeControl(h, "alice")
	h.HandleControlText("alice", sharedHello("alice"))
	attachFakeControl(h, "bob")
	h.HandleControlText("bob", sharedHello("bob"))
	if got := h.catalogRevision.Load(); got != 1 {
		t.Fatalf("sending snapshots advanced revision to %d", got)
	}
}
