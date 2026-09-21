package host

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/dunsparce9/izci/izci-server/internal/library"
	"github.com/dunsparce9/izci/izci-server/internal/media"
	"github.com/dunsparce9/izci/izci-server/internal/persistence"
	appProtocol "github.com/dunsparce9/izci/izci-server/internal/protocol"
)

// phase2Capabilities advertises the facilities this host implements:
// source-file transfer plus the session engine. Buffered Opus,
// pairing-proof, and chat land in later phases and are omitted so clients
// degrade through capabilities instead of product-name checks.
var phase2Capabilities = []string{"source-file", "synchronized-start", "freeplay"}

// HostConfig configures the dedicated host.
type HostConfig struct {
	Name           string
	Product        string
	ProductVersion string
	Capabilities   []string
	Logger         *log.Logger
	NowMs          func() int64
	StartLeadMs    int64
	Backend        DeliveryBackend
	Permissions    Permissions
	RTC            RTCConfig
	// Catalog is the persistent library view. When nil, an empty catalog
	// with default bounds is used (tests and signaling-only paths).
	Catalog *Catalog
	// Policy selects source-file vs none per track.
	Policy media.Policy
	// Store persists identity, library, queue, and pairings. Nil keeps
	// everything in memory (tests); a file-backed store preserves
	// identity and catalog stability across restarts.
	Store *persistence.Store
	// ServerID is the persistent host identity for pairing proofs.
	// Empty falls back to "izci-server-host" (per-process, Phase 1 shape).
	ServerID string
	// Deps reports renderer availability for startup diagnostics.
	Deps media.Dependencies
}

// Host is the dedicated host: peers, sessions, RTC answerer, and signaling.
// There is no process-global player; all state lives on the Host value.
type Host struct {
	cfg   HostConfig
	log   *log.Logger
	nowMs func() int64

	sessions *RoomSessions
	peers    map[string]*Peer
	peersMu  sync.Mutex

	rtc *RTCHost

	transport HostSignalingTransport

	catalog  *Catalog
	policy   media.Policy
	store    *persistence.Store
	serverID string

	catalogRevision atomic.Int64
	// attemptID -> peerID for signaling routing.
	attempts   map[string]string
	attemptsMu sync.Mutex

	// transferCancels tracks per-peer source-transfer cancellation so a new
	// generation, retry-supersede, or disconnect aborts stale workers
	// instead of mixing bytes. Guarded by transfersMu, never persisted.
	transfersMu     sync.Mutex
	transferCancels map[string]context.CancelFunc
	transferTokens  map[string]int
}

// NewHost builds a host with one shared session and no peers.
func NewHost(cfg HostConfig) *Host {
	if cfg.Product == "" {
		cfg.Product = "izci-server"
	}
	if cfg.Name == "" {
		cfg.Name = "izci-server"
	}
	if len(cfg.Capabilities) == 0 {
		cfg.Capabilities = append([]string(nil), phase2Capabilities...)
	}
	logger := cfg.Logger
	if logger == nil {
		logger = log.Default()
	}
	nowMs := cfg.NowMs
	if nowMs == nil {
		nowMs = func() int64 { return time.Now().UnixMilli() }
	}
	catalog := cfg.Catalog
	if catalog == nil {
		catalog = NewCatalog(50000, 100000)
	}
	policy := cfg.Policy
	if policy.Mode == "" {
		policy = media.Policy{Mode: media.ModeAlways, MaxBytes: 32 * 1024 * 1024}
	}
	backend := cfg.Backend
	if backend == nil {
		backend = PolicyDelivery{Catalog: catalog, Policy: policy}
	}
	shared := NewSession(SessionConfig{ID: "shared", Kind: SessionShared, Controller: "shared", NowMs: nowMs, StartLeadMs: cfg.StartLeadMs, Backend: backend})
	perms := cfg.Permissions
	if perms == nil {
		perms = OpenPermissions{}
	}
	backendCopy := backend
	newFreeplay := func(peerID string) *Session {
		return NewSession(SessionConfig{ID: "freeplay-" + peerID, Kind: SessionFreeplay, Controller: peerID, NowMs: nowMs, StartLeadMs: cfg.StartLeadMs, Backend: backendCopy})
	}
	serverID := cfg.ServerID
	if serverID == "" {
		serverID = "izci-server-host"
	}
	h := &Host{
		cfg:             cfg,
		log:             logger,
		nowMs:           nowMs,
		sessions:        NewRoomSessions(shared, perms, newFreeplay),
		peers:           make(map[string]*Peer),
		rtc:             NewRTCHost(cfg.RTC),
		catalog:         catalog,
		policy:          policy,
		store:           cfg.Store,
		serverID:        serverID,
		attempts:        make(map[string]string),
		transferCancels: make(map[string]context.CancelFunc),
		transferTokens:  make(map[string]int),
	}
	// Restore persisted shared queue/state into the session engine when a
	// store is present; transient clocks and barriers stay fresh.
	h.restoreSharedState()
	return h
}

// CatalogView exposes the library catalog for tests and status endpoints.
func (h *Host) CatalogView() *Catalog { return h.catalog }

