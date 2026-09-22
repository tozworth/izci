package host

import (
	"context"
	"encoding/json"
	"time"

	"github.com/dunsparce9/izci/izci-server/internal/media"
	appProtocol "github.com/dunsparce9/izci/izci-server/internal/protocol"
)

// Buffered-Opus delivery over izci-render, mirroring the browser host
// (multiplayer-host-freeplay syncPeerRenderSource, handlePeerRenderNeed,
// multiplayer-render-transfer schedulePeerRender/flushPeerRender):
//
//   - one coordinator acquisition per generation, shared across sessions;
//   - render.manifest binds cached bytes to the delivery generation;
//   - render.need drives window planning (client-owned epochs adopted);
//   - render.ready releases the preparation barrier (playback.ready alone
//     never releases a render generation);
//   - 16 KiB fragments with 512 KiB high-water backpressure;
//   - sessions pin cache entries independently and never duplicate bytes.

// renderBufferMs is the ahead/protection window before the client reports
// its own. It matches the browser default audio buffer.
const renderBufferMs = 3000

// cancelPeerRender abandons a peer's render work: the acquire waiter (if
// any) is cancelled, the sender loop exits via token, and the pinned entry
// is released. The next generation starts clean; reconnects never resume
// ambiguous bytes.
func (h *Host) cancelPeerRender(peerID string) {
	h.peersMu.Lock()
	peer, ok := h.peers[peerID]
	h.peersMu.Unlock()
	if ok {
		peer.mu.Lock()
		peer.RenderToken++
		peer.mu.Unlock()
	}
	h.rendersMu.Lock()
	if cancel, has := h.renderCancels[peerID]; has {
		cancel()
		delete(h.renderCancels, peerID)
		delete(h.renderTokens, peerID)
	}
	h.rendersMu.Unlock()
	if !ok {
		return
	}
	peer.mu.Lock()
	st := peer.RenderState
	peer.RenderState = nil
	peer.mu.Unlock()
	if st != nil && h.renderCache != nil {
		h.renderCache.Unpin(st.CacheKey)
	}
}

// clearRenderSlot removes a completed acquire only when it still owns the
// per-peer slot. Mirrors clearTransferSlot.
func (h *Host) clearRenderSlot(peerID string, token int) {
	h.rendersMu.Lock()
	if h.renderTokens[peerID] == token {
		delete(h.renderCancels, peerID)
		delete(h.renderTokens, peerID)
	}
	h.rendersMu.Unlock()
}

// manifestJSON renders the wire render.manifest body for one generation.
func manifestJSON(m media.Manifest, generationID string) map[string]any {
	clusters := make([]map[string]any, len(m.Clusters))
	for i, c := range m.Clusters {
		clusters[i] = map[string]any{"index": c.Index, "timeMs": c.TimeMs, "sizeBytes": c.SizeBytes}
	}
	return map[string]any{
		"generationId": generationID, "renderId": m.RenderID,
		"trackId": m.TrackID, "sourceRevision": m.SourceRevision,
		"codec": m.Codec, "container": m.Container,
		"durationMs": m.DurationMs, "bitrateKbps": m.BitrateKbps,
		"clusterDurationMs": m.ClusterDurationMs, "clusters": clusters,
		"initSizeBytes": m.InitSizeBytes, "totalBytes": m.TotalBytes,
	}
}

// playheadMs estimates the session playhead for late joiners: fresh peers
// join at the current position, not at the beginning of the track.
func (h *Host) playheadMs(sess *Session) float64 {
	clock, _, _ := sess.Snapshot()
	ms := clock.PositionSeconds * 1000
	if clock.State == StatePlaying {
		ms += float64(h.nowMs() - clock.StartedAtMs)
	}
	if ms < 0 {
		ms = 0
	}
	return ms
}

