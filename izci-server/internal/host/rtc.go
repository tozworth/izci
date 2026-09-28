package host

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"

	"github.com/pion/webrtc/v3"
)

// RTCConfig carries ICE providers for the host PeerConnections. It reuses
// the configured STUN/TURN providers from signaling config.
type RTCConfig struct {
	StunURLs   []string
	TurnURLs   []string
	Username   string
	Password   string
	ICEServers []ICEServer
	PublicIPs  []string
	UDPMin     uint16
	UDPMax     uint16
}

type ICEServer struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username,omitempty"`
	Credential string   `json:"credential,omitempty"`
}

// RTCHost answers client offers: the client is the offerer, the server is
// the answerer. It accepts the three data channels by label for control,
// source files, and buffered Opus.
type RTCHost struct {
	mu           sync.Mutex
	api          *webrtc.API
	config       RTCConfig
	peers        map[string]*webrtc.PeerConnection
	directRoutes atomic.Uint64
	relayRoutes  atomic.Uint64
}

// NewRTCHost builds the Pion answerer.
func NewRTCHost(cfg RTCConfig) *RTCHost {
	setting := webrtc.SettingEngine{}
	if len(cfg.PublicIPs) > 0 {
		setting.SetNAT1To1IPs(cfg.PublicIPs, webrtc.ICECandidateTypeHost)
	}
	if cfg.UDPMin != 0 && cfg.UDPMax != 0 {
		_ = setting.SetEphemeralUDPPortRange(cfg.UDPMin, cfg.UDPMax)
	}
	return &RTCHost{api: webrtc.NewAPI(webrtc.WithSettingEngine(setting)), config: cfg, peers: make(map[string]*webrtc.PeerConnection)}
}

func (h *RTCHost) SetICEServers(servers []ICEServer) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.config.ICEServers = append([]ICEServer(nil), servers...)
}

// AnswerConfig describes one answer operation.
type AnswerConfig struct {
	PeerID         string
	OfferSDP       string
	OnControl      func(ch DataChannel)
	OnControlText  func(text string)
	OnControlClose func()
	OnMedia        func(ch DataChannel)
	OnRender       func(ch DataChannel)
	OnConnected    func()
	OnFailed       func()
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
	h.mu.Lock()
	rtcConfig := h.config
	h.mu.Unlock()
	if len(rtcConfig.ICEServers) > 0 {
		for _, entry := range rtcConfig.ICEServers {
			iceServers = append(iceServers, webrtc.ICEServer{URLs: entry.URLs, Username: entry.Username, Credential: entry.Credential})
		}
	} else if len(rtcConfig.StunURLs) > 0 {
		iceServers = append(iceServers, webrtc.ICEServer{URLs: rtcConfig.StunURLs})
	}
	if len(rtcConfig.TurnURLs) > 0 {
		iceServers = append(iceServers, webrtc.ICEServer{
			URLs:       rtcConfig.TurnURLs,
			Username:   rtcConfig.Username,
			Credential: rtcConfig.Password,
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
			ch.OnClose(func() {
				if cfg.OnControlClose != nil {
					cfg.OnControlClose()
				}
			})
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
			relayed := false
			if sctp := pc.SCTP(); sctp != nil && sctp.Transport() != nil && sctp.Transport().ICETransport() != nil {
				if pair, pairErr := sctp.Transport().ICETransport().GetSelectedCandidatePair(); pairErr == nil && pair != nil {
					relayed = pair.Local.Typ == webrtc.ICECandidateTypeRelay || pair.Remote.Typ == webrtc.ICECandidateTypeRelay
				}
			}
			if relayed {
				h.relayRoutes.Add(1)
			} else {
				h.directRoutes.Add(1)
			}
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
	// Negotiate the data channels without adding media transceivers.
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

func (h *RTCHost) RouteCounts() (direct, relay uint64) {
	return h.directRoutes.Load(), h.relayRoutes.Load()
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
