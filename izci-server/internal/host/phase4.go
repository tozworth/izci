package host

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strings"
	"sync/atomic"
	"time"
	"unicode"

	"github.com/tozworth/izci/izci-server/internal/persistence"
)

type chatTrack struct {
	Collection string `json:"collection"`
	ItemID     string `json:"itemId"`
	Title      string `json:"title"`
}

type chatMessage struct {
	ID     string     `json:"id"`
	Name   string     `json:"name"`
	Text   string     `json:"text"`
	SentAt int64      `json:"sentAt"`
	Action string     `json:"action,omitempty"`
	Track  *chatTrack `json:"track,omitempty"`
}

// HostMetrics contains bounded monotonic operational counters. It deliberately
// contains no identities, paths, room credentials, SDP, or ICE candidates.
type HostMetrics struct {
	PeersAccepted   atomic.Uint64
	PeersRejected   atomic.Uint64
	Commands        atomic.Uint64
	RateLimited     atomic.Uint64
	ChatMessages    atomic.Uint64
	PairProofOK     atomic.Uint64
	PairProofFailed atomic.Uint64
	SourceTransfers atomic.Uint64
	RenderRequests  atomic.Uint64
}

type HostStatus struct {
	Ready             bool
	ShuttingDown      bool
	Peers             int
	FreeplaySessions  int
	CatalogTracks     int
	SignalingAttached bool
	RendererAvailable bool
}

func (h *Host) Status() HostStatus {
	return HostStatus{
		Ready:        !h.shuttingDown.Load() && h.transport != nil,
		ShuttingDown: h.shuttingDown.Load(),
		Peers:        h.PeerCount(), FreeplaySessions: h.sessions.FreeplayCount(),
		CatalogTracks: h.catalog.Count(), SignalingAttached: h.transport != nil,
		RendererAvailable: h.renderCoord != nil && h.renderCache != nil,
	}
}

func (h *Host) MetricsSnapshot() map[string]uint64 {
	out := map[string]uint64{
		"host_peers_accepted_total":    h.metrics.PeersAccepted.Load(),
		"host_peers_rejected_total":    h.metrics.PeersRejected.Load(),
		"host_commands_total":          h.metrics.Commands.Load(),
		"host_rate_limited_total":      h.metrics.RateLimited.Load(),
		"host_chat_messages_total":     h.metrics.ChatMessages.Load(),
		"host_pair_proof_ok_total":     h.metrics.PairProofOK.Load(),
		"host_pair_proof_failed_total": h.metrics.PairProofFailed.Load(),
		"host_source_transfers_total":  h.metrics.SourceTransfers.Load(),
		"host_render_requests_total":   h.metrics.RenderRequests.Load(),
	}
	if h.renderCoord != nil {
		stats := h.renderCoord.Stats()
		out["render_cache_hits_total"] = stats.CacheHits
		out["render_completed_total"] = stats.Rendered
		out["render_failures_total"] = stats.Failures
		out["render_queue_wait_nanoseconds_total"] = stats.QueueWaitNanos
	}
	direct, relay := h.rtc.RouteCounts()
	out["ice_routes_direct_total"] = direct
	out["ice_routes_relay_total"] = relay
	return out
}

func validIdentity(value string) bool {
	if len(value) < 8 || len(value) > 128 {
		return false
	}
	for _, r := range value {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-') {
			return false
		}
	}
	return true
}

func newPairSecret() string {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return ""
	}
	return hex.EncodeToString(raw[:])
}

func (h *Host) loadPairing(identity string) (persistence.PairingRecord, bool) {
	if h.store != nil {
		r, ok, err := h.store.Pairing(identity)
		return r, ok && err == nil
	}
	h.pairMu.Lock()
	defer h.pairMu.Unlock()
	r, ok := h.pairings[identity]
	return r, ok
}

func (h *Host) savePairing(r persistence.PairingRecord) bool {
	if h.store != nil {
		return h.store.SavePairing(r) == nil
	}
	h.pairMu.Lock()
	h.pairings[r.PeerIdentity] = r
	h.pairMu.Unlock()
	return true
}

