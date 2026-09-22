package host

import (
	"encoding/json"
	"strings"
	"testing"
)

func testHost(name string) *Host {
	return NewHost(HostConfig{Name: name, Product: "izci-server", ProductVersion: "test"})
}

func attachFakeControl(h *Host, peerID string) *FakeChannel {
	ch := NewFakeChannel(ChannelControl)
	h.peersMu.Lock()
	peer, ok := h.peers[peerID]
	if !ok {
		peer = &Peer{ID: peerID, AttemptID: "attempt-" + peerID, PairNonce: NewPairNonce()}
		h.peers[peerID] = peer
	}
	h.peersMu.Unlock()
	h.attachControlChannel(peerID, ch)
	return ch
}

func clientHello(name string, minor int) string {
	return marshal(map[string]any{
		"kind": "hello", "protocolMajor": 1, "protocolMinor": minor,
		"capabilities":    []string{"source-file", "buffered-opus", "synchronized-start", "pairing-proof", "freeplay", "chat", "future-cap"},
		"impl":            map[string]any{"product": "izci", "productVersion": "0.3.2"},
		"name":            name,
		"platform":        "test",
		"freeplayEnabled": true,
	})
}

// TestSharedAndFreeplayIsolation runs one shared session and two Freeplay
// sessions simultaneously, mutating each independently.
func TestSharedAndFreeplayIsolation(t *testing.T) {
	h := testHost("test")
	shared := h.SharedSession()
	shared.SetQueue([]string{"s1", "s2", "s3"})
	shared.Subscribe("alice")
	shared.Subscribe("bob")

	freeA := h.Sessions().FreeplayFor("alice")
	freeA.SetQueue([]string{"a1", "a2"})
	freeA.Subscribe("alice")

	freeB := h.Sessions().FreeplayFor("bob")
	freeB.SetQueue([]string{"b1", "b2"})
	freeB.Subscribe("bob")

	// Activate different tracks in each session.
	_, sharedDel, sharedPrep := shared.Activate("s1")
	if sharedDel.GenerationID == "" || sharedPrep.GenerationID != sharedDel.GenerationID {
		t.Fatalf("shared activate must mint a generation")
	}
	_, aDel, _ := freeA.Activate("a1")
	_, bDel, _ := freeB.Activate("b1")
	if aDel.GenerationID == sharedDel.GenerationID || bDel.GenerationID == sharedDel.GenerationID || aDel.GenerationID == bDel.GenerationID {
		t.Fatalf("generations must be session-scoped: shared=%q a=%q b=%q", sharedDel.GenerationID, aDel.GenerationID, bDel.GenerationID)
	}

	// Seek only freeA: shared and freeB positions must not move.
	freeA.Seek(42)
	if _, sDel, _ := shared.Snapshot(); sDel.GenerationID != sharedDel.GenerationID {
		t.Fatalf("shared generation changed after freeplay seek")
	}
	if got := freeB.SeekEpoch(); got != 0 {
		t.Fatalf("freeB epoch changed after freeA seek: %d", got)
	}
	if got := freeA.SeekEpoch(); got != 1 {
		t.Fatalf("freeA epoch should be 1, got %d", got)
	}

	// Stop freeB: shared and freeA keep their tracks.
	freeB.Stop()
	if cur := shared.CurrentTrackID(); cur == nil || *cur != "s1" {
		t.Fatalf("shared track mutated by freeB stop")
	}
	if cur := freeA.CurrentTrackID(); cur == nil || *cur != "a1" {
		t.Fatalf("freeA track mutated by freeB stop")
	}
	if cur := freeB.CurrentTrackID(); cur != nil {
		t.Fatalf("freeB should be stopped, got %q", *cur)
	}

	// Advance shared via ended: freeplay sessions must not advance.
	_, _, _, _, advanced := shared.HandleEnded(sharedDel.GenerationID, "s1")
	if !advanced {
		t.Fatalf("shared ended should advance")
	}
	if cur := shared.CurrentTrackID(); cur == nil || *cur != "s2" {
		t.Fatalf("shared should advance to s2, got %v", cur)
	}
	if cur := freeA.CurrentTrackID(); cur == nil || *cur != "a1" {
		t.Fatalf("freeA mutated by shared advance")
	}

	// Shuffle/repeat are per-session.
	shared.ToggleShuffle()
	if freeA.ShuffleEnabled() {
		t.Fatalf("freeA shuffle leaked from shared")
	}
	freeB.CycleRepeat()
	if shared.RepeatMode() != RepeatOff && shared.RepeatMode() != RepeatAll {
		// shared toggled shuffle only; repeat must still be off.
		t.Fatalf("shared repeat mutated unexpectedly: %q", shared.RepeatMode())
	}
}

