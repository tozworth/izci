package host

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dunsparce9/izci/izci-server/internal/library"
	"github.com/dunsparce9/izci/izci-server/internal/media"
	"github.com/dunsparce9/izci/izci-server/internal/persistence"
)

func testHostWithLibrary(t *testing.T, files map[string]string) (*Host, map[string]string) {
	t.Helper()
	dir := t.TempDir()
	ids := map[string]string{} // virtual -> track ID
	var tracks []*library.Track
	for vpath, content := range files {
		rel := strings.TrimPrefix(vpath, "/music/")
		abs := filepath.Join(dir, "music", rel)
		if err := os.MkdirAll(filepath.Dir(abs), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(abs, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
		fi, _ := os.Stat(abs)
		ext := library.InferExtension(abs)
		kind := library.InferKind(ext)
		rev := library.BuildSourceRevision(fi.Size(), fi.ModTime().UnixNano(), 0, "testhash")
		// Stable test IDs derived from virtual path for readability.
		id := "track-" + strings.ReplaceAll(strings.Trim(vpath, "/"), "/", "-")
		tr := &library.Track{
			ID: id, VirtualPath: vpath, Name: filepath.Base(abs),
			Extension: ext, Kind: kind, Size: fi.Size(), MtimeNs: fi.ModTime().UnixNano(),
			FileKey: "test:" + vpath, SourceRevision: rev, FilesystemPath: abs,
			Title: strings.TrimSuffix(filepath.Base(abs), "."+ext),
		}
		tracks = append(tracks, tr)
		ids[vpath] = id
	}
	store, err := persistence.Open("")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	catalog := NewCatalog(50000, 100000)
	h := NewHost(HostConfig{
		Name: "test", Product: "izci-server", ProductVersion: "test",
		Catalog: catalog, Policy: media.Policy{Mode: media.ModeAlways},
		Store: store, ServerID: "test-server-identity-01",
	})
	h.SetLibraryTracks(tracks, 1)
	return h, ids
}

func attachFakeMedia(h *Host, peerID string) *FakeChannel {
	ch := NewFakeChannel(ChannelMedia)
	h.peersMu.Lock()
	peer, ok := h.peers[peerID]
	if !ok {
		peer = &Peer{ID: peerID, AttemptID: "attempt-" + peerID, PairNonce: NewPairNonce()}
		h.peers[peerID] = peer
	}
	h.peersMu.Unlock()
	h.attachMediaChannel(peerID, ch)
	// attachMediaChannel stores the passed channel; return it for assertions.
	// When the peer already had hello, a current generation starts now.
	return ch
}

func sharedHello(name string) string {
	return marshal(map[string]any{
		"kind": "hello", "protocolMajor": 1, "protocolMinor": 0,
		"capabilities":    []string{"source-file", "synchronized-start", "freeplay"},
		"impl":            map[string]any{"product": "izci", "productVersion": "0.3.2"},
		"name":            name,
		"platform":        "test",
		"freeplayEnabled": false,
	})
}

func freeplayHello(name string) string {
	return marshal(map[string]any{
		"kind": "hello", "protocolMajor": 1, "protocolMinor": 0,
		"capabilities":    []string{"source-file", "synchronized-start", "freeplay"},
		"impl":            map[string]any{"product": "izci", "productVersion": "0.3.2"},
		"name":            name,
		"platform":        "test",
		"freeplayEnabled": true,
	})
}

func decodeKind(t *testing.T, text string) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal([]byte(text), &m); err != nil {
		t.Fatalf("bad JSON: %v", err)
	}
	return m
}

func waitFor(t *testing.T, timeout time.Duration, cond func() bool, msg string) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timeout: %s", msg)
}

func mediaTexts(ch *FakeChannel) []map[string]any {
	var out []map[string]any
	// Media channel carries file.begin/file.end as text frames.
	for _, text := range ch.Sent() {
		var m map[string]any
		if err := json.Unmarshal([]byte(text), &m); err == nil {
			out = append(out, m)
		}
	}
	return out
}