// ServerIdentity returns the persistent host identity.
func (h *Host) ServerIdentity() string { return h.serverID }

// restoreSharedState loads persisted queue/shuffle/repeat/current into the
// shared session and catalog. Failures fall back to library order.
func (h *Host) restoreSharedState() {
	if h.store == nil {
		return
	}
	st, err := h.store.GetSharedState()
	if err != nil {
		return
	}
	if len(st.Queue) > 0 {
		filtered := make([]string, 0, len(st.Queue))
		for _, id := range st.Queue {
			if h.catalog.HasTrack(id) {
				filtered = append(filtered, id)
			}
		}
		if len(filtered) > 0 {
			h.catalog.SetQueue(filtered)
			h.sessions.Shared().SetQueue(filtered)
		}
	}
	// Shuffle/repeat restore through session toggles to keep the single
	// mutation owner (sessions) authoritative.
	if st.Shuffle != h.sessions.Shared().ShuffleEnabled() {
		h.sessions.Shared().ToggleShuffle()
	}
	// Repeat: cycle until it matches (off->all->one->off).
	for i := 0; i < 3 && string(h.sessions.Shared().RepeatMode()) != normalizeRepeat(st.Repeat); i++ {
		h.sessions.Shared().CycleRepeat()
	}
	if st.CurrentID != "" && h.catalog.HasTrack(st.CurrentID) {
		// Do not auto-play on restore; current is informational until the
		// next activation. Sessions start idle; clocks stay transient.
	}
}

func normalizeRepeat(s string) string {
	switch s {
	case "one", "all", "off":
		return s
	default:
		return "off"
	}
}

// persistSharedState saves queue/shuffle/repeat/current without clocks,
// peers, barriers, or transfer buffers.
func (h *Host) persistSharedState() {
	if h.store == nil {
		return
	}
	shared := h.sessions.Shared()
	cur := ""
	if id := shared.CurrentTrackID(); id != nil {
		cur = *id
	}
	_ = h.store.SetSharedState(persistence.SharedState{
		Queue:     h.catalog.QueueIDs(),
		Shuffle:   shared.ShuffleEnabled(),
		Repeat:    string(shared.RepeatMode()),
		CurrentID: cur,
	})
}

// SetLibraryTracks swaps the in-memory catalog from freshly scanned or
// store-loaded tracks, reconciles the shared queue, and bumps the revision.
// Callers persist tracks via persistence.Store.Reconcile first; this keeps
// the session engine's queue stable across rescans.
func (h *Host) SetLibraryTracks(tracks []*library.Track, revision int64) {
	persistedQueue := h.catalog.QueueIDs()
	if h.store != nil {
		if st, err := h.store.GetSharedState(); err == nil && len(st.Queue) > 0 {
			persistedQueue = st.Queue
		}
	}
	h.catalog.Load(tracks, persistedQueue, revision)
	h.catalogRevision.Store(revision)
	// Keep the shared session queue aligned with the persisted catalog
	// queue so next/previous walk the same timeline clients browse.
	h.sessions.Shared().SetQueue(h.catalog.QueueIDs())
	h.persistSharedState()
}

// Sessions exposes the room sessions for tests.
func (h *Host) Sessions() *RoomSessions { return h.sessions }

// SharedSession returns the shared session.
func (h *Host) SharedSession() *Session { return h.sessions.Shared() }

// PeerCount returns the number of connected peers.
func (h *Host) PeerCount() int {
	h.peersMu.Lock()
	defer h.peersMu.Unlock()
	return len(h.peers)
}

// AttachTransport injects the signaling transport (embedded loopback or
// remote). Combined mode injects an embedded transport that dials the local
// endpoints; split mode injects a remote transport. Tests inject fakes.
func (h *Host) AttachTransport(t HostSignalingTransport) {
	h.transport = t
}

// Run acquires a room, connects the host socket, and supervises it until ctx
// ends. A socket drop fails fast so the operator restarts from a known
// state; established RTC peers keep their media until the process exits.
// Signaling reconnect with RTC survival is later work.
func (h *Host) Run(ctx context.Context, capacity int) error {
	if h.transport == nil {
		return errNoTransport
	}
	roomID, err := h.transport.Acquire(ctx, capacity)
	if err != nil {
		return err
	}
	h.log.Printf("izci-server host acquired room %s", redactRoom(roomID))
	if err := h.transport.Connect(ctx, h); err != nil {
		return err
	}
	select {
	case <-ctx.Done():
		_ = h.transport.Close()
		return nil
	case <-h.transport.Done():
		return fmt.Errorf("host: signaling socket closed")
	}
}

type hostError string

func (e hostError) Error() string { return string(e) }

var errNoTransport = hostError("host: no signaling transport attached")

func redactRoom(roomID string) string {
	if len(roomID) <= 8 {
		return "{room}"
	}
	return "{room}"
}

// --- HostSignalingEvents (same lifecycle for embedded and remote) ---

