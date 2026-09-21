package signaling

import (
	"context"
	"net/http"
	"sort"
	"time"

	"github.com/coder/websocket"
)

// WebSocket signaling: GET /v1/socket upgrades, then the first frame within
// the unauthenticated timeout must be an auth message carrying a one-use
// ticket (never in URLs or subprotocols). Auth binds role, room, connection,
// and a fresh socket generation on the server; client routing claims are
// ignored. Replacing a socket bumps its principal's generation so late
// cleanup from the old socket cannot clear the replacement.
//
// Each socket runs one reader and one bounded writer queue (64 messages /
// 256 KiB); writes happen outside the registry lock and slow readers are
// disconnected. Heartbeats use websocket ping on the configured interval.

type socket struct {
	id           uint64
	role         string
	roomID       string
	connectionID string
	connTokenKey string
	generation   uint64
	authed       bool

	conn       *websocket.Conn
	send       chan []byte
	sendMu     chan struct{} // capacity-1 mutex guarding sendBytes/closed
	sendBytes  int
	sendClosed bool

	done      chan struct{}
	closeOnce chan struct{} // closed once; guards closeSocket
	closed    bool

	msgTokens float64
	msgLast   time.Time
}

func (s *Server) handleSocket(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET, OPTIONS")
		writeError(w, http.StatusMethodNotAllowed, CodeMethodNotAllowed)
		return
	}
	if s.isShuttingDown() {
		writeError(w, http.StatusServiceUnavailable, CodeServerShuttingDown)
		return
	}
	if origin := r.Header.Get("Origin"); origin != "" {
		s.mu.Lock()
		_, ok := s.allowed[origin]
		s.mu.Unlock()
		if !ok {
			writeError(w, http.StatusForbidden, CodeOriginForbidden)
			return
		}
	}
	s.mu.Lock()
	if len(s.sockets) >= s.cfg.Limits.MaxOpenSockets {
		s.mu.Unlock()
		writeAPIError(w, http.StatusTooManyRequests, CodeRateLimited, 5, true)
		return
	}
	s.mu.Unlock()

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	conn.SetReadLimit(int64(s.cfg.Limits.MaxJSONMessageBytes))

	s.mu.Lock()
	s.nextSockID++
	sock := &socket{
		id:        s.nextSockID,
		conn:      conn,
		send:      make(chan []byte, s.cfg.Limits.MaxSocketQueueMessages),
		sendMu:    make(chan struct{}, 1),
		done:      make(chan struct{}),
		closeOnce: make(chan struct{}),
		msgTokens: socketMsgBurst,
		msgLast:   s.now(),
	}
	sock.sendMu <- struct{}{}
	s.sockets[sock.id] = sock
	s.mu.Unlock()

	go s.socketWriter(sock)
	s.socketReader(sock)
}

// socketWriter drains the bounded queue and sends heartbeat pings. It is
// the only goroutine that writes to the connection; pings share it because
// coder/websocket forbids concurrent writes.
func (s *Server) socketWriter(sock *socket) {
	defer s.closeSocket(sock.id, websocket.StatusInternalError, "writer done")
	interval := time.Duration(s.cfg.Limits.HeartbeatInterval)
	timeout := time.Duration(s.cfg.Limits.HeartbeatTimeout)
	var tick <-chan time.Time
	if interval > 0 {
		t := time.NewTicker(interval)
		defer t.Stop()
		tick = t.C
	}
	for {
		select {
		case <-sock.done:
			return
		case msg, ok := <-sock.send:
			if !ok {
				return
			}
			<-sock.sendMu
			sock.sendBytes -= len(msg)
			if sock.sendBytes < 0 {
				sock.sendBytes = 0
			}
			sock.sendMu <- struct{}{}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			err := sock.conn.Write(ctx, websocket.MessageText, msg)
			cancel()
			if err != nil {
				return
			}
		case <-tick:
			ctx, cancel := context.WithTimeout(context.Background(), timeout)
			err := sock.conn.Ping(ctx)
			cancel()
			if err != nil {
				return
			}
		}
	}
}