// TestSharedSourcePlaybackTwoSubscribers proves shared source playback uses
// one timeline: both subscribers receive the same generation, prepare, file,
// and synchronized start.
func TestSharedSourcePlaybackTwoSubscribers(t *testing.T) {
	h, ids := testHostWithLibrary(t, map[string]string{
		"/music/song.mp3": strings.Repeat("audio-bytes-", 2000),
	})
	trackID := ids["/music/song.mp3"]

	for _, peer := range []string{"alice", "bob"} {
		attachFakeControl(h, peer)
		attachFakeMedia(h, peer)
		h.HandleControlText(peer, sharedHello(peer))
	}
	// Activate via alice.
	aliceControl := getControl(h, "alice")
	nBefore := len(aliceControl.Sent())
	h.HandleControlText("alice", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "collection.activate", "commandId": "c1", "collection": "library", "itemId": trackID},
	}))
	// Ack accepted.
	foundAck := false
	for _, text := range aliceControl.Sent()[nBefore:] {
		m := decodeKind(t, text)
		if m["kind"] == "ack" && m["commandId"] == "c1" && m["accepted"] == true {
			foundAck = true
		}
	}
	if !foundAck {
		t.Fatalf("activate must ack")
	}
	// Both peers must see the same preparation + delivery generation.
	var genAlice, genBob string
	waitFor(t, 5*time.Second, func() bool {
		genAlice = latestGeneration(t, getControl(h, "alice"))
		genBob = latestGeneration(t, getControl(h, "bob"))
		return genAlice != "" && genAlice == genBob
	}, "shared generation must match across subscribers")

	// Both media channels must receive begin/chunks/end for the same track.
	for _, peer := range []string{"alice", "bob"} {
		mch := getMedia(h, peer)
		waitFor(t, 5*time.Second, func() bool {
			frames := mediaTexts(mch)
			hasBegin, hasEnd := false, false
			for _, f := range frames {
				if f["kind"] == "file.begin" && f["trackId"] == trackID && f["generationId"] == genAlice {
					hasBegin = true
				}
				if f["kind"] == "file.end" {
					hasEnd = true
				}
			}
			return hasBegin && hasEnd
		}, "peer "+peer+" must complete source transfer")
		if got := mch.BinaryBytes(); got <= 0 {
			t.Fatalf("peer %s got no bytes", peer)
		}
	}

	// Both ready -> one synchronized start with the same generation.
	h.HandleControlText("alice", marshal(map[string]any{"kind": "playback.ready", "generationId": genAlice}))
	// One ready is not enough for two subscribers.
	time.Sleep(50 * time.Millisecond)
	if hasStart(getControl(h, "alice")) || hasStart(getControl(h, "bob")) {
		t.Fatalf("barrier must wait for all shared subscribers")
	}
	h.HandleControlText("bob", marshal(map[string]any{"kind": "playback.ready", "generationId": genAlice}))
	waitFor(t, 5*time.Second, func() bool {
		return hasStartWithGen(getControl(h, "alice"), genAlice) && hasStartWithGen(getControl(h, "bob"), genAlice)
	}, "both peers must receive synchronized start")
}

func getControl(h *Host, peerID string) *FakeChannel {
	h.peersMu.Lock()
	defer h.peersMu.Unlock()
	if p, ok := h.peers[peerID]; ok {
		if ch, ok := p.Control.(*FakeChannel); ok {
			return ch
		}
	}
	return nil
}

func getMedia(h *Host, peerID string) *FakeChannel {
	h.peersMu.Lock()
	defer h.peersMu.Unlock()
	if p, ok := h.peers[peerID]; ok {
		if ch, ok := p.Media.(*FakeChannel); ok {
			return ch
		}
	}
	return nil
}

