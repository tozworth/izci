package host

import (
	"fmt"
	"sync"
)

// Command is one validated client command routed to a session.
type Command struct {
	Type       string
	CommandID  string
	PeerID     string
	Seconds    *float64
	Collection string
	ItemID     string
	ItemIDs    []string
}

// SupportedCommands is the finite executable surface. Unknown types are
// nacked, never executed.
var SupportedCommands = map[string]bool{
	"transport.toggle": true, "transport.play": true, "transport.pause": true,
	"transport.stop": true, "transport.previous": true, "transport.next": true,
	"queue.shuffle": true, "queue.repeat": true,
	"transport.seek": true, "queue.play-next": true, "collection.activate": true,
}

// IsSupportedCommand reports whether a command type executes.
func IsSupportedCommand(t string) bool { return SupportedCommands[t] }

// Permissions separates admission checks from navigation/state mutation.
// The dispatcher consults Permissions first; sessions never check identity.
type Permissions interface {
	// CanControlShared reports whether a peer may alter the shared session.
	CanControlShared(peerID string) bool
	// CanUseFreeplay reports whether a peer may use its private session.
	CanUseFreeplay(peerID string) bool
}

// OpenPermissions allows every admitted peer. Dedicated deployments use
// PolicyPermissions; this implementation remains useful for tests and explicit
// all-controller embeddings.
type OpenPermissions struct{}

// CanControlShared implements Permissions.
func (OpenPermissions) CanControlShared(peerID string) bool { return true }

// CanUseFreeplay implements Permissions.
func (OpenPermissions) CanUseFreeplay(peerID string) bool { return true }

// PolicyPermissions centralizes dedicated-host privileges. "paired" limits
// shared timeline mutation to peers whose reconnect proof (or initial
// operator policy pairing) succeeded; Freeplay remains a private admitted
// client facility and never grants administration.
type PolicyPermissions struct {
	mu            sync.RWMutex
	sharedControl string
	paired        map[string]bool
}

func NewPolicyPermissions(sharedControl string) *PolicyPermissions {
	return &PolicyPermissions{sharedControl: sharedControl, paired: make(map[string]bool)}
}

func (p *PolicyPermissions) SetPaired(peerID string, paired bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if paired {
		p.paired[peerID] = true
	} else {
		delete(p.paired, peerID)
	}
}

func (p *PolicyPermissions) Remove(peerID string) { p.SetPaired(peerID, false) }

func (p *PolicyPermissions) CanControlShared(peerID string) bool {
	if p.sharedControl != "paired" {
		return true
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.paired[peerID]
}

func (p *PolicyPermissions) CanUseFreeplay(peerID string) bool { return true }

// DispatchResult is the host-authoritative outcome of one command.
type DispatchResult struct {
	Accepted       bool
	Message        string
	SessionID      string
	Clock          Clock
	Delivery       Delivery
	Preparation    *Preparation
	CancelledGen   *string
	SeekEpoch      int
	StartAt        int64
	BarrierPending []string
}

// RoomSessions owns the room's sessions: one permanent shared session plus
// independent Freeplay sessions keyed by peer ID.
type RoomSessions struct {
	mu          sync.Mutex
	shared      *Session
	freeplay    map[string]*Session
	permissions Permissions
	newFreeplay func(peerID string) *Session
}

// NewRoomSessions builds the session owner for a room.
func NewRoomSessions(shared *Session, permissions Permissions, newFreeplay func(peerID string) *Session) *RoomSessions {
	if permissions == nil {
		permissions = OpenPermissions{}
	}
	return &RoomSessions{shared: shared, freeplay: make(map[string]*Session), permissions: permissions, newFreeplay: newFreeplay}
}

// Shared returns the room's shared session.
func (r *RoomSessions) Shared() *Session { return r.shared }

// FreeplayFor returns (creating if needed) the caller's private session.
func (r *RoomSessions) FreeplayFor(peerID string) *Session {
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.freeplay[peerID]; ok {
		return s
	}
	var s *Session
	if r.newFreeplay != nil {
		s = r.newFreeplay(peerID)
	} else {
		s = NewSession(SessionConfig{ID: fmt.Sprintf("freeplay-%s", peerID), Kind: SessionFreeplay, Controller: peerID})
	}
	r.freeplay[peerID] = s
	return s
}

// RemoveFreeplay drops a peer's private session on disconnect. It never
// touches the shared session or another peer's session.
func (r *RoomSessions) RemoveFreeplay(peerID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.freeplay, peerID)
}