func (h *Host) establishPair(peer *Peer) {
	peer.mu.Lock()
	identity, name := peer.Identity, peer.Name
	peer.mu.Unlock()
	if !validIdentity(identity) {
		return
	}
	if _, exists := h.loadPairing(identity); exists {
		// Existing pairs must prove possession of their secret. Never resend it
		// merely because an invitation was admitted.
		h.sendPairingState(peer)
		return
	}
	secret := newPairSecret()
	if secret == "" {
		return
	}
	r := persistence.PairingRecord{PeerIdentity: identity, Secret: secret, Name: name, PairedAt: time.Now().UnixMilli(), FreeplayEnabled: peer.FreeplayEnabled, FreeplayRepeat: "off"}
	if !h.savePairing(r) {
		return
	}
	peer.mu.Lock()
	peer.Paired = true
	peer.mu.Unlock()
	if h.permissions != nil {
		h.permissions.SetPaired(peer.ID, true)
	}
	h.sendToPeer(peer, PairSecretMessage(h.serverID, secret))
	h.sendPairingState(peer)
}

func (h *Host) handlePairProof(peer *Peer, raw []byte) {
	var proof struct{ ClientIdentity, HostNonce, GuestNonce, Proof string }
	if json.Unmarshal(raw, &proof) != nil || !validIdentity(proof.ClientIdentity) || !validIdentity(proof.HostNonce) || !validIdentity(proof.GuestNonce) || len(proof.Proof) != 64 {
		h.metrics.PairProofFailed.Add(1)
		return
	}
	peer.mu.Lock()
	identity, nonce, lastNonce := peer.Identity, peer.PairNonce, peer.LastGuestNonce
	peer.mu.Unlock()
	if proof.ClientIdentity != identity || proof.HostNonce != nonce || proof.GuestNonce == lastNonce {
		h.metrics.PairProofFailed.Add(1)
		return
	}
	record, ok := h.loadPairing(identity)
	if !ok {
		h.metrics.PairProofFailed.Add(1)
		h.sendPairingState(peer)
		return
	}
	key, err := hex.DecodeString(record.Secret)
	got, err2 := hex.DecodeString(proof.Proof)
	if err != nil || err2 != nil {
		h.metrics.PairProofFailed.Add(1)
		return
	}
	context := strings.Join([]string{"izci-pair-v1", h.roomID, h.serverID, identity, nonce, proof.GuestNonce}, "|")
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(context))
	if !hmac.Equal(mac.Sum(nil), got) {
		h.metrics.PairProofFailed.Add(1)
		return
	}
	peer.mu.Lock()
	peer.Paired = true
	peer.LastGuestNonce = proof.GuestNonce
	if record.Name != "" {
		peer.Name = record.Name
	}
	peer.mu.Unlock()
	if h.permissions != nil {
		h.permissions.SetPaired(peer.ID, true)
	}
	h.metrics.PairProofOK.Add(1)
	h.sendPairingState(peer)
	if record.FreeplayEnabled {
		h.handleFreeplayPreference(peer, true)
	}
}

func (h *Host) sendPairingState(peer *Peer) {
	peer.mu.Lock()
	paired, freeplay, name := peer.Paired, peer.FreeplayActive, peer.Name
	peer.mu.Unlock()
	h.sendToPeer(peer, PairingMessage(paired, freeplay, h.serverID, name))
}

func (h *Host) restorePairPreferences(peer *Peer) bool {
	peer.mu.Lock()
	paired, identity := peer.Paired, peer.Identity
	peer.mu.Unlock()
	if !paired {
		return false
	}
	r, ok := h.loadPairing(identity)
	if !ok {
		return false
	}
	sess := h.sessions.FreeplayFor(peer.ID)
	filtered := make([]string, 0, len(r.FreeplayQueue))
	for _, id := range r.FreeplayQueue {
		if h.catalog.HasTrack(id) {
			filtered = append(filtered, id)
		}
	}
	sess.SetQueue(filtered)
	sess.RestorePreferences(r.FreeplayShuffle, RepeatMode(r.FreeplayRepeat))
	return r.FreeplayEnabled
}

func (h *Host) persistPairPreferences(peer *Peer) {
	peer.mu.Lock()
	enabled := peer.FreeplayActive
	peer.mu.Unlock()
	h.persistPairPreferencesEnabled(peer, enabled)
}

func (h *Host) persistPairPreferencesEnabled(peer *Peer, enabled bool) {
	peer.mu.Lock()
	paired, identity, name := peer.Paired, peer.Identity, peer.Name
	peer.mu.Unlock()
	if !paired {
		return
	}
	r, ok := h.loadPairing(identity)
	if !ok {
		return
	}
	sess := h.sessions.FreeplayFor(peer.ID)
	r.Name, r.FreeplayEnabled, r.FreeplayQueue = name, enabled, sess.Queue()
	r.FreeplayShuffle, r.FreeplayRepeat = sess.ShuffleEnabled(), string(sess.RepeatMode())
	h.savePairing(r)
}