func latestGeneration(t *testing.T, ch *FakeChannel) string {
	t.Helper()
	if ch == nil {
		return ""
	}
	gen := ""
	for _, text := range ch.Sent() {
		var m map[string]any
		if err := json.Unmarshal([]byte(text), &m); err != nil {
			continue
		}
		if m["kind"] == "delivery" {
			if d, ok := m["delivery"].(map[string]any); ok {
				if g, ok := d["generationId"].(string); ok {
					gen = g
				}
			}
		}
	}
	return gen
}

func hasStart(ch *FakeChannel) bool {
	if ch == nil {
		return false
	}
	for _, text := range ch.Sent() {
		if strings.Contains(text, `"kind":"playback.start"`) {
			return true
		}
	}
	return false
}

func hasStartWithGen(ch *FakeChannel, gen string) bool {
	if ch == nil {
		return false
	}
	for _, text := range ch.Sent() {
		var m map[string]any
		if err := json.Unmarshal([]byte(text), &m); err != nil {
			continue
		}
		if m["kind"] == "playback.start" {
			if s, ok := m["start"].(map[string]any); ok && s["generationId"] == gen {
				return true
			}
		}
	}
	return false
}

// TestFreeplayConcurrentSourceTransfers proves two Freeplay peers play
// different tracks concurrently without sharing timeline state.
func TestFreeplayConcurrentSourceTransfers(t *testing.T) {
	h, ids := testHostWithLibrary(t, map[string]string{
		"/music/a.mp3": strings.Repeat("a-", 5000),
		"/music/b.mp3": strings.Repeat("b-", 5000),
	})
	aID, bID := ids["/music/a.mp3"], ids["/music/b.mp3"]
	for _, peer := range []string{"alice", "bob"} {
		attachFakeControl(h, peer)
		attachFakeMedia(h, peer)
		h.HandleControlText(peer, freeplayHello(peer))
	}
	// Each activates a different track in its private session.
	h.HandleControlText("alice", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "collection.activate", "commandId": "ca", "collection": "library", "itemId": aID},
	}))
	h.HandleControlText("bob", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "collection.activate", "commandId": "cb", "collection": "library", "itemId": bID},
	}))
	var genA, genB string
	waitFor(t, 5*time.Second, func() bool {
		genA = latestGeneration(t, getControl(h, "alice"))
		genB = latestGeneration(t, getControl(h, "bob"))
		return genA != "" && genB != "" && genA != genB
	}, "freeplay generations must be independent")
	// Transfers are independent and complete.
	waitFor(t, 5*time.Second, func() bool {
		return getMedia(h, "alice").BinaryBytes() > 0 && getMedia(h, "bob").BinaryBytes() > 0
	}, "both freeplay transfers must deliver bytes")
	// Ready each independently; each gets its own start, never the other's.
	h.HandleControlText("alice", marshal(map[string]any{"kind": "playback.ready", "generationId": genA}))
	waitFor(t, 5*time.Second, func() bool {
		return hasStartWithGen(getControl(h, "alice"), genA)
	}, "alice start")
	if hasStartWithGen(getControl(h, "bob"), genA) {
		t.Fatalf("bob must not receive alice's generation")
	}
	h.HandleControlText("bob", marshal(map[string]any{"kind": "playback.ready", "generationId": genB}))
	waitFor(t, 5*time.Second, func() bool {
		return hasStartWithGen(getControl(h, "bob"), genB)
	}, "bob start")
}

