package host

import (
	"crypto/rand"
	"encoding/hex"
	"sync"
	"time"
)

// Peer is one connected client: registry state plus channels. Media bytes
// are never stored here; sessions own timelines, the peer owns its channels.
type Peer struct {
	mu sync.Mutex

	ID              string
	AttemptID       string
	ConnectionID    string
	Name            string
	Capabilities    []string
	ProtocolMinor   int
	FreeplayEnabled bool
	Identity        string
	PairNonce       string
	HelloReceived   bool
	IceFailed       bool
	ConnectedAt     time.Time
	LastActivity    time.Time
	FreeplayActive  bool

	Control DataChannel
	Media   DataChannel
	Render  DataChannel

	pc PeerConnection
}

// PeerConnection is the subset of Pion behavior the host needs. Production
// uses *webrtc.PeerConnection via pionPeerConnection; tests inject fakes.
type PeerConnection interface {
	Close() error
}

// Snapshot returns a copy of presentation-relevant peer fields.
func (p *Peer) Snapshot() (id, name string, helloReceived, freeplayActive bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.ID, p.Name, p.HelloReceived, p.FreeplayActive
}

// MarkHello records the client hello.
func (p *Peer) MarkHello(name string, freeplayEnabled bool, identity string, minor int, caps []string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.Name = name
	p.FreeplayEnabled = freeplayEnabled
	p.Identity = identity
	p.ProtocolMinor = minor
	p.Capabilities = append([]string(nil), caps...)
	p.HelloReceived = true
	p.LastActivity = time.Now()
}

// NewPairNonce mints a fresh per-connection nonce for pairing proofs.
func NewPairNonce() string {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "fallback-nonce-00"
	}
	// Map to [A-Za-z0-9_-] alphabet like the browser helper.
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
	out := make([]byte, 16)
	for i, b := range raw[:] {
		out[i] = alphabet[int(b)%len(alphabet)]
	}
	return string(out)
}

// NewPeerID mints an opaque peer ID (hex, never a filesystem path).
func NewPeerID() string {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "peer-fallback"
	}
	return hex.EncodeToString(raw[:])
}