// OnPeerRequested implements HostSignalingEvents.
func (h *Host) OnPeerRequested(connectionID, attemptID string) {
	h.attemptsMu.Lock()
	// One peer object per attempt; identity arrives via RTC hello.
	peerID := NewPeerID()
	h.attempts[attemptID] = peerID
	h.attemptsMu.Unlock()
	peer := &Peer{ID: peerID, AttemptID: attemptID, ConnectionID: connectionID, ConnectedAt: time.Now(), PairNonce: NewPairNonce()}
	h.peersMu.Lock()
	h.peers[peerID] = peer
	h.peersMu.Unlock()
	if h.transport != nil {
		_ = h.transport.Accept(attemptID)
	}
}

// OnOffer implements HostSignalingEvents: answer via Pion and wire channels.
func (h *Host) OnOffer(attemptID, sdp string) {
	peerID := h.peerForAttempt(attemptID)
	if peerID == "" {
		return
	}
	answerCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	answer, err := h.rtc.Answer(answerCtx, AnswerConfig{
		PeerID:   peerID,
		OfferSDP: sdp,
		OnControl: func(ch DataChannel) {
			h.attachControlChannel(peerID, ch)
		},
		OnControlText: func(text string) {
			h.HandleControlText(peerID, text)
		},
		OnMedia: func(ch DataChannel) {
			h.attachMediaChannel(peerID, ch)
		},
		OnRender: func(ch DataChannel) {
			h.attachRenderChannel(peerID, ch)
		},
		OnConnected: func() {
			h.markPeerConnected(peerID)
			if h.transport != nil {
				_ = h.transport.SendConnected(attemptID)
			}
		},
		OnFailed: func() {
			h.reportIceFailure(peerID, attemptID)
		},
	})
	_ = answerCtx
	if err != nil {
		h.log.Printf("izci-server host answer failed peer=%s err=%v", peerIDShort(peerID), err)
		h.removePeer(peerID, attemptID, "answer-failed")
		return
	}
	_ = answer
	if h.transport != nil {
		// Answer SDP comes from the RTC layer; fetch the stored connection's
		// local description via a second call is unnecessary because Answer
		// already returned it.
		_ = h.transport.SendAnswer(attemptID, answer)
	}
}

// OnCandidate implements HostSignalingEvents.
func (h *Host) OnCandidate(attemptID, candidate string, index int, sdpMid string, sdpMLineIndex int) {
	peerID := h.peerForAttempt(attemptID)
	if peerID == "" {
		return
	}
	mid := sdpMid
	mline := uint16(sdpMLineIndex)
	_ = h.rtc.AddICECandidate(peerID, candidate, &mid, &mline)
}

// OnCandidatesEnd implements HostSignalingEvents.
func (h *Host) OnCandidatesEnd(attemptID string) {}

// OnConnected implements HostSignalingEvents (both sides reported connected).
func (h *Host) OnConnected(attemptID string) {
	peerID := h.peerForAttempt(attemptID)
	if peerID == "" {
		return
	}
	h.markPeerConnected(peerID)
}

// OnReady implements HostSignalingEvents: the host socket authenticated.
func (h *Host) OnReady() {
	h.log.Printf("izci-server host signaling ready")
}

// OnReleased implements HostSignalingEvents.
func (h *Host) OnReleased(attemptID, reason string) {
	peerID := h.peerForAttempt(attemptID)
	if peerID == "" {
		return
	}
	h.removePeer(peerID, attemptID, reason)
}

// OnError implements HostSignalingEvents.
func (h *Host) OnError(code string) {
	h.log.Printf("izci-server host signaling error %s", code)
}

// OnSocketClose implements HostSignalingEvents: healthy RTC keeps playing.
func (h *Host) OnSocketClose() {
	h.log.Printf("izci-server host signaling socket closed; RTC peers continue")
}

func (h *Host) peerForAttempt(attemptID string) string {
	h.attemptsMu.Lock()
	defer h.attemptsMu.Unlock()
	return h.attempts[attemptID]
}

func peerIDShort(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}

// markPeerConnected flags liveness; hello still gates catalog/commands.
func (h *Host) markPeerConnected(peerID string) {
	h.peersMu.Lock()
	peer, ok := h.peers[peerID]
	h.peersMu.Unlock()
	if !ok {
		return
	}
	peer.mu.Lock()
	peer.LastActivity = time.Now()
	peer.mu.Unlock()
}

// reportIceFailure logs without SDP/candidates/secrets, closes the RTC peer,
// and frees the slot so the client can restart via a fresh attempt (ICE
// restart). Healthy peers are untouched.
func (h *Host) reportIceFailure(peerID, attemptID string) {
	h.log.Printf("izci-server host ICE failed peer=%s; closing peer for restart", peerIDShort(peerID))
	h.peersMu.Lock()
	peer, ok := h.peers[peerID]
	h.peersMu.Unlock()
	if ok && peer != nil {
		peer.mu.Lock()
		peer.IceFailed = true
		peer.mu.Unlock()
	}
	h.removePeer(peerID, attemptID, "ice-failed")
}