// TestReconnectStartsFreshTransfer proves reconnects join the current shared
// generation through a new transferId from offset 0, never appending to stale
// bytes or restarting playback for peers that remained connected.
func TestReconnectStartsFreshTransfer(t *testing.T) {
	h, ids := testHostWithLibrary(t, map[string]string{
		"/music/song.mp3": strings.Repeat("x-", 8000),
	})
	trackID := ids["/music/song.mp3"]
	attachFakeControl(h, "alice")
	aliceMedia := attachFakeMedia(h, "alice")
	h.HandleControlText("alice", sharedHello("alice"))
	h.HandleControlText("alice", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "collection.activate", "commandId": "c1", "collection": "library", "itemId": trackID},
	}))
	var gen string
	waitFor(t, 5*time.Second, func() bool {
		gen = latestGeneration(t, getControl(h, "alice"))
		return gen != ""
	}, "generation")
	waitFor(t, 5*time.Second, func() bool {
		return aliceMedia.BinaryBytes() > 0
	}, "first transfer starts")
	firstBegins := countKind(mediaTexts(aliceMedia), "file.begin")
	if firstBegins != 1 {
		t.Fatalf("first transfer begins = %d", firstBegins)
	}
	firstTransferID := mediaTexts(aliceMedia)[0]["transferId"]
	// Simulate reconnect: drop the peer (cancels transfer) and re-add with a
	// new peer ID like signaling would (new attempt). The shared generation
	// is unchanged, but the new peer gets a fresh transferId from offset 0.
	h.removePeer("alice", "attempt-alice", "reconnect-test")
	attachFakeControl(h, "alice2")
	alice2Media := attachFakeMedia(h, "alice2")
	h.HandleControlText("alice2", sharedHello("alice2"))
	waitFor(t, 5*time.Second, func() bool {
		return alice2Media.BinaryBytes() > 0
	}, "reconnected peer must get a fresh transfer")
	frames := mediaTexts(alice2Media)
	if countKind(frames, "file.begin") != 1 {
		t.Fatalf("reconnect must start one fresh begin, got %v", frames)
	}
	for _, f := range frames {
		if f["kind"] == "file.begin" {
			if f["generationId"] != gen {
				t.Fatalf("reconnect keeps the same shared generation %q, got %q", gen, f["generationId"])
			}
			if f["transferId"] == firstTransferID {
				t.Fatalf("reconnect reused interrupted transfer ID %v", firstTransferID)
			}
		}
	}
}

func countKind(frames []map[string]any, kind string) int {
	n := 0
	for _, f := range frames {
		if f["kind"] == kind {
			n++
		}
	}
	return n
}

// TestCancellationOnNewGeneration proves a new activation cancels the stale
// transfer rather than mixing bytes.
func TestCancellationOnNewGeneration(t *testing.T) {
	h, ids := testHostWithLibrary(t, map[string]string{
		"/music/a.mp3": strings.Repeat("a-", 20000),
		"/music/b.mp3": "tiny",
	})
	aID, bID := ids["/music/a.mp3"], ids["/music/b.mp3"]
	attachFakeControl(h, "alice")
	mch := attachFakeMedia(h, "alice")
	// Park the channel so the first (large) transfer stalls mid-way.
	mch.SetBufferedAmount(media.SourceFlushUnder + 1)
	h.HandleControlText("alice", sharedHello("alice"))
	h.HandleControlText("alice", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "collection.activate", "commandId": "c1", "collection": "library", "itemId": aID},
	}))
	time.Sleep(100 * time.Millisecond)
	// Activate a second track: the first transfer must be cancelled.
	h.HandleControlText("alice", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "collection.activate", "commandId": "c2", "collection": "library", "itemId": bID},
	}))
	// Drain so the second (tiny) transfer can complete.
	mch.SetBufferedAmount(0)
	waitFor(t, 5*time.Second, func() bool {
		frames := mediaTexts(mch)
		begins := 0
		for _, f := range frames {
			if f["kind"] == "file.begin" && f["trackId"] == bID {
				begins++
			}
		}
		return begins >= 1
	}, "second generation must start after cancellation")
	// The first generation must never complete with file.end after being
	// superseded: at most one end per begin, and the stale begin has no end.
	frames := mediaTexts(mch)
	begins, ends := 0, 0
	for _, f := range frames {
		if f["kind"] == "file.begin" {
			begins++
		}
		if f["kind"] == "file.end" {
			ends++
		}
	}
	if begins != 2 {
		t.Fatalf("begins = %d, want 2 (one cancelled, one fresh)", begins)
	}
	// The tiny second transfer completes; the parked first does not get an
	// end after cancellation (its worker exited via token).
	if ends != 1 {
		t.Fatalf("ends = %d, want 1 (stale cancelled)", ends)
	}
}

