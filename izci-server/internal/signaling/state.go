package signaling

import (
	"time"
)

// In-memory registry: host sessions, rooms, connection reservations,
// attempts, socket tickets, and live sockets. Everything here is transient;
// a restart drops it all and hosts resume or recreate their rooms.
//
// Locking: s.mu guards every map and record below. Socket I/O (websocket
// writes, closes) always happens outside s.mu via the per-socket bounded
// queue; cleanup and close helpers collect actions under the lock and run
// them after unlocking.

type hostSession struct {
	digest    [32]byte
	expiresAt time.Time
}

type room struct {
	id                string
	ownerDigest       [32]byte
	ownerSecretDigest [32]byte
	inviteDigest      [32]byte
	capacity          int
	createdAt         time.Time
	leaseUntil        time.Time

	hostConnected  bool
	everHadHost    bool
	hostGraceUntil time.Time
	hostGeneration uint64
	hostSocketID   uint64

	connections map[string]*connection
}

type connection struct {
	id            string
	tokenDigest   [32]byte
	roomID        string
	createdAt     time.Time
	released      bool
	releaseReason string
	releasedAt    time.Time
	connected     bool // both peers reported connected; reservation retained
	generation    uint64
	socketID      uint64
	attempt       *attempt
	// iceIssued counts POST /v1/ice responses for this connection, so one
	// guest cannot mint unbounded TURN credentials.
	iceIssued int
}

type attempt struct {
	id        string
	nonce     string
	createdAt time.Time
	expiresAt time.Time

	accepted bool
	rejected bool
	done     bool // both sides connected; SDP/candidates discarded

	hasOffer  bool
	offerSDP  string
	hasAnswer bool
	answerSDP string

	guestCandidates map[int]candidatePayload
	hostCandidates  map[int]candidatePayload
	guestCandEnd    bool
	hostCandEnd     bool

	guestConnected bool
	hostConnected  bool
}

type ticket struct {
	digest       [32]byte
	role         string
	roomID       string
	connectionID string
	expiresAt    time.Time
	consumed     bool
}

// releasedConnTTL retains released connection records so their tokens report
// attempt-expired instead of unauthorized; afterwards they are pruned.
// ticketGraveTTL retains expired tickets briefly so late first-use and
// replays still report ticket-expired/ticket-consumed instead of
// unauthorized; afterwards they are pruned to keep the map bounded.
const releasedConnTTL = 5 * time.Minute

const ticketGraveTTL = 5 * time.Minute

// liveConnections counts unreleased connections in a room.
func (r *room) liveConnections() int {
	n := 0
	for _, c := range r.connections {
		if !c.released {
			n++
		}
	}
	return n
}

// pendingAttempts counts unreleased, not-fully-connected connections.
func (r *room) pendingAttempts() int {
	n := 0
	for _, c := range r.connections {
		if !c.released && !c.connected {
			n++
		}
	}
	return n
}

// hostPresent reports whether admissions are allowed: a fresh room whose host
// never connected yet, or a room with a live host socket. A room whose host
// dropped (inside or past reconnect grace) refuses new guests until the host
// returns.
func (r *room) hostPresent() bool {
	if r.hostConnected {
		return true
	}
	return !r.everHadHost
}

// sessionValid returns the session if its digest is known and unexpired.
func (s *Server) sessionValidLocked(digest [32]byte, now time.Time) *hostSession {
	sess, ok := s.sessions[digestKey(digest)]
	if !ok || !now.Before(sess.expiresAt) {
		return nil
	}
	return sess
}

// getRoom returns the room if present and its lease is live.
func (s *Server) getRoomLocked(id string, now time.Time) *room {
	r, ok := s.rooms[id]
	if !ok || !now.Before(r.leaseUntil) {
		return nil
	}
	return r
}

// socketAction is deferred socket work collected under s.mu and run after
// unlocking: an optional frame to enqueue followed by an optional close.
type socketAction struct {
	socketID uint64
	frame    []byte
	close    bool
}