// sendAndClose enqueues a final frame and closes after a short flush grace
// so the peer can read it before the close lands. Used for auth failures,
// where an immediate close would race the queued error frame.
func (s *Server) sendAndClose(sockID uint64, frame []byte, code websocket.StatusCode, reason string) {
	s.sendToSocket(sockID, frame)
	go func() {
		time.Sleep(200 * time.Millisecond)
		s.closeSocket(sockID, code, reason)
	}()
}

// socketReader authenticates the first frame, then dispatches.
func (s *Server) socketReader(sock *socket) {
	unauth := time.Duration(s.cfg.Limits.UnauthSocketTimeout)
	ctx, cancel := context.WithTimeout(context.Background(), unauth)
	_, data, err := sock.conn.Read(ctx)
	cancel()
	if err != nil {
		s.closeSocket(sock.id, websocket.StatusPolicyViolation, "auth timeout")
		return
	}
	if !s.handleFirstFrame(sock, data) {
		return
	}
	for {
		_, data, err := sock.conn.Read(context.Background())
		if err != nil {
			s.closeSocket(sock.id, websocket.StatusNormalClosure, "read done")
			return
		}
		s.handleSocketFrame(sock, data)
	}
}

// sendToSocket enqueues a frame outside the registry lock.
func (s *Server) sendToSocket(id uint64, frame []byte) {
	s.mu.Lock()
	sock, ok := s.sockets[id]
	s.mu.Unlock()
	if !ok {
		return
	}
	s.enqueueFrame(sock, frame)
}

// applySocketAction runs deferred socket work (frame then optional close)
// outside the registry lock.
func (s *Server) applySocketAction(a socketAction) {
	if a.frame != nil {
		s.sendToSocket(a.socketID, a.frame)
	}
	if a.close {
		// Let the frame flush before closing.
		go func() {
			time.Sleep(100 * time.Millisecond)
			s.closeSocket(a.socketID, websocket.StatusNormalClosure, "closed")
		}()
	}
}

// enqueueFrame adds a frame to the bounded queue. A full queue (count or
// bytes) means a slow reader: the socket is dropped so one stuck peer cannot
// pin the registry.
func (s *Server) enqueueFrame(sock *socket, frame []byte) bool {
	<-sock.sendMu
	full := sock.sendClosed || len(sock.send) >= s.cfg.Limits.MaxSocketQueueMessages ||
		sock.sendBytes+len(frame) > s.cfg.Limits.MaxSocketQueueBytes
	if !full {
		sock.sendBytes += len(frame)
	}
	sock.sendMu <- struct{}{}
	if full {
		go s.closeSocket(sock.id, websocket.StatusMessageTooBig, "slow reader")
		return false
	}
	select {
	case sock.send <- frame:
		return true
	case <-sock.done:
		return false
	}
}

// closeSocket removes the socket and clears its principal binding only when
// the generation still matches, so late cleanup from a replaced socket is a
// no-op. Safe to call multiple times and without holding s.mu.
func (s *Server) closeSocket(id uint64, code websocket.StatusCode, reason string) {
	s.mu.Lock()
	sock, ok := s.sockets[id]
	if !ok {
		s.mu.Unlock()
		return
	}
	select {
	case <-sock.closeOnce:
		s.mu.Unlock()
		return
	default:
		close(sock.closeOnce)
	}
	delete(s.sockets, id)
	if sock.authed {
		now := s.now()
		if sock.role == RoleHost {
			if rm, ok := s.rooms[sock.roomID]; ok &&
				rm.hostSocketID == id && rm.hostGeneration == sock.generation {
				rm.hostSocketID = 0
				rm.hostConnected = false
				rm.hostGraceUntil = now.Add(time.Duration(s.cfg.Limits.HostReconnectGrace))
			}
		} else if sock.connectionID != "" {
			if conn, ok := s.connTokens[sock.connTokenKey]; ok &&
				conn.socketID == id && conn.generation == sock.generation {
				conn.socketID = 0
			}
		}
	}
	close(sock.done)
	<-sock.sendMu
	sock.sendClosed = true
	sock.sendMu <- struct{}{}
	conn := sock.conn
	s.mu.Unlock()
	// The network close runs detached: coder's Close performs a handshake
	// that waits for the peer, which must never stall registry work (e.g.
	// replacing a socket during another socket's authentication). State is
	// already detached above, so late packets find no binding. Extra Close
	// calls are no-ops inside coder.
	if conn != nil {
		go func() { _ = conn.Close(code, reason) }()
	}
}