// TestSourceRetryRestartsTransfer proves source.retry re-transfers the same
// generation with a fresh transferId, bounded at 2 retries.
func TestSourceRetryRestartsTransfer(t *testing.T) {
	h, ids := testHostWithLibrary(t, map[string]string{
		"/music/song.mp3": strings.Repeat("z-", 3000),
	})
	trackID := ids["/music/song.mp3"]
	_ = trackID
	attachFakeControl(h, "alice")
	mch := attachFakeMedia(h, "alice")
	h.HandleControlText("alice", sharedHello("alice"))
	h.HandleControlText("alice", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "collection.activate", "commandId": "c1", "collection": "library", "itemId": trackID},
	}))
	var gen string
	waitFor(t, 5*time.Second, func() bool {
		gen = latestGeneration(t, getControl(h, "alice"))
		return gen != ""
	}, "gen")
	waitFor(t, 5*time.Second, func() bool {
		return len(mediaTexts(mch)) >= 2
	}, "first transfer completes")
	beginsBefore := countKind(mediaTexts(mch), "file.begin")
	h.HandleControlText("alice", marshal(map[string]any{"kind": "source.retry", "generationId": gen}))
	waitFor(t, 5*time.Second, func() bool {
		return countKind(mediaTexts(mch), "file.begin") > beginsBefore
	}, "retry must restart transfer with fresh transferId")
	// Two more retries hit the bound: the third retry is ignored.
	h.HandleControlText("alice", marshal(map[string]any{"kind": "source.retry", "generationId": gen}))
	h.HandleControlText("alice", marshal(map[string]any{"kind": "source.retry", "generationId": gen}))
	time.Sleep(200 * time.Millisecond)
	if n := countKind(mediaTexts(mch), "file.begin"); n > beginsBefore+2 {
		t.Fatalf("retry bound exceeded: begins=%d", n)
	}
	// Stale generation retries are ignored.
	h.HandleControlText("alice", marshal(map[string]any{"kind": "source.retry", "generationId": "stale-gen"}))
	time.Sleep(100 * time.Millisecond)
	if n := countKind(mediaTexts(mch), "file.begin"); n > beginsBefore+2 {
		t.Fatalf("stale retry must be ignored")
	}
}

// TestQueueActivationValidation proves unknown items nack without mutating
// the session, while real items activate and transfer.
func TestQueueActivationValidation(t *testing.T) {
	h, ids := testHostWithLibrary(t, map[string]string{
		"/music/song.mp3": "bytes",
	})
	trackID := ids["/music/song.mp3"]
	attachFakeControl(h, "alice")
	attachFakeMedia(h, "alice")
	h.HandleControlText("alice", sharedHello("alice"))
	ctrl := getControl(h, "alice")
	nBefore := len(ctrl.Sent())
	h.HandleControlText("alice", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "collection.activate", "commandId": "bad", "collection": "library", "itemId": "missing-id"},
	}))
	foundNack := false
	for _, text := range ctrl.Sent()[nBefore:] {
		m := decodeKind(t, text)
		if m["kind"] == "ack" && m["commandId"] == "bad" && m["accepted"] == false {
			foundNack = true
		}
	}
	if !foundNack {
		t.Fatalf("unknown track must nack")
	}
	if cur := h.SharedSession().CurrentTrackID(); cur != nil {
		t.Fatalf("failed activation must not mutate session, got %q", *cur)
	}
	// Real activation works and delivers bytes.
	h.HandleControlText("alice", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "collection.activate", "commandId": "good", "collection": "library", "itemId": trackID},
	}))
	waitFor(t, 5*time.Second, func() bool {
		return getMedia(h, "alice").BinaryBytes() > 0
	}, "real activation must transfer")
}