// removePeer cleans up one connection: unsubscribes from shared, drops its
// Freeplay session, closes channels and RTC, and releases the reservation.
// It never touches other peers' sessions.
func (h *Host) removePeer(peerID, attemptID, reason string) {
	h.peersMu.Lock()
	peer, ok := h.peers[peerID]
	if ok {
		delete(h.peers, peerID)
	}
	h.peersMu.Unlock()
	if !ok {
		return
	}
	// Cancel any in-flight transfer first so the worker exits instead of
	// writing to a closed channel; reconnects resume via a fresh
	// generation or retry, never by appending to stale bytes.
	h.cancelPeerTransfer(peerID)
	peer.mu.Lock()
	peer.MediaToken++
	peer.SourceTrackKey = ""
	peer.mu.Unlock()
	h.unsubscribeShared(peerID)
	h.sessions.RemoveFreeplay(peerID)
	peer.mu.Lock()
	control, media, render := peer.Control, peer.Media, peer.Render
	peer.Control, peer.Media, peer.Render = nil, nil, nil
	peer.mu.Unlock()
	if control != nil {
		_ = control.Close()
	}
	if media != nil {
		_ = media.Close()
	}
	if render != nil {
		_ = render.Close()
	}
	h.rtc.ClosePeer(peerID)
	h.attemptsMu.Lock()
	delete(h.attempts, attemptID)
	h.attemptsMu.Unlock()
	if h.transport != nil && (reason == "ice-failed" || reason == "kicked") {
		_ = h.transport.Release(attemptID)
	}
	h.log.Printf("izci-server host peer removed peer=%s reason=%s", peerIDShort(peerID), reason)
	_ = peer
}

// --- Data-channel attachment (answerer/host role) ---

// attachControlChannel binds izci-control (ordered/reliable): hello first,
// then catalog/state stubs, command ack, and session routing.
func (h *Host) attachControlChannel(peerID string, ch DataChannel) {
	h.peersMu.Lock()
	peer, ok := h.peers[peerID]
	h.peersMu.Unlock()
	if !ok {
		_ = ch.Close()
		return
	}
	peer.mu.Lock()
	peer.Control = ch
	peer.mu.Unlock()
	// The RTC adapter invokes this only after the channel is open.
	_ = ch.SendText(HelloMessage(h.cfg.Product, h.cfg.ProductVersion, h.cfg.Name,
		appProtocol.Major, appProtocol.Minor, h.cfg.Capabilities, h.hostIdentity(), peer.PairNonce))
}

// attachMediaChannel binds izci-media (ordered/reliable): source-file
// transfer with begin/chunk/end framing, 16KiB chunks, per-peer
// backpressure, and cancellation tokens. A channel opening mid-generation
// starts the current generation fresh for that peer.
func (h *Host) attachMediaChannel(peerID string, ch DataChannel) {
	h.peersMu.Lock()
	peer, ok := h.peers[peerID]
	h.peersMu.Unlock()
	if !ok {
		_ = ch.Close()
		return
	}
	peer.mu.Lock()
	peer.Media = ch
	// A new media channel always resets transfer state: never resume
	// ambiguous stale bytes after a reconnect.
	peer.SourceTrackKey = ""
	peer.RetryGeneration = ""
	peer.RetryCount = 0
	freeplay := peer.FreeplayActive
	hello := peer.HelloReceived
	peer.mu.Unlock()
	if !hello {
		return
	}
	// Late media open catches the peer up to the current generation.
	h.maybeTransferForNewPeer(peer, freeplay)
}

// attachRenderChannel binds izci-render (unordered/reliable, buffered Opus in
// later phases).
func (h *Host) attachRenderChannel(peerID string, ch DataChannel) {
	h.peersMu.Lock()
	peer, ok := h.peers[peerID]
	h.peersMu.Unlock()
	if !ok {
		_ = ch.Close()
		return
	}
	peer.mu.Lock()
	peer.Render = ch
	peer.mu.Unlock()
}

func (h *Host) hostIdentity() string {
	// Persistent server identity for pairing proofs; falls back to the
	// per-process Phase 1 shape when no store is configured.
	if h.serverID != "" {
		return h.serverID
	}
	return "izci-server-host"
}