// handleFirstFrame requires an auth message carrying a one-use ticket.
func (s *Server) handleFirstFrame(sock *socket, data []byte) bool {
	env, code := parseEnvelope(data, s.cfg.Limits.MaxJSONMessageBytes)
	if code != "" {
		s.sendAndClose(sock.id, errorFrame("", "", code, 0, false), websocket.StatusPolicyViolation, code)
		return false
	}
	if env.Type != MsgAuth {
		s.sendAndClose(sock.id, errorFrame(env.RequestID, "", CodeUnauthorized, 0, false), websocket.StatusPolicyViolation, "auth required")
		return false
	}
	ap, _, _, semCode := validateClientSemantics(env,
		s.cfg.Limits.MaxSDPBytes, s.cfg.Limits.MaxCandidateBytes,
		s.cfg.Limits.MaxCandidatesPerSidePerAttempt)
	if semCode != "" {
		s.sendAndClose(sock.id, errorFrame(env.RequestID, "", semCode, 0, false), websocket.StatusPolicyViolation, semCode)
		return false
	}
	digest, shapeOK := parseSecretToken(ap.Ticket)
	if !shapeOK {
		s.sendAndClose(sock.id, errorFrame(env.RequestID, "", CodeBadRequest, 0, false), websocket.StatusPolicyViolation, "bad ticket")
		return false
	}
	now := s.now()
	s.mu.Lock()
	t, ok := s.tickets[digestKey(digest)]
	if !ok {
		s.mu.Unlock()
		s.sendAndClose(sock.id, errorFrame(env.RequestID, "", CodeUnauthorized, 0, false), websocket.StatusPolicyViolation, "unknown ticket")
		return false
	}
	if t.consumed {
		s.mu.Unlock()
		s.sendAndClose(sock.id, errorFrame(env.RequestID, "", CodeTicketConsumed, 0, false), websocket.StatusPolicyViolation, "ticket replay")
		return false
	}
	if !now.Before(t.expiresAt) {
		s.mu.Unlock()
		s.sendAndClose(sock.id, errorFrame(env.RequestID, "", CodeTicketExpired, 0, false), websocket.StatusPolicyViolation, "ticket expired")
		return false
	}
	t.consumed = true
	rm := s.getRoomLocked(t.roomID, now)
	if rm == nil {
		s.mu.Unlock()
		s.sendAndClose(sock.id, errorFrame(env.RequestID, "", CodeRoomUnavailable, 0, false), websocket.StatusGoingAway, "room gone")
		return false
	}
	var conn *connection
	if t.role == RoleHost {
		if s.sessionValidLocked(rm.ownerDigest, now) == nil || !s.ownsRoomDigest(rm, t) {
			// Host tickets are minted for the owning session; the binding
			// is rechecked here so a logged-out host cannot linger.
			s.mu.Unlock()
			s.sendAndClose(sock.id, errorFrame(env.RequestID, "", CodeUnauthorized, 0, false), websocket.StatusPolicyViolation, "host gone")
			return false
		}
	} else {
		conn = s.findConnLocked(rm, t.connectionID)
		if conn == nil || conn.released {
			s.mu.Unlock()
			s.sendAndClose(sock.id, errorFrame(env.RequestID, "", CodeAttemptExpired, 0, false), websocket.StatusGoingAway, "connection gone")
			return false
		}
	}
	// Bind with a fresh generation, replacing any previous socket.
	sock.role = t.role
	sock.roomID = t.roomID
	sock.authed = true
	var replaced uint64
	var ready socketAction
	var flush []socketAction
	if t.role == RoleHost {
		rm.hostGeneration++
		sock.generation = rm.hostGeneration
		replaced = rm.hostSocketID
		rm.hostSocketID = sock.id
		rm.hostConnected = true
		rm.everHadHost = true
		sock.msgLast = now
		ready = socketAction{socketID: sock.id, frame: serverFrame(MsgReady, "", readyPayload{Role: RoleHost, RoomID: rm.id})}
		flush = s.flushHostLocked(rm)
	} else {
		conn.generation++
		sock.generation = conn.generation
		sock.connectionID = conn.id
		sock.connTokenKey = digestKey(conn.tokenDigest)
		replaced = conn.socketID
		conn.socketID = sock.id
		sock.msgLast = now
		ready = socketAction{socketID: sock.id, frame: serverFrame(MsgReady, "", readyPayload{Role: RoleGuest, RoomID: rm.id, ConnectionID: conn.id})}
		flush = s.flushGuestLocked(rm, conn)
	}
	s.mu.Unlock()
	if replaced != 0 && replaced != sock.id {
		s.closeSocket(replaced, websocket.StatusNormalClosure, "replaced")
	}
	s.applySocketAction(ready)
	for _, a := range flush {
		s.applySocketAction(a)
	}
	return true
}