// Cleanup expires sessions, room leases, attempts, tickets, released
// connection records, and idle limiter buckets using the injected clock.
// Socket writes and closes run outside the registry lock.
func (s *Server) Cleanup() {
	now := s.now()
	var actions []socketAction
	s.mu.Lock()
	// Expired sessions drop their rooms: the host is gone, so authority ends.
	for key, sess := range s.sessions {
		if !now.Before(sess.expiresAt) {
			delete(s.sessions, key)
			for _, r := range s.rooms {
				if r.ownerDigest == sess.digest {
					actions = append(actions, s.closeRoomLocked(r, ReasonRoomClosed)...)
				}
			}
		}
	}
	// Expired leases drop their rooms.
	for id, r := range s.rooms {
		if !now.Before(r.leaseUntil) {
			_ = id
			actions = append(actions, s.closeRoomLocked(r, ReasonRoomClosed)...)
		}
	}
	// Expired attempts release their slot once.
	for _, r := range s.rooms {
		for _, c := range r.connections {
			a := c.attempt
			if a == nil || a.done || c.released || c.connected {
				continue
			}
			if !now.Before(a.expiresAt) {
				actions = append(actions, s.releaseConnectionLocked(r, c, ReasonAttemptExpired)...)
			}
		}
		// Prune old released records so the map stays bounded.
		for id, c := range r.connections {
			if c.released && c.socketID == 0 && now.Sub(c.releasedAt) > releasedConnTTL {
				delete(r.connections, id)
				delete(s.connTokens, digestKey(c.tokenDigest))
			}
		}
	}
	// Expired tickets are pruned after a short grave period. Consumed tickets
	// are retained until then so replays report ticket-consumed.
	for key, t := range s.tickets {
		if now.After(t.expiresAt.Add(ticketGraveTTL)) {
			delete(s.tickets, key)
		}
	}
	s.loginLimiter.prune(now)
	s.joinLimiter.prune(now)
	s.mu.Unlock()
	for _, a := range actions {
		s.applySocketAction(a)
	}
}

// closeRoomLocked removes the room and releases every reservation. Peers get
// one peer.released frame before their sockets close; established RTC keeps
// playing on its own. Callers must apply the returned actions after unlock.
func (s *Server) closeRoomLocked(r *room, reason string) []socketAction {
	var actions []socketAction
	for id, c := range r.connections {
		if !c.released {
			c.released = true
			c.releaseReason = reason
			c.releasedAt = s.now()
		}
		if c.attempt != nil && c.socketID != 0 {
			frame := serverFrame(MsgPeerReleased, c.attempt.id, peerReleasedPayload{Reason: reason})
			actions = append(actions, socketAction{socketID: c.socketID, frame: frame, close: true})
		} else if c.socketID != 0 {
			actions = append(actions, socketAction{socketID: c.socketID, close: true})
		}
		delete(s.connTokens, digestKey(c.tokenDigest))
		_ = id
	}
	if r.hostSocketID != 0 {
		actions = append(actions, socketAction{socketID: r.hostSocketID, close: true})
	}
	delete(s.rooms, r.id)
	return actions
}

// releaseConnectionLocked frees one slot exactly once and notifies both
// sides. The reservation record is retained briefly so late messages report
// attempt-expired. Idempotent: repeats return no actions.
func (s *Server) releaseConnectionLocked(r *room, c *connection, reason string) []socketAction {
	if c.released {
		return nil
	}
	c.released = true
	c.releaseReason = reason
	c.releasedAt = s.now()
	var actions []socketAction
	if c.attempt != nil {
		frame := serverFrame(MsgPeerReleased, c.attempt.id, peerReleasedPayload{Reason: reason})
		if c.socketID != 0 {
			actions = append(actions, socketAction{socketID: c.socketID, frame: frame})
		}
		if r.hostSocketID != 0 {
			actions = append(actions, socketAction{socketID: r.hostSocketID, frame: frame})
		}
	}
	return actions
}

// markShuttingDown flags the server, fails new admissions with
// server-shutting-down, and notifies every socket. HTTP shutdown itself is
// driven by Serve.
func (s *Server) markShuttingDown() {
	s.mu.Lock()
	s.shuttingDown = true
	var actions []socketAction
	for id := range s.sockets {
		frame := errorFrame(newRequestID(), "", CodeServerShuttingDown, 0, false)
		actions = append(actions, socketAction{socketID: id, frame: frame, close: true})
	}
	s.mu.Unlock()
	for _, a := range actions {
		s.applySocketAction(a)
	}
}

// isShuttingDown reports the shutdown flag.
func (s *Server) isShuttingDown() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.shuttingDown
}