func cleanChatText(value string, max int) string {
	value = strings.TrimSpace(value)
	var b strings.Builder
	for _, r := range value {
		if !unicode.IsControl(r) {
			b.WriteRune(r)
		}
	}
	out := []rune(b.String())
	if len(out) > max {
		out = out[:max]
	}
	return strings.TrimSpace(string(out))
}

func (h *Host) handleChatSend(peer *Peer, raw []byte) {
	if !h.cfg.ChatEnabled {
		return
	}
	var body struct {
		Text, Action string
		Track        *chatTrack
	}
	if json.Unmarshal(raw, &body) != nil {
		return
	}
	text := cleanChatText(body.Text, 500)
	if text == "" {
		return
	}
	if body.Action != "" && body.Action != "now-playing" {
		return
	}
	if body.Action == "now-playing" && (body.Track == nil || !h.catalog.HasTrack(body.Track.ItemID)) {
		return
	}
	peer.mu.Lock()
	name := peer.Name
	peer.mu.Unlock()
	m := chatMessage{ID: newChatID(), Name: cleanChatText(name, 48), Text: text, SentAt: time.Now().UnixMilli(), Action: body.Action, Track: body.Track}
	if m.Track != nil {
		m.Track.Title = cleanChatText(m.Track.Title, 500)
	}
	h.appendChat(m)
	h.metrics.ChatMessages.Add(1)
	h.broadcastAll(ChatMessage(m))
}

func newChatID() string {
	var raw [12]byte
	_, _ = rand.Read(raw[:])
	return hex.EncodeToString(raw[:])
}

func (h *Host) appendChat(m chatMessage) {
	h.chatMu.Lock()
	defer h.chatMu.Unlock()
	h.chatHistory = append(h.chatHistory, m)
	if len(h.chatHistory) > h.cfg.MaxChatHistory {
		h.chatHistory = append([]chatMessage(nil), h.chatHistory[len(h.chatHistory)-h.cfg.MaxChatHistory:]...)
	}
}

func (h *Host) sendChatHistory(peer *Peer) {
	if !h.cfg.ChatEnabled {
		return
	}
	h.chatMu.Lock()
	history := append([]chatMessage(nil), h.chatHistory...)
	h.chatMu.Unlock()
	h.sendToPeer(peer, ChatHistoryMessage(history))
}

func (h *Host) announcePresence(name, action string) {
	if !h.cfg.ChatEnabled || name == "" {
		return
	}
	m := chatMessage{ID: newChatID(), Name: cleanChatText(name, 48), Text: cleanChatText(name, 48), SentAt: time.Now().UnixMilli(), Action: action}
	h.appendChat(m)
	h.broadcastAll(ChatMessage(m))
}

func (h *Host) broadcastAll(text string) {
	h.peersMu.Lock()
	peers := make([]*Peer, 0, len(h.peers))
	for _, p := range h.peers {
		peers = append(peers, p)
	}
	h.peersMu.Unlock()
	for _, p := range peers {
		p.mu.Lock()
		hello := p.HelloReceived
		p.mu.Unlock()
		if hello {
			h.sendToPeer(p, text)
		}
	}
}

func (h *Host) sendArtwork(peer *Peer, delivery Delivery) {
	if delivery.TrackID == nil || h.artwork == nil {
		h.sendToPeer(peer, ArtworkMessage(nil))
		return
	}
	track, ok := h.catalog.Get(*delivery.TrackID)
	if !ok {
		h.sendToPeer(peer, ArtworkMessage(nil))
		return
	}
	generation := delivery.GenerationID
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		artwork, err := h.artwork.Extract(ctx, track.ID, track.SourceRevision, track.FilesystemPath)
		if err != nil {
			h.sendToPeer(peer, ArtworkMessage(nil))
			return
		}
		peer.mu.Lock()
		freeplay := peer.FreeplayActive
		peer.mu.Unlock()
		sess := h.sessions.Shared()
		if freeplay {
			sess = h.sessions.FreeplayFor(peer.ID)
		}
		_, current, _ := sess.Snapshot()
		if current.GenerationID != generation {
			return
		}
		h.sendToPeer(peer, ArtworkMessage(artwork))
	}()
}