// ownsRoomDigest is always true for host tickets: issuance already required
// ownership and the session check above covers logout. Kept explicit so the
// recheck reads as intended.
func (s *Server) ownsRoomDigest(rm *room, t *ticket) bool {
	return rm.id == t.roomID
}

func (s *Server) findConnLocked(rm *room, connID string) *connection {
	c, ok := rm.connections[connID]
	if !ok {
		return nil
	}
	return c
}

// flushHostLocked replays pending admissions and stored guest leg state to a
// (re)connected host: peer.requested for pending attempts, then offer and
// candidates where the guest already moved.
func (s *Server) flushHostLocked(rm *room) []socketAction {
	var out []socketAction
	for _, c := range rm.connections {
		a := c.attempt
		if a == nil || c.released {
			continue
		}
		if !a.accepted {
			out = append(out, socketAction{socketID: rm.hostSocketID,
				frame: serverFrame(MsgPeerRequested, a.id, peerRequestedPayload{ConnectionID: c.id})})
			continue
		}
		if a.done {
			out = append(out, socketAction{socketID: rm.hostSocketID,
				frame: serverFrame(MsgPeerConnected, a.id, map[string]string{})})
			continue
		}
		if a.hasOffer {
			out = append(out, socketAction{socketID: rm.hostSocketID,
				frame: serverFrame(MsgOffer, a.id, sdpPayload{SDP: a.offerSDP})})
			for _, f := range candidateFrames(MsgCandidate, a.id, a.guestCandidates) {
				out = append(out, socketAction{socketID: rm.hostSocketID, frame: f})
			}
			if a.guestCandEnd {
				out = append(out, socketAction{socketID: rm.hostSocketID,
					frame: serverFrame(MsgCandidatesEnd, a.id, map[string]string{})})
			}
		}
	}
	return out
}

// flushGuestLocked replays the host leg to a (re)connected guest.
func (s *Server) flushGuestLocked(rm *room, conn *connection) []socketAction {
	var out []socketAction
	a := conn.attempt
	if a == nil || conn.released {
		return out
	}
	if a.done || (a.guestConnected && a.hostConnected) {
		return append(out, socketAction{socketID: conn.socketID,
			frame: serverFrame(MsgPeerConnected, a.id, map[string]string{})})
	}
	if !a.accepted {
		return out
	}
	out = append(out, socketAction{socketID: conn.socketID,
		frame: serverFrame(MsgPeerAccepted, a.id, map[string]string{})})
	if a.hasAnswer {
		out = append(out, socketAction{socketID: conn.socketID,
			frame: serverFrame(MsgAnswer, a.id, sdpPayload{SDP: a.answerSDP})})
		for _, f := range candidateFrames(MsgCandidate, a.id, a.hostCandidates) {
			out = append(out, socketAction{socketID: conn.socketID, frame: f})
		}
		if a.hostCandEnd {
			out = append(out, socketAction{socketID: conn.socketID,
				frame: serverFrame(MsgCandidatesEnd, a.id, map[string]string{})})
		}
	}
	return out
}

