package host

import (
	"context"
	"fmt"
	"time"

	"github.com/dunsparce9/izci/izci-server/internal/library"
	"github.com/dunsparce9/izci/izci-server/internal/media"
)

// cancelPeerTransfer aborts any in-flight source transfer for a peer by
// bumping its token and cancelling its context. Stale workers exit without
// mixing bytes; reconnects always start a fresh transferId.
func (h *Host) cancelPeerTransfer(peerID string) {
	h.peersMu.Lock()
	peer, ok := h.peers[peerID]
	h.peersMu.Unlock()
	if !ok {
		h.transfersMu.Lock()
		if cancel, has := h.transferCancels[peerID]; has {
			cancel()
			delete(h.transferCancels, peerID)
			delete(h.transferTokens, peerID)
		}
		h.transfersMu.Unlock()
		return
	}
	peer.mu.Lock()
	peer.MediaToken++
	peer.mu.Unlock()
	h.transfersMu.Lock()
	if cancel, has := h.transferCancels[peerID]; has {
		cancel()
		delete(h.transferCancels, peerID)
		delete(h.transferTokens, peerID)
	}
	h.transfersMu.Unlock()
}

// sourceKey builds the dedup key "<generation>:<track>:<size>:<mtimeNs>".
func sourceKey(generationID, trackID string, size int64, mtimeNs int64) string {
	return fmt.Sprintf("%s:%s:%d:%d", generationID, trackID, size, mtimeNs)
}

// startTransferForPeer begins (or skips, when already current) a source-file
// transfer for one peer. It checks media readiness, dedups via
// SourceTrackKey, enforces the retry bound on the retry path, and streams
// with 16KiB chunks, per-peer backpressure, and replacement detection.
func (h *Host) startTransferForPeer(peerID string, sess *Session, delivery Delivery) {
	h.peersMu.Lock()
	peer, ok := h.peers[peerID]
	h.peersMu.Unlock()
	if !ok {
		return
	}
	peer.mu.Lock()
	hello := peer.HelloReceived
	mediaCh := peer.Media
	peer.mu.Unlock()
	if !hello || mediaCh == nil {
		return
	}
	if delivery.Mode != DeliverySourceFile || delivery.TrackID == nil {
		return
	}
	trackID := *delivery.TrackID
	track, ok := h.catalog.Get(trackID)
	if !ok {
		return
	}
	key := sourceKey(delivery.GenerationID, track.ID, track.Size, track.MtimeNs)
	peer.mu.Lock()
	if peer.SourceTrackKey == key {
		peer.mu.Unlock()
		return
	}
	peer.MediaToken++
	token := peer.MediaToken
	peer.SourceTrackKey = key
	peer.mu.Unlock()

	// Cancel any previous worker for this peer before starting the new one.
	h.transfersMu.Lock()
	if cancel, has := h.transferCancels[peerID]; has {
		cancel()
	}
	ctx, cancel := context.WithCancel(context.Background())
	h.transferCancels[peerID] = cancel
	h.transferTokens[peerID] = token
	h.transfersMu.Unlock()

	go func(t *library.Track, tok int, genID string) {
		peer.mediaSendMu.Lock()
		defer peer.mediaSendMu.Unlock()
		// A replacement transfer may have superseded this goroutine while it
		// waited for the previous sender to leave the channel.
		peer.mu.Lock()
		current := peer.MediaToken
		peer.mu.Unlock()
		if tok != current || ctx.Err() != nil {
			return
		}
		facts := media.FileFacts{Size: t.Size, MtimeNs: t.MtimeNs, FileKey: t.FileKey, Revision: t.SourceRevision}
		mime := media.MimeFor(t.Extension)
		lastMs := t.MtimeNs / 1_000_000
		_, err := media.TransferFile(ctx, mediaCh, t.FilesystemPath, facts, t.ID, genID, t.Name, mime, lastMs)
		if err != nil {
			// Stale workers exit silently; only the current token reports.
			peer.mu.Lock()
			current := peer.MediaToken
			peer.mu.Unlock()
			if tok != current {
				h.clearTransferSlot(peerID, tok)
				return
			}
			if ctx.Err() != nil {
				return // superseded or disconnected
			}
			if _, replaced := err.(*media.ErrReplaced); replaced {
				h.log.Printf("izci-server source replaced during transfer peer=%s track=%s gen=%s", peerIDShort(peerID), trackIDShort(trackID), genIDShort(genID))
				// Retire the stale host generation too. Sending only a cancel
				// frame would leave the session loading forever and let retries
				// associate changed bytes with the old source revision.
				h.cancelReplacedGeneration(peer, genID)
				h.clearTransferSlot(peerID, tok)
				return
			}
			h.log.Printf("izci-server source transfer failed peer=%s track=%s gen=%s err=%v", peerIDShort(peerID), trackIDShort(trackID), genIDShort(genID), err)
			// Clear the key so source.retry restarts rather than deduping.
			peer.mu.Lock()
			if peer.SourceTrackKey == key {
				peer.SourceTrackKey = ""
			}
			peer.mu.Unlock()
			h.clearTransferSlot(peerID, tok)
			return
		}
		// Success: keep SourceTrackKey so redundant triggers dedup; the
		// client acks with playback.ready and the barrier releases.
		h.clearTransferSlot(peerID, tok)
	}(track, token, delivery.GenerationID)
}