// HandleControlText processes one izci-control text frame from a peer. It is
// the single ingress for hello/commands/readiness; Pion and test channels
// both funnel here.
func (h *Host) HandleControlText(peerID, text string) {
	h.peersMu.Lock()
	peer, ok := h.peers[peerID]
	h.peersMu.Unlock()
	if !ok {
		return
	}
	valid, _, _, _ := appProtocol.ValidateMessage([]byte(text))
	if !valid {
		return
	}
	var msg map[string]json.RawMessage
	if err := json.Unmarshal([]byte(text), &msg); err != nil {
		return
	}
	var base struct {
		Kind     string `json:"kind"`
		Critical *bool  `json:"critical"`
	}
	if err := json.Unmarshal([]byte(text), &base); err != nil {
		return
	}
	peer.mu.Lock()
	helloReceived := peer.HelloReceived
	peer.mu.Unlock()
	if (base.Kind == "hello" && helloReceived) || (base.Kind != "hello" && !helloReceived) {
		return
	}
	switch base.Kind {
	case "hello":
		h.handleClientHello(peer, []byte(text))
	case "command":
		h.handleClientCommand(peer, msg)
	case "playback.ready":
		var body struct {
			GenerationID string `json:"generationId"`
		}
		_ = json.Unmarshal([]byte(text), &body)
		h.handleReady(peer, body.GenerationID)
	case "playback.ended":
		var body struct {
			GenerationID string `json:"generationId"`
			TrackID      string `json:"trackId"`
		}
		_ = json.Unmarshal([]byte(text), &body)
		h.handleEnded(peer, body.GenerationID, body.TrackID)
	case "clock.pong":
		// Phase 1 records liveness; offset estimation ships with real
		// synchronized starts in Phase 2.
		peer.mu.Lock()
		peer.LastActivity = time.Now()
		peer.mu.Unlock()
	case "freeplay.preference":
		var body struct {
			Enabled bool `json:"enabled"`
		}
		_ = json.Unmarshal([]byte(text), &body)
		h.handleFreeplayPreference(peer, body.Enabled)
	case "freeplay.queue":
		var body struct {
			ItemIDs []string `json:"itemIds"`
		}
		_ = json.Unmarshal([]byte(text), &body)
		h.handleFreeplayQueue(peer, body.ItemIDs)
	case "source.retry":
		var body struct {
			GenerationID string `json:"generationId"`
		}
		_ = json.Unmarshal([]byte(text), &body)
		h.handleSourceRetry(peer, body.GenerationID)
	case "render.need", "render.ready", "chat.send", "pair.proof", "oda.background.preference":
		// Known kinds with Phase 1 no-op backends: acknowledge liveness,
		// change no session state.
		peer.mu.Lock()
		peer.LastActivity = time.Now()
		peer.mu.Unlock()
	default:
		// Unknown optional kinds are ignored safely; critical unknowns are
		// dropped without failing the connection (negotiation rule in the
		// spec). No state change, no disconnect.
	}
}

func (h *Host) handleClientHello(peer *Peer, raw []byte) {
	var hello struct {
		ProtocolMajor   int      `json:"protocolMajor"`
		ProtocolMinor   int      `json:"protocolMinor"`
		Capabilities    []string `json:"capabilities"`
		Name            string   `json:"name"`
		Platform        string   `json:"platform"`
		FreeplayEnabled bool     `json:"freeplayEnabled"`
		Identity        string   `json:"identity"`
	}
	if err := json.Unmarshal(raw, &hello); err != nil {
		return
	}
	// Admission already checked the major at signaling; recheck here and
	// ignore minor skew (additive only). Unknown capabilities are ignored.
	if !appProtocol.CompatibleHello(hello.ProtocolMajor, hello.Capabilities) {
		return
	}
	name := hello.Name
	if name == "" {
		name = "guest"
	}
	if len(name) > 48 {
		name = name[:48]
	}
	peer.MarkHello(name, hello.FreeplayEnabled, hello.Identity, hello.ProtocolMinor, hello.Capabilities)
	// Reset transfer state on (re)hello: reconnects resume through a new
	// generation or retry, never by appending to stale bytes.
	peer.mu.Lock()
	peer.SourceTrackKey = ""
	peer.RetryGeneration = ""
	peer.RetryCount = 0
	peer.mu.Unlock()
	// Freeplay sessions are independent and do not participate in the
	// shared preparation barrier.
	if hello.FreeplayEnabled && hasCapability(h.cfg.Capabilities, "freeplay") && hasCapability(hello.Capabilities, "freeplay") {
		sess := h.sessions.FreeplayFor(peer.ID)
		sess.Subscribe(peer.ID)
		peer.mu.Lock()
		peer.FreeplayActive = true
		peer.mu.Unlock()
		h.sendCatalogState(peer, true)
		h.sendDeliveryPlayback(peer, true)
		h.maybeTransferForNewPeer(peer, true)
		return
	}
	h.sessions.Shared().Subscribe(peer.ID)
	h.sendCatalogState(peer, false)
	h.sendDeliveryPlayback(peer, false)
	h.maybeTransferForNewPeer(peer, false)
}

func hasCapability(caps []string, want string) bool {
	for _, c := range caps {
		if c == want {
			return true
		}
	}
	return false
}

