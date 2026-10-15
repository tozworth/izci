package host

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tozworth/izci/izci-server/internal/library"
)

func identityHello(name, identity string, freeplay bool) string {
	return marshal(map[string]any{
		"kind": "hello", "protocolMajor": 1, "protocolMinor": 0,
		"capabilities": []string{"source-file", "buffered-opus", "synchronized-start", "pairing-proof", "freeplay", "chat"},
		"impl":         map[string]any{"product": "izci", "productVersion": "test"},
		"name":         name, "platform": "test", "freeplayEnabled": freeplay, "identity": identity,
	})
}

func commandText(id, typ string) string {
	return marshal(map[string]any{"kind": "command", "command": map[string]any{"commandId": id, "type": typ}})
}

func lastKind(ch *FakeChannel, kind string) map[string]any {
	var found map[string]any
	for _, message := range ch.Messages() {
		if message["kind"] == kind {
			found = message
		}
	}
	return found
}

func TestDedicatedPairingProofAndSharedPolicy(t *testing.T) {
	h := NewHost(HostConfig{Name: "server", ServerID: "server_identity", AutoPair: true, SharedControl: "paired"})
	h.roomID = "0123456789abcdef0123456789abcdef"
	first := attachFakeControl(h, "first")
	h.HandleControlText("first", identityHello("Alice", "client_identity", false))
	secretMessage := lastKind(first, "pair.secret")
	if secretMessage == nil {
		t.Fatal("initial invitation-admitted identity was not paired")
	}
	secret, _ := secretMessage["secret"].(string)
	if len(secret) != 64 {
		t.Fatalf("bad pair secret %q", secret)
	}
	if pairing := lastKind(first, "pairing"); pairing == nil || pairing["paired"] != true {
		t.Fatalf("pairing state = %#v", pairing)
	}

	// Reconnect does not receive the stored secret again and cannot control
	// the shared session until it proves possession using fresh nonces.
	reconnect := attachFakeControl(h, "second")
	h.HandleControlText("second", identityHello("Alice device", "client_identity", false))
	if lastKind(reconnect, "pair.secret") != nil {
		t.Fatal("reconnect leaked existing pair secret")
	}
	h.HandleControlText("second", commandText("before", "transport.toggle"))
	if ack := lastKind(reconnect, "ack"); ack == nil || ack["accepted"] != false {
		t.Fatalf("unproved shared control accepted: %#v", ack)
	}

	h.peersMu.Lock()
	peer := h.peers["second"]
	h.peersMu.Unlock()
	guestNonce := "guest_nonce_1234"
	context := strings.Join([]string{"izci-pair-v1", h.roomID, h.serverID, "client_identity", peer.PairNonce, guestNonce}, "|")
	key, _ := hex.DecodeString(secret)
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(context))
	h.HandleControlText("second", marshal(map[string]any{"kind": "pair.proof", "clientIdentity": "client_identity", "hostNonce": peer.PairNonce, "guestNonce": guestNonce, "proof": hex.EncodeToString(mac.Sum(nil))}))
	h.HandleControlText("second", commandText("after", "transport.toggle"))
	if ack := lastKind(reconnect, "ack"); ack == nil || ack["accepted"] != true {
		t.Fatalf("proved shared control rejected: %#v", ack)
	}
	if h.metrics.PairProofOK.Load() != 1 {
		t.Fatalf("proof metric = %d", h.metrics.PairProofOK.Load())
	}
}

func TestFreeplayPreferencePersistsPerPair(t *testing.T) {
	h := NewHost(HostConfig{Name: "server", ServerID: "server_identity", AutoPair: true})
	ch := attachFakeControl(h, "alice")
	h.HandleControlText("alice", identityHello("Alice", "client_identity", true))
	h.HandleControlText("alice", marshal(map[string]any{"kind": "freeplay.queue", "itemIds": []string{}, "shuffleEnabled": true, "repeatMode": "one"}))
	record, ok := h.loadPairing("client_identity")
	if !ok || !record.FreeplayEnabled || !record.FreeplayShuffle || record.FreeplayRepeat != "one" {
		t.Fatalf("pair preferences = %+v ok=%v", record, ok)
	}
	_ = ch
}

func TestChatPresenceHistoryBounded(t *testing.T) {
	h := NewHost(HostConfig{Name: "server", Motd: "Welcome", MaxChatHistory: 3})
	a := attachFakeControl(h, "alice")
	b := attachFakeControl(h, "bob")
	h.HandleControlText("alice", identityHello("Alice", "alice_identity", false))
	h.HandleControlText("bob", identityHello("Bob", "bob_identity", false))
	for i := 0; i < 5; i++ {
		h.HandleControlText("alice", marshal(map[string]any{"kind": "chat.send", "text": fmt.Sprintf("message %d", i)}))
	}
	if len(h.chatHistory) != 3 {
		t.Fatalf("history = %d, want 3", len(h.chatHistory))
	}
	if motd := lastKind(b, "chat.motd"); motd == nil || motd["motd"] != "Welcome" {
		t.Fatalf("motd = %#v", motd)
	}
	if message := lastKind(b, "chat.message"); message == nil {
		t.Fatal("chat was not broadcast")
	}
	// The wire history remains protocol-valid and bounded.
	var decoded struct {
		Messages []chatMessage `json:"messages"`
	}
	if err := json.Unmarshal([]byte(ChatHistoryMessage(h.chatHistory)), &decoded); err != nil || len(decoded.Messages) != 3 {
		t.Fatalf("history frame: %v %+v", err, decoded)
	}
	_ = a
}