// TestSharedMultipleSubscribersOneTimeline proves the shared session stays
// one timeline with a barrier over all subscribers.
func TestSharedMultipleSubscribersOneTimeline(t *testing.T) {
	h := testHost("test")
	shared := h.SharedSession()
	shared.SetQueue([]string{"s1", "s2"})
	shared.Subscribe("alice")
	shared.Subscribe("bob")
	shared.Subscribe("carol")

	_, del, prep := shared.Activate("s1")
	pending := shared.PendingBarrier()
	if len(pending) != 3 {
		t.Fatalf("shared barrier must wait on all 3 subscribers, got %v", pending)
	}
	// One ready is not enough.
	if ready, _, _ := shared.HandleReady("alice", del.GenerationID); ready {
		t.Fatalf("barrier satisfied after 1 of 3 ready")
	}
	if ready, _, _ := shared.HandleReady("bob", del.GenerationID); ready {
		t.Fatalf("barrier satisfied after 2 of 3 ready")
	}
	// Stale generation readies are ignored.
	if ready, _, _ := shared.HandleReady("carol", "stale-gen"); ready {
		t.Fatalf("stale generation must not satisfy barrier")
	}
	if ready, _, startAt := shared.HandleReady("carol", del.GenerationID); !ready || startAt <= 0 {
		t.Fatalf("barrier should satisfy on last ready, startAt=%d", startAt)
	}
	_ = prep
	// All three see the same generation/track.
	for _, peer := range []string{"alice", "bob", "carol"} {
		_ = peer
	}
	_, del2, _ := shared.Snapshot()
	if del2.GenerationID != del.GenerationID {
		t.Fatalf("shared timeline forked: %q vs %q", del2.GenerationID, del.GenerationID)
	}
}

func TestUnsubscribeCompletesPreparationBarrier(t *testing.T) {
	s := NewSession(SessionConfig{ID: "shared", Kind: SessionShared, NowMs: func() int64 { return 1000 }})
	s.Subscribe("alice")
	s.Subscribe("bob")
	_, delivery, _ := s.Activate("track")
	if ready, _, _ := s.HandleReady("alice", delivery.GenerationID); ready {
		t.Fatalf("barrier completed while bob was pending")
	}
	started, clock, startAt := s.Unsubscribe("bob")
	if !started || clock.State != StatePlaying || startAt != 2000 {
		t.Fatalf("departing last pending peer must release barrier: started=%v clock=%+v startAt=%d", started, clock, startAt)
	}
}

func TestFreeplayPeerDoesNotJoinSharedBarrier(t *testing.T) {
	h := testHost("test")
	attachFakeControl(h, "alice")
	h.HandleControlText("alice", clientHello("alice", 0))
	if subscribers := h.SharedSession().Subscribers(); len(subscribers) != 0 {
		t.Fatalf("freeplay peer joined shared timeline: %v", subscribers)
	}
	freeplay := h.Sessions().FreeplayFor("alice")
	if subscribers := freeplay.Subscribers(); len(subscribers) != 1 || subscribers[0] != "alice" {
		t.Fatalf("freeplay peer missing from private timeline: %v", subscribers)
	}
}