func candidateFrames(msgType, attemptID string, m map[int]candidatePayload) [][]byte {
	if len(m) == 0 {
		return nil
	}
	keys := make([]int, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Ints(keys)
	out := make([][]byte, 0, len(keys))
	for _, k := range keys {
		out = append(out, serverFrame(msgType, attemptID, m[k]))
	}
	return out
}

// handleSocketFrame rate-limits, validates, and dispatches one authed frame.
// Registry work happens under s.mu; socket writes happen after unlocking.
func (s *Server) handleSocketFrame(sock *socket, data []byte) {
	env, code := parseEnvelope(data, s.cfg.Limits.MaxJSONMessageBytes)
	if code != "" {
		s.sendToSocket(sock.id, errorFrame("", "", code, 0, false))
		return
	}
	now := s.now()
	s.mu.Lock()
	st, ok := s.sockets[sock.id]
	if !ok || !st.authed {
		s.mu.Unlock()
		return
	}
	// Per-socket message rate: 60/second, burst 120.
	elapsed := now.Sub(sock.msgLast).Seconds()
	if elapsed > 0 {
		sock.msgTokens = min(socketMsgBurst, sock.msgTokens+elapsed*socketMsgRatePerSec)
		sock.msgLast = now
	}
	if sock.msgTokens < 1 {
		wait := 1
		s.mu.Unlock()
		s.sendToSocket(sock.id, errorFrame(env.RequestID, env.AttemptID, CodeRateLimited, wait, true))
		return
	}
	sock.msgTokens--
	ap, sp, cp, semCode := validateClientSemantics(env,
		s.cfg.Limits.MaxSDPBytes, s.cfg.Limits.MaxCandidateBytes,
		s.cfg.Limits.MaxCandidatesPerSidePerAttempt)
	if semCode != "" {
		s.mu.Unlock()
		s.sendToSocket(sock.id, errorFrame(env.RequestID, env.AttemptID, semCode, 0, false))
		return
	}
	if hostOnlyTypes[env.Type] && sock.role != RoleHost {
		s.mu.Unlock()
		s.sendToSocket(sock.id, errorFrame(env.RequestID, env.AttemptID, CodeBadRequest, 0, false))
		return
	}
	if guestOnlyTypes[env.Type] && sock.role != RoleGuest {
		s.mu.Unlock()
		s.sendToSocket(sock.id, errorFrame(env.RequestID, env.AttemptID, CodeBadRequest, 0, false))
		return
	}
	if env.Type == MsgAuth {
		s.mu.Unlock()
		s.sendToSocket(sock.id, errorFrame(env.RequestID, "", CodeBadRequest, 0, false))
		return
	}
	sends, errCode := s.dispatchLocked(sock, env, ap, sp, cp, now)
	reqID, attID := env.RequestID, env.AttemptID
	s.mu.Unlock()
	if errCode != "" {
		s.sendToSocket(sock.id, errorFrame(reqID, attID, errCode, 0, false))
		return
	}
	for _, a := range sends {
		s.applySocketAction(a)
	}
}

// dispatchLocked applies one message to the registry. Callers hold s.mu and
// run the returned actions after unlocking.
func (s *Server) dispatchLocked(sock *socket, env Envelope, ap authPayload, sp sdpPayload, cp candidatePayload, now time.Time) ([]socketAction, string) {
	rm := s.getRoomLocked(sock.roomID, now)
	if rm == nil {
		return nil, CodeRoomUnavailable
	}
	// Locate the attempt: guests are scoped to their own connection, the host
	// to any attempt in its room. Anything unresolvable is stale.
	var conn *connection
	var a *attempt
	if sock.role == RoleGuest {
		conn = s.findConnLocked(rm, sock.connectionID)
		if conn == nil || conn.released {
			return nil, CodeAttemptExpired
		}
		a = conn.attempt
		if a == nil || a.id != env.AttemptID {
			return nil, CodeAttemptExpired
		}
	} else {
		for _, c := range rm.connections {
			if c.attempt != nil && c.attempt.id == env.AttemptID && !c.released {
				conn = c
				a = c.attempt
				break
			}
		}
		if a == nil {
			return nil, CodeAttemptExpired
		}
	}
	if a.done {
		// SDP/candidates were discarded after connect; only release applies.
		if env.Type == MsgRelease {
			return s.releaseConnectionLocked(rm, conn, ReasonReleased), ""
		}
		return nil, CodeAttemptExpired
	}
	if !now.Before(a.expiresAt) {
		sends := s.releaseConnectionLocked(rm, conn, ReasonAttemptExpired)
		return sends, CodeAttemptExpired
	}

	switch env.Type {
	case MsgAccept:
		if a.accepted || a.rejected {
			return nil, CodeBadRequest
		}
		a.accepted = true
		// The host handler is installed first; only now is the guest
		// prompted to offer.
		return []socketAction{{socketID: conn.socketID,
			frame: serverFrame(MsgPeerAccepted, a.id, map[string]string{})}}, ""
	case MsgReject:
		if a.accepted || a.rejected {
			return nil, CodeBadRequest
		}
		a.rejected = true
		conn.released = true
		conn.releaseReason = ReasonRejected
		conn.releasedAt = now
		return []socketAction{{socketID: conn.socketID,
			frame: serverFrame(MsgPeerRejected, a.id, peerRejectedPayload{Reason: ReasonRejected})}}, ""
	case MsgOffer:
		if !a.accepted || a.rejected {
			return nil, CodeBadRequest
		}
		if a.hasOffer {
			if a.offerSDP == sp.SDP {
				return nil, ""
			}
			return nil, CodeBadRequest
		}
		a.hasOffer = true
		a.offerSDP = sp.SDP
		return []socketAction{{socketID: rm.hostSocketID,
			frame: serverFrame(MsgOffer, a.id, sdpPayload{SDP: sp.SDP})}}, ""
	case MsgAnswer:
		if !a.accepted || a.rejected || !a.hasOffer {
			return nil, CodeBadRequest
		}
		if a.hasAnswer {
			if a.answerSDP == sp.SDP {
				return nil, ""
			}
			return nil, CodeBadRequest
		}
		a.hasAnswer = true
		a.answerSDP = sp.SDP
		return []socketAction{{socketID: conn.socketID,
			frame: serverFrame(MsgAnswer, a.id, sdpPayload{SDP: sp.SDP})}}, ""
	case MsgCandidate:
		if !a.accepted || a.rejected {
			return nil, CodeBadRequest
		}
		var store map[int]candidatePayload
		var peer uint64
		if sock.role == RoleGuest {
			store, peer = a.guestCandidates, rm.hostSocketID
		} else {
			store, peer = a.hostCandidates, conn.socketID
		}
		if prev, dup := store[cp.Index]; dup {
			if prev == cp {
				return nil, "" // identical duplicate: ignore
			}
			return nil, CodeBadRequest // conflicting duplicate
		}
		store[cp.Index] = cp
		if peer == 0 {
			return nil, "" // stored for flush when the peer connects
		}
		return []socketAction{{socketID: peer,
			frame: serverFrame(MsgCandidate, a.id, cp)}}, ""
	case MsgCandidatesEnd:
		if !a.accepted || a.rejected {
			return nil, CodeBadRequest
		}
		var peer uint64
		if sock.role == RoleGuest {
			if a.guestCandEnd {
				return nil, ""
			}
			a.guestCandEnd = true
			peer = rm.hostSocketID
		} else {
			if a.hostCandEnd {
				return nil, ""
			}
			a.hostCandEnd = true
			peer = conn.socketID
		}
		if peer == 0 {
			return nil, ""
		}
		return []socketAction{{socketID: peer,
			frame: serverFrame(MsgCandidatesEnd, a.id, map[string]string{})}}, ""
	case MsgConnected:
		if !a.accepted || a.rejected {
			return nil, CodeBadRequest
		}
		if sock.role == RoleGuest {
			a.guestConnected = true
		} else {
			a.hostConnected = true
		}
		if !a.guestConnected || !a.hostConnected {
			return nil, ""
		}
		// Both peers connected: discard SDP/candidates, keep the slot.
		a.done = true
		a.offerSDP, a.answerSDP = "", ""
		a.guestCandidates, a.hostCandidates = nil, nil
		conn.connected = true
		frame := serverFrame(MsgPeerConnected, a.id, map[string]string{})
		var out []socketAction
		if conn.socketID != 0 {
			out = append(out, socketAction{socketID: conn.socketID, frame: frame})
		}
		if rm.hostSocketID != 0 {
			out = append(out, socketAction{socketID: rm.hostSocketID, frame: frame})
		}
		return out, ""
	case MsgRelease:
		return s.releaseConnectionLocked(rm, conn, ReasonReleased), ""
	default:
		return nil, CodeBadRequest
	}
}

func min(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