func TestPerPeerCommandRateLimit(t *testing.T) {
	h := NewHost(HostConfig{Name: "server", MaxCommandsPerMinute: 1})
	ch := attachFakeControl(h, "alice")
	h.HandleControlText("alice", identityHello("Alice", "alice_identity", false))
	h.HandleControlText("alice", commandText("one", "transport.toggle"))
	h.HandleControlText("alice", commandText("two", "transport.toggle"))
	ack := lastKind(ch, "ack")
	if ack == nil || ack["accepted"] != false || ack["message"] != "Rate limit exceeded." {
		t.Fatalf("rate ack = %#v", ack)
	}
}

func activateText(id, trackID string) string {
	return marshal(map[string]any{"kind": "command", "command": map[string]any{"commandId": id, "type": "collection.activate", "collection": "library", "itemId": trackID}})
}

func TestSharedAndTwoPairedFreeplayPeersConcurrently(t *testing.T) {
	h := NewHost(HostConfig{Name: "server", ServerID: "server_identity", AutoPair: true, SharedControl: "paired"})
	h.SetLibraryTracks([]*library.Track{
		{ID: "shared-track", Name: "Shared.mp3", Extension: "mp3", Kind: library.KindStream},
		{ID: "alice-track", Name: "Alice.mp3", Extension: "mp3", Kind: library.KindStream},
		{ID: "bob-track", Name: "Bob.mp3", Extension: "mp3", Kind: library.KindStream},
	}, 1)
	for _, spec := range []struct {
		id, identity string
		freeplay     bool
	}{{"controller", "controller_identity", false}, {"alice", "alice_identity", true}, {"bob", "bob_identity", true}} {
		attachFakeControl(h, spec.id)
		h.HandleControlText(spec.id, identityHello(spec.id, spec.identity, spec.freeplay))
	}
	h.HandleControlText("controller", activateText("shared", "shared-track"))
	h.HandleControlText("alice", activateText("alice", "alice-track"))
	h.HandleControlText("bob", activateText("bob", "bob-track"))
	if got := h.SharedSession().CurrentTrackID(); got == nil || *got != "shared-track" {
		t.Fatalf("shared = %v", got)
	}
	if got := h.Sessions().FreeplayFor("alice").CurrentTrackID(); got == nil || *got != "alice-track" {
		t.Fatalf("alice = %v", got)
	}
	if got := h.Sessions().FreeplayFor("bob").CurrentTrackID(); got == nil || *got != "bob-track" {
		t.Fatalf("bob = %v", got)
	}
	// Mutating the shared timeline cannot replace either private generation.
	h.HandleControlText("controller", commandText("pause", "transport.pause"))
	if got := h.Sessions().FreeplayFor("alice").CurrentTrackID(); got == nil || *got != "alice-track" {
		t.Fatal("shared control leaked into Alice Freeplay")
	}
	if got := h.Sessions().FreeplayFor("bob").CurrentTrackID(); got == nil || *got != "bob-track" {
		t.Fatal("shared control leaked into Bob Freeplay")
	}
}

type reconnectTransport struct {
	mu       sync.Mutex
	done     chan struct{}
	connects int
}

func (t *reconnectTransport) Acquire(context.Context, int) (RoomCredentials, error) {
	return RoomCredentials{RoomID: "0123456789abcdef0123456789abcdef", OwnerSecret: "owner", InvitationSecret: "invite"}, nil
}
func (t *reconnectTransport) Maintain(ctx context.Context) error { <-ctx.Done(); return nil }
func (t *reconnectTransport) Connect(context.Context, HostSignalingEvents) error {
	t.mu.Lock()
	t.connects++
	t.done = make(chan struct{})
	t.mu.Unlock()
	return nil
}
func (t *reconnectTransport) Done() <-chan struct{}                              { t.mu.Lock(); defer t.mu.Unlock(); return t.done }
func (t *reconnectTransport) drop()                                              { t.mu.Lock(); close(t.done); t.mu.Unlock() }
func (t *reconnectTransport) count() int                                         { t.mu.Lock(); defer t.mu.Unlock(); return t.connects }
func (*reconnectTransport) Accept(string) error                                  { return nil }
func (*reconnectTransport) Reject(string) error                                  { return nil }
func (*reconnectTransport) Release(string) error                                 { return nil }
func (*reconnectTransport) SendAnswer(string, string) error                      { return nil }
func (*reconnectTransport) SendCandidate(string, string, int, string, int) error { return nil }
func (*reconnectTransport) SendCandidatesEnd(string) error                       { return nil }
func (*reconnectTransport) SendConnected(string) error                           { return nil }
func (*reconnectTransport) Close() error                                         { return nil }

func TestSignalingReconnectKeepsHealthyPeer(t *testing.T) {
	h := NewHost(HostConfig{Name: "server"})
	transport := &reconnectTransport{}
	h.AttachTransport(transport)
	attachFakeControl(h, "alice")
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- h.Run(ctx, 8) }()
	deadline := time.Now().Add(time.Second)
	for transport.count() < 1 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	transport.drop()
	deadline = time.Now().Add(2 * time.Second)
	for transport.count() < 2 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if transport.count() < 2 {
		t.Fatal("signaling did not reconnect")
	}
	if h.PeerCount() != 1 {
		t.Fatal("healthy RTC peer was removed during signaling reconnect")
	}
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}