func (h *Host) handleClientCommand(peer *Peer, msg map[string]json.RawMessage) {
	raw, ok := msg["command"]
	if !ok {
		return
	}
	var cmd struct {
		Type       string   `json:"type"`
		CommandID  string   `json:"commandId"`
		Seconds    *float64 `json:"seconds"`
		Collection string   `json:"collection"`
		ItemID     string   `json:"itemId"`
		ItemIDs    []string `json:"itemIds"`
	}
	if err := json.Unmarshal(raw, &cmd); err != nil {
		return
	}
	if cmd.CommandID == "" {
		return // malformed envelopes are dropped.
	}
	if !IsSupportedCommand(cmd.Type) {
		h.sendToPeer(peer, AckMessage(cmd.CommandID, false, "Unsupported command."))
		return
	}
	peer.mu.Lock()
	freeplay := peer.FreeplayActive
	peer.mu.Unlock()
	// Collection validation before any navigation/state mutation, mirroring
	// the browser host (window-controller): unknown items nack without
	// touching the session.
	if !h.validateCommand(peer, cmd.Type, cmd.Collection, cmd.ItemID, cmd.ItemIDs, freeplay) {
		h.sendToPeer(peer, AckMessage(cmd.CommandID, false, "Track not found."))
		return
	}
	result := h.sessions.Dispatch(Command{
		Type: cmd.Type, CommandID: cmd.CommandID, PeerID: peer.ID,
		Seconds: cmd.Seconds, Collection: cmd.Collection, ItemID: cmd.ItemID, ItemIDs: cmd.ItemIDs,
	}, freeplay)
	h.sendToPeer(peer, AckMessage(cmd.CommandID, result.Accepted, result.Message))
	if !result.Accepted {
		return
	}
	// Any new generation supersedes in-flight transfers for the affected
	// timeline so stale bytes never mix into the new generation.
	if result.Preparation != nil || result.CancelledGen != nil {
		if freeplay {
			h.cancelPeerTransfer(peer.ID)
			peer.mu.Lock()
			peer.SourceTrackKey = ""
			peer.RetryGeneration = ""
			peer.RetryCount = 0
			peer.mu.Unlock()
		} else {
			for _, id := range h.sessions.Shared().Subscribers() {
				h.cancelPeerTransfer(id)
			}
			h.peersMu.Lock()
			for _, p := range h.peers {
				p.mu.Lock()
				if !p.FreeplayActive {
					p.SourceTrackKey = ""
					p.RetryGeneration = ""
					p.RetryCount = 0
				}
				p.mu.Unlock()
			}
			h.peersMu.Unlock()
		}
	}
	h.persistSharedState()
	// Broadcast host-authoritative state to the affected timeline.
	if freeplay {
		h.sendCatalogState(peer, true)
		h.sendDeliveryPlayback(peer, true)
		if result.CancelledGen != nil {
			h.sendToPeer(peer, CancelMessage(*result.CancelledGen))
		}
		if result.Preparation != nil {
			h.sendToPeer(peer, PrepareMessage(*result.Preparation))
			h.sendToPeer(peer, PingMessage(result.Preparation.GenerationID, h.nowMs()))
			_, delivery, _ := h.sessions.FreeplayFor(peer.ID).Snapshot()
			h.startFreeplayTransfer(peer, delivery)
		}
		return
	}
	h.broadcastShared()
	if result.CancelledGen != nil {
		h.broadcastSharedText(CancelMessage(*result.CancelledGen))
	}
	if result.Preparation != nil {
		h.broadcastSharedText(PrepareMessage(*result.Preparation))
		h.broadcastSharedText(PingMessage(result.Preparation.GenerationID, h.nowMs()))
		_, delivery, _ := h.sessions.Shared().Snapshot()
		h.startSharedTransfers(delivery)
	}
}

// validateCommand checks collection/item existence before Dispatch runs any
// navigation or state mutation. Permissions stay separate in the dispatcher.
func (h *Host) validateCommand(peer *Peer, typ, collection, itemID string, itemIDs []string, freeplay bool) bool {
	switch typ {
	case "collection.activate":
		if collection != "queue" && collection != "library" && collection != "favorites" {
			return false
		}
		if itemID == "" || len(itemID) > 200 {
			return false
		}
		if freeplay {
			if collection == "queue" {
				sess := h.sessions.FreeplayFor(peer.ID)
				for _, id := range sess.Queue() {
					if id == itemID {
						return true
					}
				}
				// Freeplay queue may not be populated yet; fall back to
				// catalog existence so library activations still work.
				return h.catalog.HasTrack(itemID)
			}
			if collection == "library" {
				return h.catalog.HasTrack(itemID)
			}
			return h.catalog.HasInCollection("favorites", itemID)
		}
		return h.catalog.HasInCollection(collection, itemID)
	case "queue.play-next":
		if collection != "queue" && collection != "library" && collection != "favorites" {
			return false
		}
		if len(itemIDs) == 0 || len(itemIDs) > 50000 {
			return false
		}
		if freeplay {
			for _, id := range itemIDs {
				if !h.catalog.HasTrack(id) {
					return false
				}
			}
			return true
		}
		// Shared mirrors the browser host: only queue items can be queued
		// next, and every ID must already be in the shared queue.
		if collection != "queue" {
			return false
		}
		for _, id := range itemIDs {
			if !h.catalog.HasInCollection("queue", id) {
				return false
			}
		}
		return true
	case "transport.seek":
		return true // bounds already validated by protocol; duration
		// clamping happens in playback-commands sequencing on the client.
	default:
		return true
	}
}

func (h *Host) handleReady(peer *Peer, generationID string) {
	peer.mu.Lock()
	freeplay := peer.FreeplayActive
	peer.mu.Unlock()
	var target *Session
	if freeplay {
		target = h.sessions.FreeplayFor(peer.ID)
	} else {
		target = h.sessions.Shared()
	}
	ready, clock, startAt := target.HandleReady(peer.ID, generationID)
	if !ready {
		return
	}
	clockCopy := clock
	_ = clockCopy
	// Emit the synchronized start to the ready timeline.
	var trackID string
	_, delivery, _ := target.Snapshot()
	if delivery.TrackID != nil {
		trackID = *delivery.TrackID
	}
	start := StartMessage(generationID, trackID, 0, startAt)
	if freeplay {
		h.sendToPeer(peer, start)
		return
	}
	h.broadcastSharedText(start)
}

