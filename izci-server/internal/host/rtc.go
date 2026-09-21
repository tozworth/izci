package host

import (
	"context"
	"fmt"
	"sync"

	"github.com/pion/webrtc/v3"
)

// RTCConfig carries ICE providers for the host PeerConnections. It reuses
// the configured STUN/TURN providers from signaling config.
type RTCConfig struct {
	StunURLs []string
	TurnURLs []string
	Username string
	Password string
}

// RTCHost answers client offers: the client is the offerer, the server is
// the answerer. It accepts the three data channels by label and answers the
// client's audio transceiver safely even when the server provides no RTP
// track (sendonly transceiver with a null track, matching the browser host).
type RTCHost struct {
	mu     sync.Mutex
	api    *webrtc.API
	config RTCConfig
	peers  map[string]*webrtc.PeerConnection
}

// NewRTCHost builds the Pion answerer.
func NewRTCHost(cfg RTCConfig) *RTCHost {
	return &RTCHost{api: webrtc.NewAPI(), config: cfg, peers: make(map[string]*webrtc.PeerConnection)}
}

// AnswerConfig describes one answer operation.
type AnswerConfig struct {
	PeerID        string
	OfferSDP      string
	OnControl     func(ch DataChannel)
	OnControlText func(text string)
	OnMedia       func(ch DataChannel)
	OnRender      func(ch DataChannel)
	OnConnected   func()
	OnFailed      func()
}

// pionChannel adapts a Pion data channel to the host DataChannel surface.
type pionChannel struct {
	ch *webrtc.DataChannel
}

// Label implements DataChannel.
func (c *pionChannel) Label() string { return c.ch.Label() }

// SendText implements DataChannel.
func (c *pionChannel) SendText(text string) error {
	return c.ch.SendText(text)
}

// SendBinary implements DataChannel.
func (c *pionChannel) SendBinary(data []byte) error {
	return c.ch.Send(data)
}

// BufferedAmount implements DataChannel.
func (c *pionChannel) BufferedAmount() uint64 {
	return c.ch.BufferedAmount()
}

// Close implements DataChannel.
func (c *pionChannel) Close() error { return c.ch.Close() }

// Answer creates a PeerConnection, applies the remote offer, and returns the
// local answer SDP. Data-channel and connection-state callbacks fire on Pion
// threads; callers must not block them.
func (h *RTCHost) Answer(ctx context.Context, cfg AnswerConfig) (string, error) {
	iceServers := []webrtc.ICEServer{}
	if len(h.config.StunURLs) > 0 {
		iceServers = append(iceServers, webrtc.ICEServer{URLs: h.config.StunURLs})
	}
	if len(h.config.TurnURLs) > 0 {
		iceServers = append(iceServers, webrtc.ICEServer{
			URLs:       h.config.TurnURLs,
			Username:   h.config.Username,
			Credential: h.config.Password,
		})
	}
	pc, err := h.api.NewPeerConnection(webrtc.Configuration{ICEServers: iceServers})
	if err != nil {
		return "", fmt.Errorf("host: new peer connection: %w", err)
	}
	h.mu.Lock()
	old := h.peers[cfg.PeerID]
	h.peers[cfg.PeerID] = pc
	h.mu.Unlock()
	if old != nil {
		_ = old.Close()
	}
	pc.OnDataChannel(func(ch *webrtc.DataChannel) {
		wrapped := &pionChannel{ch: ch}
		switch ch.Label() {
		case ChannelControl:
			ch.OnMessage(func(msg webrtc.DataChannelMessage) {
				if msg.IsString && cfg.OnControlText != nil {
					cfg.OnControlText(string(msg.Data))
				}
			})
			ch.OnOpen(func() {
				if cfg.OnControl != nil {
					cfg.OnControl(wrapped)
				}
			})
		case ChannelMedia:
			ch.OnOpen(func() {
				if cfg.OnMedia != nil {
					cfg.OnMedia(wrapped)
				}
			})
		case ChannelRender:
			ch.OnOpen(func() {
				if cfg.OnRender != nil {
					cfg.OnRender(wrapped)
				}
			})
		default:
			// Unknown labels are closed; the three required channels are
			// the only host interface.
			_ = ch.Close()
		}
	})
	pc.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		switch state {
		case webrtc.PeerConnectionStateConnected:
			if cfg.OnConnected != nil {
				cfg.OnConnected()
			}
		case webrtc.PeerConnectionStateFailed:
			if cfg.OnFailed != nil {
				cfg.OnFailed()
			}
		case webrtc.PeerConnectionStateClosed:
		default:
		}
	})
	if err := pc.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: cfg.OfferSDP}); err != nil {
		h.discardPeer(cfg.PeerID, pc)
		return "", fmt.Errorf("host: set remote offer: %w", err)
	}
	// Answer the client's audio transceiver safely even when the server
	// provides no RTP track: keep the negotiated transceivers as-is and
	// create an answer without attaching any local track. Pion negotiates
	// the audio m-line (Opus preferred by the client) as sendonly/recvonly
	// without requiring a server-side track.
	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		h.discardPeer(cfg.PeerID, pc)
		return "", fmt.Errorf("host: create answer: %w", err)
	}
	if err := pc.SetLocalDescription(answer); err != nil {
		h.discardPeer(cfg.PeerID, pc)
		return "", fmt.Errorf("host: set local answer: %w", err)
	}
	// Wait for ICE gathering to complete for a non-trickled answer fallback;
	// trickled candidates still flow via signaling. Bound by context.
	gather := webrtc.GatheringCompletePromise(pc)
	select {
	case <-ctx.Done():
		h.discardPeer(cfg.PeerID, pc)
		return "", ctx.Err()
	case <-gather:
	}
	if pc.LocalDescription() == nil {
		h.discardPeer(cfg.PeerID, pc)
		return "", fmt.Errorf("host: missing local description")
	}
	return pc.LocalDescription().SDP, nil
}

func (h *RTCHost) discardPeer(peerID string, pc *webrtc.PeerConnection) {
	h.mu.Lock()
	if h.peers[peerID] == pc {
		delete(h.peers, peerID)
	}
	h.mu.Unlock()
	_ = pc.Close()
}

// AddICECandidate adds a remote (client) candidate by string.
func (h *RTCHost) AddICECandidate(peerID, candidate string, sdpMid *string, sdpMLineIndex *uint16) error {
	h.mu.Lock()
	pc, ok := h.peers[peerID]
	h.mu.Unlock()
	if !ok {
		return fmt.Errorf("host: unknown peer %s", peerID)
	}
	init := webrtc.ICECandidateInit{Candidate: candidate, SDPMid: sdpMid, SDPMLineIndex: sdpMLineIndex}
	return pc.AddICECandidate(init)
}

// ClosePeer closes and forgets one PeerConnection.
func (h *RTCHost) ClosePeer(peerID string) {
	h.mu.Lock()
	pc, ok := h.peers[peerID]
	if ok {
		delete(h.peers, peerID)
	}
	h.mu.Unlock()
	if ok && pc != nil {
		_ = pc.Close()
	}
}
