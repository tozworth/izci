package host

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// SocketEnvelope mirrors the signaling socket wire shape so the host speaks
// the same contract as browser hosts (version/type/requestId/attemptId/payload).
type SocketEnvelope struct {
	Version   int             `json:"version"`
	Type      string          `json:"type"`
	RequestID string          `json:"requestId"`
	AttemptID string          `json:"attemptId,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

// HostSignalingEvents is the host-side view of signaling: admissions,
// offers, ICE, and connection lifecycle. Implementations (embedded loopback
// or remote) deliver identical semantics.
type HostSignalingEvents interface {
	OnReady()
	OnPeerRequested(connectionID, attemptID string)
	OnOffer(attemptID, sdp string)
	OnCandidate(attemptID, candidate string, index int, sdpMid string, sdpMLineIndex int)
	OnCandidatesEnd(attemptID string)
	OnConnected(attemptID string)
	OnReleased(attemptID, reason string)
	OnError(code string)
	OnSocketClose()
}

// HostSignalingTransport is the logical signaling interface shared by
// embedded and remote hosts. Combined mode uses an embedded transport that
// dials its own HTTP/WebSocket endpoints (same lifecycle as remote), never
// direct registry access.
type HostSignalingTransport interface {
	// Acquire logs in with the operator key and creates (or resumes) a room.
	Acquire(ctx context.Context, capacity int) (roomID string, err error)
	// Connect opens the host socket and blocks until the ready frame
	// arrives or ctx ends. A pre-ready error frame fails the dial.
	Connect(ctx context.Context, events HostSignalingEvents) error
	// Done closes when the socket read loop exits (drop or Close).
	Done() <-chan struct{}
	Accept(attemptID string) error
	Reject(attemptID string) error
	Release(attemptID string) error
	SendAnswer(attemptID, sdp string) error
	SendCandidate(attemptID, candidate string, index int, sdpMid string, sdpMLineIndex int) error
	SendCandidatesEnd(attemptID string) error
	SendConnected(attemptID string) error
	Close() error
}

// SignalClientConfig configures a host transport against one signal endpoint.
type SignalClientConfig struct {
	// BaseURL is the signal HTTP(S) base including any path prefix.
	BaseURL string
	// HostKey is the hex operator key (never logged).
	HostKey string
	// HTTPClient may be overridden in tests.
	HTTPClient *http.Client
}

// SignalTransport dials a signal endpoint (embedded loopback or remote)
// through the public HTTP + WebSocket contract.
type SignalTransport struct {
	cfg SignalClientConfig
	mu  sync.Mutex

	client     *http.Client
	session    string
	roomID     string
	socket     *websocket.Conn
	socketDone chan struct{}
	sendMu     sync.Mutex
	reqCounter int64
}

// NewSignalTransport builds a transport for an embedded or remote endpoint.
func NewSignalTransport(cfg SignalClientConfig) *SignalTransport {
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	return &SignalTransport{cfg: cfg, client: client}
}

func (t *SignalTransport) base() string {
	return strings.TrimSuffix(strings.TrimSpace(t.cfg.BaseURL), "/")
}

func (t *SignalTransport) post(ctx context.Context, path, bearer string, body any, out any) error {
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.base()+path, &buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := t.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var errBody struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		_ = json.NewDecoder(resp.Body).Decode(&errBody)
		if errBody.Error.Code == "" {
			errBody.Error.Code = "bad-request"
		}
		return fmt.Errorf("signal %s: %s", path, errBody.Error.Code)
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return err
		}
	}
	return nil
}

// Acquire implements HostSignalingTransport.
func (t *SignalTransport) Acquire(ctx context.Context, capacity int) (string, error) {
	var session struct {
		SessionToken string `json:"sessionToken"`
	}
	if err := t.post(ctx, "/v1/host/sessions", "", map[string]any{"hostKey": t.cfg.HostKey}, &session); err != nil {
		return "", err
	}
	if session.SessionToken == "" {
		return "", fmt.Errorf("signal: empty session token")
	}
	var room struct {
		RoomID string `json:"roomId"`
	}
	if err := t.post(ctx, "/v1/rooms", session.SessionToken, map[string]any{"capacity": capacity}, &room); err != nil {
		return "", err
	}
	t.mu.Lock()
	t.session = session.SessionToken
	t.roomID = room.RoomID
	t.mu.Unlock()
	return room.RoomID, nil
}

// RoomID returns the acquired room.
func (t *SignalTransport) RoomID() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.roomID
}

// Connect implements HostSignalingTransport.
func (t *SignalTransport) Connect(ctx context.Context, events HostSignalingEvents) error {
	t.mu.Lock()
	session, roomID := t.session, t.roomID
	t.mu.Unlock()
	if session == "" || roomID == "" {
		return fmt.Errorf("signal: acquire a room before connecting")
	}
	var ticket struct {
		Ticket string `json:"ticket"`
	}
	if err := t.post(ctx, "/v1/socket-tickets", session, map[string]any{"roomId": roomID}, &ticket); err != nil {
		return err
	}
	socketURL := t.base() + "/v1/socket"
	u, err := url.Parse(socketURL)
	if err != nil {
		return err
	}
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	case "http":
		u.Scheme = "ws"
	}
	dialCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(dialCtx, u.String(), nil)
	if err != nil {
		return err
	}
	conn.SetReadLimit(256 * 1024)
	t.mu.Lock()
	t.socket = conn
	t.socketDone = make(chan struct{})
	done := t.socketDone
	t.mu.Unlock()
	// Auth must be the first frame with a one-use ticket (never in URL).
	if err := t.write(SocketEnvelope{Version: 1, Type: "auth", RequestID: t.nextRequestID(), Payload: mustPayload(map[string]any{"ticket": ticket.Ticket})}); err != nil {
		_ = conn.Close(websocket.StatusPolicyViolation, "auth failed")
		return err
	}
	ready := make(chan struct{})
	firstErr := make(chan error, 1)
	go t.readLoop(conn, done, &readyWatcher{HostSignalingEvents: events, ready: ready, firstErr: firstErr})
	// Wait for the ready frame with a bounded timeout. The read loop
	// surfaces a pre-ready error frame as a dial failure; a close before
	// ready means the ticket or room was rejected.
	readyCtx, readyCancel := context.WithTimeout(ctx, 8*time.Second)
	defer readyCancel()
	select {
	case <-readyCtx.Done():
		return readyCtx.Err()
	case err := <-firstErr:
		return err
	case <-done:
		return fmt.Errorf("signal: socket closed during auth")
	case <-ready:
		return nil
	}
}

// readyWatcher reports the first ready/error frame to Connect while
// forwarding everything to the host. Post-ready errors flow through as
// operational events.
type readyWatcher struct {
	HostSignalingEvents
	ready    chan struct{}
	firstErr chan error
	once     sync.Once
}

// OnReady implements HostSignalingEvents.
func (w *readyWatcher) OnReady() {
	w.HostSignalingEvents.OnReady()
	w.once.Do(func() { close(w.ready) })
}

// OnError implements HostSignalingEvents.
func (w *readyWatcher) OnError(code string) {
	w.HostSignalingEvents.OnError(code)
	select {
	case <-w.ready:
	default:
		w.once.Do(func() { w.firstErr <- fmt.Errorf("signal: %s", code) })
	}
}

func (t *SignalTransport) readLoop(conn *websocket.Conn, done chan struct{}, events HostSignalingEvents) {
	defer close(done)
	defer func() { _ = conn.Close(websocket.StatusNormalClosure, "done") }()
	for {
		_, data, err := conn.Read(context.Background())
		if err != nil {
			events.OnSocketClose()
			return
		}
		var env SocketEnvelope
		if err := json.Unmarshal(data, &env); err != nil {
			continue
		}
		switch env.Type {
		case "ready":
			events.OnReady()
		case "peer.requested":
			var p struct {
				ConnectionID string `json:"connectionId"`
			}
			_ = json.Unmarshal(env.Payload, &p)
			events.OnPeerRequested(p.ConnectionID, env.AttemptID)
		case "offer":
			var p struct {
				SDP string `json:"sdp"`
			}
			_ = json.Unmarshal(env.Payload, &p)
			events.OnOffer(env.AttemptID, p.SDP)
		case "candidate":
			var p struct {
				Candidate     string `json:"candidate"`
				Index         int    `json:"index"`
				SDPMid        string `json:"sdpMid"`
				SDPMLineIndex int    `json:"sdpMLineIndex"`
			}
			_ = json.Unmarshal(env.Payload, &p)
			events.OnCandidate(env.AttemptID, p.Candidate, p.Index, p.SDPMid, p.SDPMLineIndex)
		case "candidates-end":
			events.OnCandidatesEnd(env.AttemptID)
		case "peer.connected":
			events.OnConnected(env.AttemptID)
		case "peer.released":
			var p struct {
				Reason string `json:"reason"`
			}
			_ = json.Unmarshal(env.Payload, &p)
			events.OnReleased(env.AttemptID, p.Reason)
		case "error":
			var p struct {
				Code string `json:"code"`
			}
			_ = json.Unmarshal(env.Payload, &p)
			events.OnError(p.Code)
		default:
		}
	}
}

func (t *SignalTransport) write(env SocketEnvelope) error {
	raw, err := json.Marshal(env)
	if err != nil {
		return err
	}
	t.sendMu.Lock()
	defer t.sendMu.Unlock()
	t.mu.Lock()
	conn := t.socket
	t.mu.Unlock()
	if conn == nil {
		return fmt.Errorf("signal: socket not connected")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return conn.Write(ctx, websocket.MessageText, raw)
}

func (t *SignalTransport) nextRequestID() string {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.reqCounter++
	return fmt.Sprintf("host-req-%d", t.reqCounter)
}

func mustPayload(v any) json.RawMessage {
	raw, _ := json.Marshal(v)
	return raw
}

// Done implements HostSignalingTransport: it closes when the socket read
// loop exits. A nil channel blocks forever when no socket is open.
func (t *SignalTransport) Done() <-chan struct{} {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.socketDone == nil {
		return nil
	}
	return t.socketDone
}

// Accept implements HostSignalingTransport.
func (t *SignalTransport) Accept(attemptID string) error {
	return t.write(SocketEnvelope{Version: 1, Type: "accept", RequestID: t.nextRequestID(), AttemptID: attemptID})
}

// Reject implements HostSignalingTransport.
func (t *SignalTransport) Reject(attemptID string) error {
	return t.write(SocketEnvelope{Version: 1, Type: "reject", RequestID: t.nextRequestID(), AttemptID: attemptID})
}

// Release implements HostSignalingTransport.
func (t *SignalTransport) Release(attemptID string) error {
	return t.write(SocketEnvelope{Version: 1, Type: "release", RequestID: t.nextRequestID(), AttemptID: attemptID})
}

// SendAnswer implements HostSignalingTransport.
func (t *SignalTransport) SendAnswer(attemptID, sdp string) error {
	return t.write(SocketEnvelope{Version: 1, Type: "answer", RequestID: t.nextRequestID(), AttemptID: attemptID, Payload: mustPayload(map[string]any{"sdp": sdp})})
}

// SendCandidate implements HostSignalingTransport.
func (t *SignalTransport) SendCandidate(attemptID, candidate string, index int, sdpMid string, sdpMLineIndex int) error {
	return t.write(SocketEnvelope{Version: 1, Type: "candidate", RequestID: t.nextRequestID(), AttemptID: attemptID, Payload: mustPayload(map[string]any{"candidate": candidate, "index": index, "sdpMid": sdpMid, "sdpMLineIndex": sdpMLineIndex})})
}

// SendCandidatesEnd implements HostSignalingTransport.
func (t *SignalTransport) SendCandidatesEnd(attemptID string) error {
	return t.write(SocketEnvelope{Version: 1, Type: "candidates-end", RequestID: t.nextRequestID(), AttemptID: attemptID})
}

// SendConnected implements HostSignalingTransport.
func (t *SignalTransport) SendConnected(attemptID string) error {
	return t.write(SocketEnvelope{Version: 1, Type: "connected", RequestID: t.nextRequestID(), AttemptID: attemptID})
}

// Close implements HostSignalingTransport.
func (t *SignalTransport) Close() error {
	t.mu.Lock()
	conn := t.socket
	t.socket = nil
	t.mu.Unlock()
	if conn != nil {
		return conn.Close(websocket.StatusNormalClosure, "host shutdown")
	}
	return nil
}