// startRenderForPeer begins (or skips, when already current) buffered-Opus
// delivery for one peer. Fresh activations target position 0; late joiners
// target the current playhead. Missing render channels or client
// capability gaps defer to the channel-open and hello paths.
func (h *Host) startRenderForPeer(peerID string, sess *Session, delivery Delivery, freeplay bool, targetMs float64) {
	h.peersMu.Lock()
	peer, ok := h.peers[peerID]
	h.peersMu.Unlock()
	if !ok {
		return
	}
	peer.mu.Lock()
	hello := peer.HelloReceived
	renderCh := peer.Render
	caps := append([]string(nil), peer.Capabilities...)
	if peer.RenderState != nil && delivery.TrackID != nil && peer.RenderState.GenerationID == delivery.GenerationID {
		peer.mu.Unlock()
		return // already flowing for this generation
	}
	peer.RenderToken++
	token := peer.RenderToken
	peer.mu.Unlock()
	if !hello {
		return
	}
	if delivery.Mode != DeliveryRender || delivery.TrackID == nil {
		return
	}
	if h.renderCoord == nil || h.renderCache == nil {
		h.failRenderGeneration(peer, sess, freeplay, delivery, "renderer-unwired")
		return
	}
	if !hasCapability(caps, "buffered-opus") {
		if freeplay {
			h.failRenderGeneration(peer, sess, true, delivery, "client-no-buffered-opus")
		} else {
			// A view/control-only legacy peer must not cancel an otherwise
			// healthy shared render for every capable listener. Treat it as
			// non-blocking for the preparation barrier; its negotiated
			// capabilities already tell it not to expect render bytes.
			h.releaseSharedPeerWithoutRender(peer, sess, delivery)
		}
		return
	}
	if renderCh == nil {
		return
	}
	trackID := *delivery.TrackID
	track, ok := h.catalog.Get(trackID)
	if !ok {
		return
	}
	// Cancel any previous acquire before starting the new one.
	h.rendersMu.Lock()
	if cancel, has := h.renderCancels[peerID]; has {
		cancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	h.renderCancels[peerID] = cancel
	h.renderTokens[peerID] = token
	h.rendersMu.Unlock()

	lane := media.LaneShared
	if freeplay {
		lane = media.LaneFreeplay
	}
	subsong := 0
	if track.Subsong != nil {
		subsong = *track.Subsong
	}
	req := media.RenderRequest{
		TrackID: track.ID, AbsPath: track.FilesystemPath,
		Kind: track.Kind, Extension: track.Extension,
		Subsong: subsong, SourceRevision: track.SourceRevision,
		BitrateKbps: h.renderBitrate,
	}
	go h.acquireRender(peerID, sess, freeplay, token, ctx, lane, req, delivery.GenerationID, targetMs)
}

func (h *Host) releaseSharedPeerWithoutRender(peer *Peer, sess *Session, delivery Delivery) {
	h.log.Printf("izci-server shared render unavailable for peer=%s gen=%s: client lacks buffered-opus", peerIDShort(peer.ID), genIDShort(delivery.GenerationID))
	ready, _, startAt := sess.HandleReady(peer.ID, delivery.GenerationID)
	if !ready {
		return
	}
	trackID := ""
	if delivery.TrackID != nil {
		trackID = *delivery.TrackID
	}
	h.broadcastSharedText(StartMessage(delivery.GenerationID, trackID, 0, startAt))
	h.announceBarrierRelease(peer, false)
}

// acquireRender waits on the coordinator, then either installs the
// peer's render state (manifest + schedule) or runs the failure path
// (source fallback where permitted, generation cancel otherwise).
func (h *Host) acquireRender(peerID string, sess *Session, freeplay bool, token int, ctx context.Context, lane media.Lane, req media.RenderRequest, genID string, targetMs float64) {
	res, err := h.renderCoord.Acquire(ctx, lane, req)
	h.clearRenderSlot(peerID, token)
	h.peersMu.Lock()
	peer, ok := h.peers[peerID]
	h.peersMu.Unlock()
	if !ok {
		return // disconnected; a completed entry stays cached for others
	}
	peer.mu.Lock()
	current := peer.RenderToken
	peer.mu.Unlock()
	if token != current || ctx.Err() != nil {
		return // superseded or disconnected
	}
	if err != nil {
		h.log.Printf("izci-server render failed peer=%s track=%s gen=%s err=%v", peerIDShort(peerID), trackIDShort(req.TrackID), genIDShort(genID), err)
		h.failRenderGeneration(peer, sess, freeplay, Delivery{GenerationID: genID, TrackID: &req.TrackID, Mode: DeliveryRender}, "render-failed")
		return
	}
	h.renderCache.Pin(res.Key.String())
	peer.mu.Lock()
	if peer.RenderToken != token {
		peer.mu.Unlock()
		h.renderCache.Unpin(res.Key.String())
		return
	}
	st := &PeerRenderState{
		GenerationID: genID, RenderID: res.Manifest.RenderID,
		CacheKey: res.Key.String(), Manifest: res.Manifest,
		Epoch: 0, TargetMs: targetMs, AheadMs: renderBufferMs, ProtectionMs: renderBufferMs,
		Sent: map[int]bool{}, ReadyEpoch: -1,
	}
	peer.RenderState = st
	peer.mu.Unlock()
	sess.SetDuration(res.Manifest.DurationMs / 1000)
	h.sendToPeer(peer, RenderManifestMessage(manifestJSON(res.Manifest, genID)))
	h.schedulePeerRender(peerID, sess)
	// Duration travels on the next playback broadcast so seek bars work.
	if freeplay {
		h.sendDeliveryPlayback(peer, true)
	} else {
		h.broadcastShared()
	}
}

// failRenderGeneration handles a render that cannot be delivered.
// Where source transfer is enabled at all, the track pins to source-file
// and a fresh generation delivers it (explicitly permitted fallback);
// where the operator disabled source transfer, the generation cancels
// instead of silently transferring.
func (h *Host) failRenderGeneration(peer *Peer, sess *Session, freeplay bool, delivery Delivery, reason string) {
	_ = reason
	var trackID string
	if delivery.TrackID != nil {
		trackID = *delivery.TrackID
	}
	if trackID != "" && h.policy.AllowsTransfer() && h.policyBackend != nil {
		revision := ""
		if track, ok := h.catalog.Get(trackID); ok {
			revision = track.SourceRevision
		}
		h.policyBackend.ForceSource(trackID, revision)
		h.log.Printf("izci-server render fallback to source peer=%s track=%s gen=%s", peerIDShort(peer.ID), trackIDShort(trackID), genIDShort(delivery.GenerationID))
		h.fallbackToSource(peer, sess, freeplay, trackID, delivery.GenerationID)
		return
	}
	h.log.Printf("izci-server render failed without fallback peer=%s track=%s gen=%s", peerIDShort(peer.ID), trackIDShort(trackID), genIDShort(delivery.GenerationID))
	// Retire the failed generation like a replaced source: cancel frame,
	// idle delivery, and a state broadcast on the affected timeline.
	if !sess.CancelGeneration(delivery.GenerationID) {
		return
	}
	if freeplay {
		h.cancelPeerRender(peer.ID)
		h.sendToPeer(peer, CancelMessage(delivery.GenerationID))
		h.sendDeliveryPlayback(peer, true)
		return
	}
	for _, id := range sess.Subscribers() {
		h.cancelPeerRender(id)
	}
	h.broadcastSharedText(CancelMessage(delivery.GenerationID))
	h.broadcastShared()
	h.persistSharedState()
}

// fallbackToSource starts a fresh source-file generation for a track whose
// render failed, superseding the failed generation exactly like a user
// activation (cancel + prepare + ping + transfer on the right timeline).
// The replacement generation is claimed first via Activate; only then is
// stale work retired, so a concurrent activation can only cause coherent
// generation churn, never a stall with cancelled transfers and no
// generation to serve them.
func (h *Host) fallbackToSource(peer *Peer, sess *Session, freeplay bool, trackID, failedGen string) {
	_, cur, _ := sess.Snapshot()
	if cur.GenerationID != failedGen {
		return // someone already moved on; their generation owns delivery
	}
	_, replacement, prep := sess.Activate(trackID)
	if freeplay {
		h.cancelPeerTransfer(peer.ID)
		h.cancelPeerRender(peer.ID)
		peer.mu.Lock()
		peer.SourceTrackKey = ""
		peer.RetryGeneration = ""
		peer.RetryCount = 0
		peer.mu.Unlock()
	} else {
		for _, id := range sess.Subscribers() {
			h.cancelPeerTransfer(id)
			h.cancelPeerRender(id)
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
	h.persistSharedState()
	if replacement.Mode != DeliverySourceFile {
		// Source transfer vanished mid-fallback: retire the replacement
		// instead of stalling its barrier. ForceSource is already set,
		// so this only happens when transfer is disabled entirely.
		if sess.CancelGeneration(replacement.GenerationID) {
			if freeplay {
				h.cancelPeerRender(peer.ID)
				h.sendToPeer(peer, CancelMessage(replacement.GenerationID))
				h.sendDeliveryPlayback(peer, true)
			} else {
				for _, id := range sess.Subscribers() {
					h.cancelPeerRender(id)
				}
				h.broadcastSharedText(CancelMessage(replacement.GenerationID))
				h.broadcastShared()
				h.persistSharedState()
			}
		}
		return
	}
	if freeplay {
		h.sendDeliveryPlayback(peer, true)
		h.sendToPeer(peer, CancelMessage(failedGen))
		h.sendToPeer(peer, PrepareMessage(prep))
		h.sendToPeer(peer, PingMessage(prep.GenerationID, h.nowMs()))
		h.startFreeplayTransfer(peer, replacement)
		return
	}
	h.broadcastShared()
	h.broadcastSharedText(CancelMessage(failedGen))
	h.broadcastSharedText(PrepareMessage(prep))
	h.broadcastSharedText(PingMessage(prep.GenerationID, h.nowMs()))
	h.startSharedTransfers(replacement)
}

// startSharedRenders fans a render generation out to every subscribed
// shared peer. The coordinator shares one completed or in-flight render;
// each peer gets independent window state, epochs, and backpressure while
// the preparation barrier still waits on all subscribers.
func (h *Host) startSharedRenders(delivery Delivery) {
	if delivery.Mode != DeliveryRender {
		return
	}
	for _, peerID := range h.sessions.Shared().Subscribers() {
		h.startRenderForPeer(peerID, h.sessions.Shared(), delivery, false, 0)
	}
}

// startFreeplayRender starts a render generation for the owning peer only.
// It never touches the shared queue or another peer's session.
func (h *Host) startFreeplayRender(peer *Peer, delivery Delivery, targetMs float64) {
	if delivery.Mode != DeliveryRender {
		return
	}
	h.startRenderForPeer(peer.ID, h.sessions.FreeplayFor(peer.ID), delivery, true, targetMs)
}

// maybeRenderForNewPeer sends the current render generation to a late
// joiner at the current playhead. Reconnects resume through a fresh
// manifest and full window, never by resuming ambiguous bytes.
func (h *Host) maybeRenderForNewPeer(peer *Peer, freeplay bool) {
	var target *Session
	if freeplay {
		target = h.sessions.FreeplayFor(peer.ID)
	} else {
		target = h.sessions.Shared()
	}
	_, delivery, _ := target.Snapshot()
	if delivery.Mode != DeliveryRender || delivery.TrackID == nil {
		return
	}
	subscribed := false
	for _, id := range target.Subscribers() {
		if id == peer.ID {
			subscribed = true
			break
		}
	}
	if !subscribed {
		return
	}
	peer.mu.Lock()
	renderOpen := peer.Render != nil
	peer.mu.Unlock()
	if !renderOpen {
		return // attachRenderChannel retries when the channel opens
	}
	h.startRenderForPeer(peer.ID, target, delivery, freeplay, h.playheadMs(target))
}

// startSessionDelivery routes a fresh delivery to the right transport on
// the right timeline: source-file transfers or render acquisitions,
// shared fan-out or single freeplay peer.
func (h *Host) startSessionDelivery(sess *Session, delivery Delivery, freeplay bool, peer *Peer) {
	switch delivery.Mode {
	case DeliverySourceFile:
		if freeplay {
			h.startFreeplayTransfer(peer, delivery)
		} else {
			h.startSharedTransfers(delivery)
		}
	case DeliveryRender:
		if freeplay {
			h.startFreeplayRender(peer, delivery, 0)
		} else {
			h.startSharedRenders(delivery)
		}
	}
}

// fragmentPayload splits bytes into 16 KiB framed fragments.
func fragmentPayload(renderID string, epoch uint32, clusterIndex uint32, payload []byte) [][]byte {
	var out [][]byte
	for offset := 0; offset < len(payload); offset += media.MaxFragmentBytes {
		end := offset + media.MaxFragmentBytes
		if end > len(payload) {
			end = len(payload)
		}
		chunk := payload[offset:end]
		out = append(out, appProtocol.EncodeRenderFrame(renderID, epoch, clusterIndex, uint32(offset), chunk))
	}
	return out
}

// schedulePeerRender plans the next cluster batch from the peer's window
// state and enqueues fragments, then ensures the sender drains them.
// Planning mirrors the browser's schedulePeerRender: init first (re-sent
// on every need; the client dedups), then the ahead/protection plan,
// gated on channel backpressure at send time.
func (h *Host) schedulePeerRender(peerID string, sess *Session) {
	h.peersMu.Lock()
	peer, ok := h.peers[peerID]
	h.peersMu.Unlock()
	if !ok {
		return
	}
	peer.renderSendMu.Lock()
	defer peer.renderSendMu.Unlock()
	peer.mu.Lock()
	st := peer.RenderState
	tok := peer.RenderToken
	peer.mu.Unlock()
	if st == nil {
		return
	}
	times := make([]float64, len(st.Manifest.Clusters))
	for i, c := range st.Manifest.Clusters {
		times[i] = c.TimeMs
	}
	plan := media.PlanRenderClusters(media.PlanInput{
		ClusterTimeMs: times,
		TargetTimeMs:  st.TargetMs,
		AheadMs:       st.AheadMs,
		PlayheadMs:    h.playheadMs(sess),
		ProtectionMs:  st.ProtectionMs,
		Received:      st.Received,
		Sent:          st.Sent,
	})
	var frames [][]byte
	if !st.InitSent {
		init, err := h.renderCache.ReadInit(st.CacheKey)
		if err != nil {
			h.log.Printf("izci-server render cache read failed peer=%s gen=%s err=%v", peerIDShort(peerID), genIDShort(st.GenerationID), err)
			return
		}
		frames = append(frames, fragmentPayload(st.RenderID, 0, media.InitClusterIndex, init)...)
		st.InitSent = true
	}
	for _, idx := range plan {
		st.Sent[idx] = true
		payload, err := h.renderCache.ReadCluster(st.CacheKey, idx)
		if err != nil {
			h.log.Printf("izci-server render cache read failed peer=%s gen=%s err=%v", peerIDShort(peerID), genIDShort(st.GenerationID), err)
			delete(st.Sent, idx)
			continue
		}
		frames = append(frames, fragmentPayload(st.RenderID, uint32(st.Epoch), uint32(idx), payload)...)
	}
	if len(frames) == 0 {
		return
	}
	peer.mu.Lock()
	if peer.RenderState != st || peer.RenderToken != tok {
		peer.mu.Unlock()
		return // superseded while planning
	}
	st.Outgoing = append(st.Outgoing, frames...)
	startSender := !st.SenderOn
	if startSender {
		st.SenderOn = true
	}
	peer.mu.Unlock()
	if startSender {
		go h.renderSenderLoop(peerID, tok)
	}
}

// renderSenderLoop drains one peer's fragment queue with high-water
// backpressure (send while bufferedAmount < 512 KiB, poll-wait otherwise,
// like the source path). It exits when the queue drains, the channel
// closes, or the generation supersedes; new needs restart it.
func (h *Host) renderSenderLoop(peerID string, tok int) {
	for {
		h.peersMu.Lock()
		peer, ok := h.peers[peerID]
		h.peersMu.Unlock()
		if !ok {
			return
		}
		peer.renderSendMu.Lock()
		peer.mu.Lock()
		st := peer.RenderState
		if st == nil || peer.RenderToken != tok {
			if st != nil {
				st.SenderOn = false
			}
			peer.mu.Unlock()
			peer.renderSendMu.Unlock()
			return
		}
		if len(st.Outgoing) == 0 {
			st.SenderOn = false
			peer.mu.Unlock()
			peer.renderSendMu.Unlock()
			return
		}
		frame := st.Outgoing[0]
		st.Outgoing = st.Outgoing[1:]
		ch := peer.Render
		peer.mu.Unlock()
		peer.renderSendMu.Unlock()
		if ch == nil {
			h.markRenderSenderStopped(peer, st, tok)
			return
		}
		if !h.waitForRenderQueue(peerID, tok, ch) {
			h.markRenderSenderStopped(peer, st, tok)
			return
		}
		if err := ch.SendBinary(frame); err != nil {
			h.markRenderSenderStopped(peer, st, tok)
			peer.renderSendMu.Lock()
			peer.mu.Lock()
			if peer.RenderState == st && peer.RenderToken == tok {
				st.Outgoing = nil
			}
			peer.mu.Unlock()
			peer.renderSendMu.Unlock()
			return
		}
	}
}

func (h *Host) markRenderSenderStopped(peer *Peer, st *PeerRenderState, tok int) {
	peer.mu.Lock()
	defer peer.mu.Unlock()
	if peer.RenderState == st && peer.RenderToken == tok {
		st.SenderOn = false
	}
}

// waitForRenderQueue polls channel backpressure like the source path:
// proceed while bufferedAmount < 512 KiB, ~10ms waits above it. False
// means the generation superseded or the peer vanished.
func (h *Host) waitForRenderQueue(peerID string, tok int, ch DataChannel) bool {
	for ch.BufferedAmount() >= uint64(h.cfg.MaxRenderBufferedBytes) {
		select {
		case <-time.After(10 * time.Millisecond):
		}
		h.peersMu.Lock()
		peer, ok := h.peers[peerID]
		h.peersMu.Unlock()
		if !ok {
			return false
		}
		peer.mu.Lock()
		current := peer.RenderToken
		renderCh := peer.Render
		peer.mu.Unlock()
		if current != tok || renderCh == nil {
			return false
		}
	}
	return true
}

// handleRenderNeed adopts the client's window: generation/render
// ownership is validated, epoch changes reset the sent set and queue,
// init is always re-sent (the client dedups post-append frames), and the
// plan targets the client's seek position plus its ahead window.
func (h *Host) handleRenderNeed(peer *Peer, raw []byte) {
	if !peer.AllowRate("render", h.cfg.MaxRenderNeedsPerMinute, time.Now()) {
		h.metrics.RateLimited.Add(1)
		return
	}
	h.metrics.RenderRequests.Add(1)
	var need struct {
		GenerationID string   `json:"generationId"`
		RenderID     string   `json:"renderId"`
		Epoch        *int     `json:"epoch"`
		TargetTimeMs *float64 `json:"targetTimeMs"`
		AheadMs      *float64 `json:"aheadMs"`
		Ranges       [][2]int `json:"ranges"`
	}
	var body struct {
		Need json.RawMessage `json:"need"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return
	}
	if err := json.Unmarshal(body.Need, &need); err != nil {
		return
	}
	if need.Epoch == nil || *need.Epoch < 0 || len(need.Ranges) > h.cfg.MaxRenderRanges {
		return
	}
	for _, r := range need.Ranges {
		if r[0] < 0 || r[1] < r[0] {
			return
		}
	}
	peer.mu.Lock()
	freeplay := peer.FreeplayActive
	peer.mu.Unlock()
	var sess *Session
	if freeplay {
		sess = h.sessions.FreeplayFor(peer.ID)
	} else {
		sess = h.sessions.Shared()
	}
	_, delivery, _ := sess.Snapshot()
	if delivery.GenerationID != need.GenerationID || delivery.Mode != DeliveryRender {
		return // stale generation: never serve ambiguous bytes
	}
	peer.renderSendMu.Lock()
	peer.mu.Lock()
	st := peer.RenderState
	if st == nil || st.GenerationID != need.GenerationID || st.RenderID != need.RenderID {
		peer.mu.Unlock()
		peer.renderSendMu.Unlock()
		return
	}
	if *need.Epoch != st.Epoch {
		st.Epoch = *need.Epoch
		st.Sent = map[int]bool{}
		st.Outgoing = nil
	}
	// The init rides the unordered render channel and can beat the
	// manifest (ordered control); re-send on every need so a client that
	// dropped it never stalls. The client dedups post-append init frames.
	st.InitSent = false
	if need.TargetTimeMs != nil && *need.TargetTimeMs >= 0 {
		st.TargetMs = *need.TargetTimeMs
	}
	if need.AheadMs != nil && *need.AheadMs >= 0 {
		st.AheadMs = *need.AheadMs
	}
	st.Received = append([][2]int(nil), need.Ranges...)
	peer.mu.Unlock()
	peer.renderSendMu.Unlock()
	h.schedulePeerRender(peer.ID, sess)
	peer.mu.Lock()
	peer.LastActivity = time.Now()
	peer.mu.Unlock()
}

// handleRenderReady releases the preparation barrier for render
// generations, deduped per generation+epoch. playback.ready alone never
// releases a render generation (mirrors the browser host's verifiedRender
// gate).
func (h *Host) handleRenderReady(peer *Peer, raw []byte) {
	var body struct {
		GenerationID string `json:"generationId"`
		RenderID     string `json:"renderId"`
		Epoch        *int   `json:"epoch"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		return
	}
	if body.Epoch == nil || *body.Epoch < 0 {
		return
	}
	peer.renderSendMu.Lock()
	peer.mu.Lock()
	freeplay := peer.FreeplayActive
	st := peer.RenderState
	if st == nil || st.GenerationID != body.GenerationID || st.RenderID != body.RenderID || st.Epoch != *body.Epoch {
		peer.mu.Unlock()
		peer.renderSendMu.Unlock()
		return
	}
	if st.ReadyGen == body.GenerationID && st.ReadyEpoch == *body.Epoch {
		peer.mu.Unlock()
		peer.renderSendMu.Unlock()
		return // duplicate ready: report barrier state without mutation
	}
	st.ReadyGen = body.GenerationID
	st.ReadyEpoch = *body.Epoch
	peer.LastActivity = time.Now()
	peer.mu.Unlock()
	peer.renderSendMu.Unlock()
	var target *Session
	if freeplay {
		target = h.sessions.FreeplayFor(peer.ID)
	} else {
		target = h.sessions.Shared()
	}
	ready, _, startAt := target.HandleReady(peer.ID, body.GenerationID)
	if !ready {
		return
	}
	_, delivery, _ := target.Snapshot()
	trackID := ""
	if delivery.TrackID != nil {
		trackID = *delivery.TrackID
	}
	start := StartMessage(body.GenerationID, trackID, 0, startAt)
	if freeplay {
		h.sendToPeer(peer, start)
		h.announceBarrierRelease(peer, true)
		return
	}
	h.broadcastSharedText(start)
	h.announceBarrierRelease(peer, false)
}