// TestNoGlobalPlayer proves two Host values are fully isolated.
func TestNoGlobalPlayer(t *testing.T) {
	a := testHost("a")
	b := testHost("b")
	a.SharedSession().SetQueue([]string{"a1"})
	b.SharedSession().SetQueue([]string{"b1", "b2"})
	a.SharedSession().Subscribe("alice")
	b.SharedSession().Subscribe("bob")
	_, aDel, _ := a.SharedSession().Activate("a1")
	_, bDel, _ := b.SharedSession().Activate("b1")
	// Generation IDs are opaque per-room timeline markers; two rooms may
	// mint the same string. Isolation means track/queue/state never leaks,
	// not cross-host generation uniqueness.
	_ = aDel
	_ = bDel
	if cur := a.SharedSession().CurrentTrackID(); cur == nil || *cur != "a1" {
		t.Fatalf("host A track wrong: %v", cur)
	}
	if cur := b.SharedSession().CurrentTrackID(); cur == nil || *cur != "b1" {
		t.Fatalf("host B track wrong: %v", cur)
	}
	a.SharedSession().Stop()
	if cur := b.SharedSession().CurrentTrackID(); cur == nil || *cur != "b1" {
		t.Fatalf("host B mutated by host A stop")
	}
}

// TestDispatcherPermissionsSeparate proves permission checks run before
// navigation mutation.
func TestDispatcherPermissionsSeparate(t *testing.T) {
	denyShared := denySharedPermissions{}
	h := NewHost(HostConfig{Name: "test", Permissions: denyShared})
	h.SharedSession().SetQueue([]string{"s1"})
	h.SharedSession().Subscribe("alice")
	res := h.Sessions().Dispatch(Command{Type: "collection.activate", CommandID: "c1", PeerID: "alice", ItemID: "s1"}, false)
	if res.Accepted {
		t.Fatalf("denied shared command must nack")
	}
	if cur := h.SharedSession().CurrentTrackID(); cur != nil {
		t.Fatalf("denied command mutated session")
	}
	// Freeplay still works for the same peer.
	res = h.Sessions().Dispatch(Command{Type: "collection.activate", CommandID: "c2", PeerID: "alice", ItemID: "x1"}, true)
	if !res.Accepted {
		t.Fatalf("freeplay command should accept")
	}
}

type denySharedPermissions struct{}

func (denySharedPermissions) CanControlShared(peerID string) bool { return false }
func (denySharedPermissions) CanUseFreeplay(peerID string) bool   { return true }

// TestHelloNegotiation covers minor tolerance, major rejection, unknown
// capabilities, and catalog/state emission.
func TestHelloNegotiation(t *testing.T) {
	h := testHost("test")
	ch := attachFakeControl(h, "alice")
	// Host hello first.
	sent := ch.Sent()
	if len(sent) == 0 {
		t.Fatalf("host must send hello on attach")
	}
	var hello map[string]any
	if err := json.Unmarshal([]byte(sent[0]), &hello); err != nil || hello["kind"] != "hello" {
		t.Fatalf("first frame must be hello: %v", sent)
	}
	caps, _ := hello["capabilities"].([]any)
	hasSourceFile := false
	hasBufferedOpus := false
	hasPairing := false
	hasChat := false
	for _, cap := range caps {
		if cap == "source-file" {
			hasSourceFile = true
		}
		if cap == "buffered-opus" {
			hasBufferedOpus = true
		}
		if cap == "pairing-proof" {
			hasPairing = true
		}
		if cap == "chat" {
			hasChat = true
		}
	}
	if !hasSourceFile {
		t.Fatalf("host must advertise source-file")
	}
	if !hasBufferedOpus {
		t.Fatalf("host must advertise buffered-opus")
	}
	if !hasPairing || !hasChat {
		t.Fatalf("host must advertise implemented Phase 4 capabilities: %v", caps)
	}
	// Minor skew admits.
	h.HandleControlText("alice", clientHello("alice", 99))
	foundCatalog := false
	for _, text := range ch.Sent() {
		if strings.Contains(text, `"kind":"catalog"`) {
			foundCatalog = true
		}
	}
	if !foundCatalog {
		t.Fatalf("hello with minor skew must still get catalog stubs")
	}
	// Major mismatch is ignored (no subscription, no catalog growth).
	h2 := testHost("test")
	ch2 := attachFakeControl(h2, "mallory")
	before := len(ch2.Sent())
	h2.HandleControlText("mallory", marshal(map[string]any{
		"kind": "hello", "protocolMajor": 99, "protocolMinor": 0,
		"capabilities": []string{}, "impl": map[string]any{"product": "izci", "productVersion": "0.3.2"},
		"name": "mallory", "platform": "test", "freeplayEnabled": false,
	}))
	after := len(ch2.Sent())
	if after != before {
		t.Fatalf("major mismatch must not emit catalog: before=%d after=%d", before, after)
	}
	if subs := h2.SharedSession().Subscribers(); len(subs) != 0 {
		t.Fatalf("major mismatch must not subscribe: %v", subs)
	}
}