func (h *Host) handleEnded(peer *Peer, generationID, trackID string) {
	peer.mu.Lock()
	freeplay := peer.FreeplayActive
	peer.mu.Unlock()
	var target *Session
	if freeplay {
		target = h.sessions.FreeplayFor(peer.ID)
	} else {
		target = h.sessions.Shared()
	}
	_, _, prep, cancelled, advanced := target.HandleEnded(generationID, trackID)
	if !advanced {
		return
	}
	// New ended generation supersedes transfers like any activation.
	if prep != nil || cancelled != nil {
		if freeplay {
			h.cancelPeerTransfer(peer.ID)
			peer.mu.Lock()
			peer.SourceTrackKey = ""
			peer.RetryGeneration = ""
			peer.RetryCount = 0
			peer.mu.Unlock()
		} else {
			for _, id := range h.sessions.Shared().Subscribers() {
				h.cancelPeerTransfer(id)
			}
			h.peersMu.Lock()
			for _, p := range h.peers {
				p.mu.Lock()
				if !p.FreeplayActive {
					p.SourceTrackKey = ""
					p.RetryGeneration = ""
					p.RetryCount = 0
				}
				p.mu.Unlock()
			}
			h.peersMu.Unlock()
		}
	}
	h.persistSharedState()
	if cancelled != nil {
		if freeplay {
			h.sendToPeer(peer, CancelMessage(*cancelled))
		} else {
			h.broadcastSharedText(CancelMessage(*cancelled))
		}
	}
	if prep != nil {
		if freeplay {
			h.sendToPeer(peer, PrepareMessage(*prep))
			h.sendToPeer(peer, PingMessage(prep.GenerationID, h.nowMs()))
			_, delivery, _ := target.Snapshot()
			h.startFreeplayTransfer(peer, delivery)
		} else {
			h.broadcastSharedText(PrepareMessage(*prep))
			h.broadcastSharedText(PingMessage(prep.GenerationID, h.nowMs()))
			_, delivery, _ := target.Snapshot()
			h.startSharedTransfers(delivery)
		}
	}
	if freeplay {
		h.sendDeliveryPlayback(peer, true)
		return
	}
	h.broadcastShared()
}

func (h *Host) handleFreeplayPreference(peer *Peer, enabled bool) {
	peer.mu.Lock()
	peer.FreeplayEnabled = enabled
	peer.mu.Unlock()
	if !enabled {
		h.cancelPeerTransfer(peer.ID)
		peer.mu.Lock()
		peer.FreeplayActive = false
		peer.SourceTrackKey = ""
		peer.RetryGeneration = ""
		peer.RetryCount = 0
		peer.mu.Unlock()
		h.sessions.RemoveFreeplay(peer.ID)
		h.sessions.Shared().Subscribe(peer.ID)
		h.sendCatalogState(peer, false)
		h.sendDeliveryPlayback(peer, false)
		h.maybeTransferForNewPeer(peer, false)
		return
	}
	peer.mu.Lock()
	clientSupportsFreeplay := hasCapability(peer.Capabilities, "freeplay")
	peer.mu.Unlock()
	if !hasCapability(h.cfg.Capabilities, "freeplay") || !clientSupportsFreeplay {
		return
	}
	h.cancelPeerTransfer(peer.ID)
	peer.mu.Lock()
	peer.FreeplayActive = true
	peer.SourceTrackKey = ""
	peer.RetryGeneration = ""
	peer.RetryCount = 0
	peer.mu.Unlock()
	h.unsubscribeShared(peer.ID)
	sess := h.sessions.FreeplayFor(peer.ID)
	sess.Subscribe(peer.ID)
	h.sendCatalogState(peer, true)
	h.sendDeliveryPlayback(peer, true)
	h.maybeTransferForNewPeer(peer, true)
}

func (h *Host) unsubscribeShared(peerID string) {
	started, _, startAt := h.sessions.Shared().Unsubscribe(peerID)
	if !started {
		return
	}
	_, delivery, _ := h.sessions.Shared().Snapshot()
	trackID := ""
	if delivery.TrackID != nil {
		trackID = *delivery.TrackID
	}
	h.broadcastSharedText(StartMessage(delivery.GenerationID, trackID, 0, startAt))
}

func (h *Host) handleFreeplayQueue(peer *Peer, itemIDs []string) {
	peer.mu.Lock()
	active := peer.FreeplayActive
	peer.mu.Unlock()
	if !active {
		return
	}
	sess := h.sessions.FreeplayFor(peer.ID)
	// Bound like the protocol and filter to existing catalog tracks with
	// dedup, mirroring sanitizeFreeplayQueueIds.
	seen := map[string]bool{}
	var filtered []string
	for _, id := range itemIDs {
		if id == "" || len(id) > 200 || seen[id] {
			continue
		}
		if !h.catalog.HasTrack(id) {
			continue
		}
		seen[id] = true
		filtered = append(filtered, id)
		if len(filtered) >= 50000 {
			break
		}
	}
	sess.SetQueue(filtered)
	h.sendCatalogState(peer, true)
}