func (r *RoomSessions) FreeplayCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.freeplay)
}

// Dispatch routes one command: shared commands target the room session,
// Freeplay commands target only the caller's session. Permission checks run
// before any navigation/state mutation.
func (r *RoomSessions) Dispatch(cmd Command, freeplay bool) DispatchResult {
	if !IsSupportedCommand(cmd.Type) {
		return DispatchResult{Accepted: false, Message: "Unsupported command."}
	}
	var target *Session
	if freeplay {
		if !r.permissions.CanUseFreeplay(cmd.PeerID) {
			return DispatchResult{Accepted: false, Message: "Freeplay unavailable."}
		}
		target = r.FreeplayFor(cmd.PeerID)
	} else {
		if !r.permissions.CanControlShared(cmd.PeerID) {
			return DispatchResult{Accepted: false, Message: "Not permitted."}
		}
		target = r.shared
	}
	switch cmd.Type {
	case "transport.toggle":
		c, d := target.Toggle()
		return DispatchResult{Accepted: true, SessionID: target.ID(), Clock: c, Delivery: d}
	case "transport.play":
		c, d := target.Play()
		return DispatchResult{Accepted: true, SessionID: target.ID(), Clock: c, Delivery: d}
	case "transport.pause":
		c, d := target.Pause()
		return DispatchResult{Accepted: true, SessionID: target.ID(), Clock: c, Delivery: d}
	case "transport.stop":
		c, d, cancelled := target.Stop()
		return DispatchResult{Accepted: true, SessionID: target.ID(), Clock: c, Delivery: d, CancelledGen: cancelled}
	case "transport.previous":
		c, d, p, cancelled := target.Previous()
		return DispatchResult{Accepted: true, SessionID: target.ID(), Clock: c, Delivery: d, Preparation: p, CancelledGen: cancelled}
	case "transport.next":
		c, d, p, cancelled := target.Next()
		return DispatchResult{Accepted: true, SessionID: target.ID(), Clock: c, Delivery: d, Preparation: p, CancelledGen: cancelled}
	case "queue.shuffle":
		target.ToggleShuffle()
		c, d, _ := target.Snapshot()
		return DispatchResult{Accepted: true, SessionID: target.ID(), Clock: c, Delivery: d}
	case "queue.repeat":
		target.CycleRepeat()
		c, d, _ := target.Snapshot()
		return DispatchResult{Accepted: true, SessionID: target.ID(), Clock: c, Delivery: d}
	case "transport.seek":
		secs := 0.0
		if cmd.Seconds != nil {
			secs = *cmd.Seconds
		}
		c, epoch := target.Seek(secs)
		_, d, _ := target.Snapshot()
		return DispatchResult{Accepted: true, SessionID: target.ID(), Clock: c, Delivery: d, SeekEpoch: epoch}
	case "collection.activate":
		c, d, p := target.Activate(cmd.ItemID)
		return DispatchResult{Accepted: true, SessionID: target.ID(), Clock: c, Delivery: d, Preparation: &p, BarrierPending: target.PendingBarrier()}
	case "queue.play-next":
		target.PlayNext(cmd.ItemIDs)
		c, d, _ := target.Snapshot()
		return DispatchResult{Accepted: true, SessionID: target.ID(), Clock: c, Delivery: d}
	default:
		return DispatchResult{Accepted: false, Message: "Unsupported command."}
	}
}