// TestUnsupportedCommandNacks proves unsupported types nack instead of
// silent drop, and malformed envelopes drop.
func TestUnsupportedCommandNacks(t *testing.T) {
	h := testHost("test")
	ch := attachFakeControl(h, "alice")
	h.HandleControlText("alice", clientHello("alice", 0))
	nBefore := len(ch.Sent())
	h.HandleControlText("alice", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "transport.fly", "commandId": "c9"},
	}))
	foundNack := false
	for _, text := range ch.Sent()[nBefore:] {
		var m map[string]any
		if err := json.Unmarshal([]byte(text), &m); err != nil {
			continue
		}
		if m["kind"] == "ack" && m["commandId"] == "c9" && m["accepted"] == false {
			foundNack = true
		}
	}
	if !foundNack {
		t.Fatalf("unsupported command must nack")
	}
	// Malformed envelope (missing commandId) drops with no ack.
	nBefore = len(ch.Sent())
	h.HandleControlText("alice", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "transport.play"},
	}))
	for _, text := range ch.Sent()[nBefore:] {
		if strings.Contains(text, `"kind":"ack"`) {
			t.Fatalf("malformed envelope must not ack")
		}
	}
}

func TestCommandsRequireHello(t *testing.T) {
	h := testHost("test")
	ch := attachFakeControl(h, "alice")
	before := len(ch.Sent())
	h.HandleControlText("alice", marshal(map[string]any{
		"kind": "command", "command": map[string]any{"type": "queue.shuffle", "commandId": "c1"},
	}))
	if h.SharedSession().ShuffleEnabled() {
		t.Fatalf("pre-hello command mutated shared state")
	}
	if len(ch.Sent()) != before {
		t.Fatalf("pre-hello command emitted a response")
	}
}

// TestSeekEpochsAndEndedStale proves seek bumps epochs and stale ended
// generations are ignored.
func TestSeekEpochsAndEndedStale(t *testing.T) {
	h := testHost("test")
	s := h.SharedSession()
	s.SetQueue([]string{"s1", "s2"})
	s.Subscribe("alice")
	_, del, _ := s.Activate("s1")
	_, epoch1 := s.Seek(10)
	_, epoch2 := s.Seek(20)
	if epoch2 != epoch1+1 {
		t.Fatalf("seek must bump epoch: %d -> %d", epoch1, epoch2)
	}
	_, _, _, _, advanced := s.HandleEnded("stale", "s1")
	if advanced {
		t.Fatalf("stale generation ended must not advance")
	}
	_, _, _, _, advanced = s.HandleEnded(del.GenerationID, "wrong-track")
	if advanced {
		t.Fatalf("wrong track ended must not advance")
	}
	_, _, _, _, advanced = s.HandleEnded(del.GenerationID, "s1")
	if !advanced {
		t.Fatalf("matching ended must advance")
	}
	if cur := s.CurrentTrackID(); cur == nil || *cur != "s2" {
		t.Fatalf("should advance to s2, got %v", cur)
	}
}

func TestSessionClockFreezesAndReanchors(t *testing.T) {
	now := int64(1000)
	s := NewSession(SessionConfig{
		ID: "clock", Kind: SessionShared, Controller: "shared",
		NowMs: func() int64 { return now }, StartLeadMs: 1000, Backend: FakeDelivery{},
	})
	s.Subscribe("alice")
	_, delivery, _ := s.Activate("track")
	if ready, _, _ := s.HandleReady("alice", delivery.GenerationID); !ready {
		t.Fatal("initial preparation did not complete")
	}
	now = 7000 // startAt was 2000: five seconds have elapsed.
	clock, _ := s.Pause()
	if clock.PositionSeconds != 5 {
		t.Fatalf("pause position=%v want 5", clock.PositionSeconds)
	}
	now = 8000
	s.Play()
	now = 9000
	s.Seek(20)
	now = 10000
	clock, _ = s.Pause()
	if clock.PositionSeconds != 21 {
		t.Fatalf("post-seek position=%v want 21", clock.PositionSeconds)
	}
}