func (h *Host) sendToPeer(peer *Peer, text string) {
	peer.mu.Lock()
	ch := peer.Control
	peer.mu.Unlock()
	if ch == nil {
		return
	}
	_ = ch.SendText(text)
}

func (h *Host) sendCatalogState(peer *Peer, freeplay bool) {
	var sess *Session
	if freeplay {
		sess = h.sessions.FreeplayFor(peer.ID)
	} else {
		sess = h.sessions.Shared()
	}
	_, _, _ = sess.Snapshot()
	// Sending a snapshot is not a catalog mutation. Revisions advance on
	// reconciliation, not once per peer/hello.
	revision := int(h.catalogRevision.Load())
	// Render the real catalog with limits applied before encoding. Freeplay
	// peers get their private queue but the shared library/favorites.
	if freeplay {
		qIDs := sess.Queue()
		var qItems []map[string]any
		for _, id := range qIDs {
			if t, ok := h.catalog.Get(id); ok {
				qItems = append(qItems, t.TrackItemJSON())
			}
			if len(qItems) >= 50000 {
				break
			}
		}
		_, libItems, favItems := h.catalog.Snapshot()
		h.sendToPeer(peer, CatalogMessageWithItems(revision, qItems, libItems, favItems, sess.ShuffleEnabled(), sess.RepeatMode()))
	} else {
		qItems, libItems, favItems := h.catalog.Snapshot()
		h.sendToPeer(peer, CatalogMessageWithItems(revision, qItems, libItems, favItems, sess.ShuffleEnabled(), sess.RepeatMode()))
	}
	h.sendToPeer(peer, StateMessage(sess.ShuffleEnabled(), sess.RepeatMode()))
}

func (h *Host) sendDeliveryPlayback(peer *Peer, freeplay bool) {
	var sess *Session
	if freeplay {
		sess = h.sessions.FreeplayFor(peer.ID)
	} else {
		sess = h.sessions.Shared()
	}
	clock, delivery, _ := sess.Snapshot()
	var trackItem map[string]any
	if delivery.TrackID != nil {
		if t, ok := h.catalog.Get(*delivery.TrackID); ok {
			trackItem = t.TrackItemJSON()
		}
	}
	h.sendToPeer(peer, DeliveryMessage(delivery))
	h.sendToPeer(peer, PlaybackMessageWithTrack(clock, trackItem, h.nowMs()))
}

func (h *Host) broadcastShared() {
	h.peersMu.Lock()
	peers := make([]*Peer, 0, len(h.peers))
	for _, p := range h.peers {
		peers = append(peers, p)
	}
	h.peersMu.Unlock()
	shared := h.sessions.Shared()
	clock, delivery, _ := shared.Snapshot()
	var trackItem map[string]any
	if delivery.TrackID != nil {
		if t, ok := h.catalog.Get(*delivery.TrackID); ok {
			trackItem = t.TrackItemJSON()
		}
	}
	qItems, libItems, favItems := h.catalog.Snapshot()
	rev := int(h.catalogRevision.Load())
	for _, peer := range peers {
		peer.mu.Lock()
		hello := peer.HelloReceived
		freeplay := peer.FreeplayActive
		ch := peer.Control
		peer.mu.Unlock()
		if !hello || freeplay || ch == nil {
			continue
		}
		_ = ch.SendText(CatalogMessageWithItems(rev, qItems, libItems, favItems, shared.ShuffleEnabled(), shared.RepeatMode()))
		_ = ch.SendText(StateMessage(shared.ShuffleEnabled(), shared.RepeatMode()))
		_ = ch.SendText(DeliveryMessage(delivery))
		_ = ch.SendText(PlaybackMessageWithTrack(clock, trackItem, h.nowMs()))
	}
}

func (h *Host) broadcastSharedText(text string) {
	h.peersMu.Lock()
	peers := make([]*Peer, 0, len(h.peers))
	for _, p := range h.peers {
		peers = append(peers, p)
	}
	h.peersMu.Unlock()
	for _, peer := range peers {
		peer.mu.Lock()
		hello := peer.HelloReceived
		freeplay := peer.FreeplayActive
		ch := peer.Control
		peer.mu.Unlock()
		if !hello || freeplay || ch == nil {
			continue
		}
		_ = ch.SendText(text)
	}
}

// Kick removes a peer and frees its slot; the shared invitation stays
// reusable until rotated.
func (h *Host) Kick(peerID string) {
	h.peersMu.Lock()
	peer, ok := h.peers[peerID]
	h.peersMu.Unlock()
	if !ok {
		return
	}
	h.sendToPeer(peer, marshal(map[string]any{"kind": "kicked"}))
	h.removePeer(peerID, peer.AttemptID, "kicked")
}