func (h *Host) cancelReplacedGeneration(peer *Peer, generationID string) {
	peer.mu.Lock()
	freeplay := peer.FreeplayActive
	peer.mu.Unlock()
	if freeplay {
		target := h.sessions.FreeplayFor(peer.ID)
		if !target.CancelGeneration(generationID) {
			return
		}
		h.cancelPeerTransfer(peer.ID)
		h.sendToPeer(peer, CancelMessage(generationID))
		h.sendDeliveryPlayback(peer, true)
		return
	}
	target := h.sessions.Shared()
	if !target.CancelGeneration(generationID) {
		return
	}
	for _, id := range target.Subscribers() {
		h.cancelPeerTransfer(id)
	}
	h.broadcastSharedText(CancelMessage(generationID))
	h.broadcastShared()
	h.persistSharedState()
}

// clearTransferSlot removes a completed worker only when it still owns the
// per-peer slot. The token map avoids comparing funcs and avoids lock-order
// inversion with cancelPeerTransfer.
func (h *Host) clearTransferSlot(peerID string, token int) {
	h.transfersMu.Lock()
	if h.transferTokens[peerID] == token {
		delete(h.transferCancels, peerID)
		delete(h.transferTokens, peerID)
	}
	h.transfersMu.Unlock()
}

func trackIDShort(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}

func genIDShort(id string) string {
	if len(id) > 12 {
		return id[:12]
	}
	return id
}

// startSharedTransfers fans a source-file generation out to every subscribed
// shared peer with an open media channel. Each peer gets an independent
// transfer (own transferId, backpressure, cancellation); the preparation
// barrier still waits on all subscribers.
func (h *Host) startSharedTransfers(delivery Delivery) {
	if delivery.Mode != DeliverySourceFile {
		return
	}
	for _, peerID := range h.sessions.Shared().Subscribers() {
		h.startTransferForPeer(peerID, h.sessions.Shared(), delivery)
	}
}

// startFreeplayTransfer starts a source-file generation for the owning peer
// only. It never touches the shared queue or another peer's session.
func (h *Host) startFreeplayTransfer(peer *Peer, delivery Delivery) {
	if delivery.Mode != DeliverySourceFile {
		return
	}
	h.startTransferForPeer(peer.ID, h.sessions.FreeplayFor(peer.ID), delivery)
}

// handleSourceRetry restarts a source-file transfer for the same generation
// with a fresh transferId. The client caps at 2 retries per generation; the
// server enforces the same bound and ignores retries for stale generations.
func (h *Host) handleSourceRetry(peer *Peer, generationID string) {
	if generationID == "" {
		return
	}
	peer.mu.Lock()
	freeplay := peer.FreeplayActive
	if peer.RetryGeneration != generationID {
		peer.RetryGeneration = generationID
		peer.RetryCount = 0
	}
	if peer.RetryCount >= 2 {
		peer.mu.Unlock()
		return
	}
	peer.RetryCount++
	// Force a fresh transfer even if the previous attempt completed the key.
	peer.SourceTrackKey = ""
	peer.mu.Unlock()

	var target *Session
	if freeplay {
		target = h.sessions.FreeplayFor(peer.ID)
	} else {
		target = h.sessions.Shared()
	}
	_, delivery, _ := target.Snapshot()
	if delivery.GenerationID != generationID || delivery.Mode != DeliverySourceFile {
		return // stale generation: never append to ambiguous bytes
	}
	if freeplay {
		h.startFreeplayTransfer(peer, delivery)
	} else {
		h.startTransferForPeer(peer.ID, target, delivery)
	}
}

// maybeTransferForNewPeer sends the current source-file generation to a
// late joiner (fresh transferId, full file from offset 0). Reconnects resume
// through this path or a new generation, never by appending to stale bytes.
func (h *Host) maybeTransferForNewPeer(peer *Peer, freeplay bool) {
	var target *Session
	if freeplay {
		target = h.sessions.FreeplayFor(peer.ID)
	} else {
		target = h.sessions.Shared()
	}
	_, delivery, _ := target.Snapshot()
	if delivery.Mode != DeliverySourceFile || delivery.TrackID == nil {
		return
	}
	// Only transfer when the peer is actually subscribed to this timeline.
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
	mediaOpen := peer.Media != nil
	peer.mu.Unlock()
	if !mediaOpen {
		return // attachMediaChannel retries when the channel opens
	}
	if freeplay {
		h.startFreeplayTransfer(peer, delivery)
	} else {
		h.startTransferForPeer(peer.ID, target, delivery)
	}
}

// transferTimeout guards slow readers: shared barriers already gate starts,
// so no extra timer is needed here. Slow peers hold their own transfer
// without stalling others because chunks are per-peer goroutines.
var _ = time.Second
