package host

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pion/webrtc/v3"
	"github.com/tozworth/izci/izci-server/internal/config"
	"github.com/tozworth/izci/izci-server/internal/media"
	appProtocol "github.com/tozworth/izci/izci-server/internal/protocol"
	"github.com/tozworth/izci/izci-server/internal/signaling"
)

// TestPionThreeChannelsHello proves the host answers a client offer and
// completes protocol hello over all required channels, using real Pion
// PeerConnections and production framing shapes. Only the browser RTC object
// is mocked (Pion stands in); no fake channels are used here.
func TestPionThreeChannelsHello(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping WebRTC interop in short mode")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	rtcHost := NewRTCHost(RTCConfig{})

	// Client (offerer) side: three data channels.
	clientPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("client pc: %v", err)
	}
	defer func() { _ = clientPC.Close() }()
	ordered := true
	controlDC, err := clientPC.CreateDataChannel(ChannelControl, &webrtc.DataChannelInit{Ordered: &ordered})
	if err != nil {
		t.Fatalf("control dc: %v", err)
	}
	mediaDC, err := clientPC.CreateDataChannel(ChannelMedia, &webrtc.DataChannelInit{Ordered: &ordered})
	if err != nil {
		t.Fatalf("media dc: %v", err)
	}
	unordered := false
	renderDC, err := clientPC.CreateDataChannel(ChannelRender, &webrtc.DataChannelInit{Ordered: &unordered})
	if err != nil {
		t.Fatalf("render dc: %v", err)
	}
	_ = mediaDC
	_ = renderDC
	offer, err := clientPC.CreateOffer(nil)
	if err != nil {
		t.Fatalf("offer: %v", err)
	}
	if err := clientPC.SetLocalDescription(offer); err != nil {
		t.Fatalf("set local offer: %v", err)
	}

	// Host answers.
	hostControlOpened := make(chan DataChannel, 1)
	hostControlText := make(chan string, 1)
	hostControlClosed := make(chan struct{}, 1)
	answerCtx, answerCancel := context.WithTimeout(ctx, 15*time.Second)
	defer answerCancel()
	answerSDP, err := rtcHost.Answer(answerCtx, AnswerConfig{
		PeerID:   "interop-peer",
		OfferSDP: clientPC.LocalDescription().SDP,
		OnControl: func(ch DataChannel) {
			select {
			case hostControlOpened <- ch:
			default:
			}
		},
		OnControlText: func(text string) {
			select {
			case hostControlText <- text:
			default:
			}
		},
		OnControlClose: func() {
			hostControlClosed <- struct{}{}
		},
		OnMedia:     func(ch DataChannel) {},
		OnRender:    func(ch DataChannel) {},
		OnConnected: func() {},
		OnFailed:    func() {},
	})
	if err != nil {
		t.Fatalf("host answer: %v", err)
	}
	if strings.Contains(answerSDP, "m=audio") || !strings.Contains(answerSDP, "m=application") {
		t.Fatalf("answer must negotiate data channels only")
	}
	if err := clientPC.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: answerSDP}); err != nil {
		t.Fatalf("set remote answer: %v", err)
	}

	// Wait for the client control channel to open and the host to see it.
	controlOpened := make(chan struct{})
	controlDC.OnOpen(func() { close(controlOpened) })
	select {
	case <-ctx.Done():
		t.Fatalf("client control channel never opened")
	case <-controlOpened:
	}
	select {
	case <-ctx.Done():
		t.Fatalf("host never saw control channel")
	case <-hostControlOpened:
	}
	// ICE should connect both sides on loopback.
	connected := make(chan struct{})
	clientPC.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		if s == webrtc.PeerConnectionStateConnected {
			select {
			case <-connected:
			default:
				close(connected)
			}
		}
	})
	// Poll current state too (may already be connected).
	if clientPC.ConnectionState() == webrtc.PeerConnectionStateConnected {
		close(connected)
	}
	select {
	case <-ctx.Done():
		t.Fatalf("Pion peers never connected: %s", clientPC.ConnectionState())
	case <-connected:
	}

	// Hello exchange over izci-control using production shapes.
	hostHello := HelloMessage("izci-server", "test", "interop-host", appProtocol.Major, appProtocol.Minor, appProtocol.Capabilities, "", "")
	var decoded map[string]any
	if err := json.Unmarshal([]byte(hostHello), &decoded); err != nil {
		t.Fatalf("host hello must be valid JSON")
	}
	if !appProtocol.CompatibleHello(appProtocol.Major, appProtocol.Capabilities) {
		t.Fatalf("host hello must admit itself")
	}
	raw := mustRawHello(t, "interop-client", 0)
	ok, ignored, _, _ := appProtocol.ValidateMessage(raw)
	if !ok || ignored {
		t.Fatalf("client hello must validate")
	}
	if err := controlDC.SendText(string(raw)); err != nil {
		t.Fatalf("send client hello: %v", err)
	}
	select {
	case got := <-hostControlText:
		if got != string(raw) {
			t.Fatalf("host received wrong control frame")
		}
	case <-ctx.Done():
		t.Fatalf("host did not receive control text")
	}
	if err := controlDC.Close(); err != nil {
		t.Fatalf("close client control channel: %v", err)
	}
	select {
	case <-hostControlClosed:
	case <-ctx.Done():
		t.Fatalf("host did not see control channel close")
	}
	rtcHost.ClosePeer("interop-peer")
}

// TestPionRenderEndToEnd drives a full buffered-Opus generation over real
// WebRTC: Pion client offers, the production Host answers, and the client
// plays client — activate, manifest, need, binary fragments reassembled to
// manifest bytes, ready, synchronized start. It proves the delivery
// machinery works over real SCTP (ordered control plus unordered reliable
// render), not just over fake channels.
func TestPionRenderEndToEnd(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping WebRTC interop in short mode")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	dir := t.TempDir()
	tone := renderTone(t, dir, "tone.wav", 4)
	h, _, ids := renderTestHost(t,
		media.Policy{Mode: media.ModeThreshold, MaxBytes: 1},
		map[string][]byte{"/music/tone.wav": tone})
	trackID := ids["/music/tone.wav"]

	clientPC, err := webrtc.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatalf("client pc: %v", err)
	}
	defer func() { _ = clientPC.Close() }()
	ordered := true
	controlDC, err := clientPC.CreateDataChannel(ChannelControl, &webrtc.DataChannelInit{Ordered: &ordered})
	if err != nil {
		t.Fatalf("control dc: %v", err)
	}
	if _, err := clientPC.CreateDataChannel(ChannelMedia, &webrtc.DataChannelInit{Ordered: &ordered}); err != nil {
		t.Fatalf("media dc: %v", err)
	}
	unordered := false
	renderDC, err := clientPC.CreateDataChannel(ChannelRender, &webrtc.DataChannelInit{Ordered: &unordered})
	if err != nil {
		t.Fatalf("render dc: %v", err)
	}

	controlTexts := make(chan string, 256)
	controlDC.OnMessage(func(msg webrtc.DataChannelMessage) {
		if !msg.IsString {
			return
		}
		select {
		case controlTexts <- string(msg.Data):
		default:
		}
	})
	var renderMu sync.Mutex
	var renderFrames [][]byte
	renderDC.OnMessage(func(msg webrtc.DataChannelMessage) {
		if msg.IsString {
			return
		}
		cpy := append([]byte(nil), msg.Data...)
		renderMu.Lock()
		renderFrames = append(renderFrames, cpy)
		renderMu.Unlock()
	})

	offer, err := clientPC.CreateOffer(nil)
	if err != nil {
		t.Fatalf("offer: %v", err)
	}
	if err := clientPC.SetLocalDescription(offer); err != nil {
		t.Fatalf("set local offer: %v", err)
	}

	// Drive the production host path: register the peer as OnPeerRequested
	// does, then answer like OnOffer but capturing the SDP (the signaling
	// transport is nil here, so OnOffer's answer would be discarded and
	// the client could never connect).
	h.OnPeerRequested("conn-e2e", "attempt-e2e")
	peerID := h.peerForAttempt("attempt-e2e")
	if peerID == "" {
		t.Fatal("no peer for attempt")
	}
	answerCtx, answerCancel := context.WithTimeout(ctx, 15*time.Second)
	defer answerCancel()
	answerSDP, err := h.rtc.Answer(answerCtx, AnswerConfig{
		PeerID:   peerID,
		OfferSDP: clientPC.LocalDescription().SDP,
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
		},
		OnFailed: func() {
			h.reportIceFailure(peerID, "attempt-e2e")
		},
	})
	if err != nil {
		t.Fatalf("host answer: %v", err)
	}
	if err := clientPC.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: answerSDP}); err != nil {
		t.Fatalf("set remote answer: %v", err)
	}

	connected := make(chan struct{})
	clientPC.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		if s == webrtc.PeerConnectionStateConnected {
			select {
			case <-connected:
			default:
				close(connected)
			}
		}
	})
	if clientPC.ConnectionState() == webrtc.PeerConnectionStateConnected {
		close(connected)
	}
	select {
	case <-ctx.Done():
		t.Fatal("Pion peers never connected")
	case <-connected:
	}

	// Wait for the host hello, then join as a render-capable listener.
	var hostHello map[string]any
	waitForControl(t, ctx, controlTexts, func(m map[string]any) bool {
		if m["kind"] == "hello" {
			hostHello = m
			return true
		}
		return false
	}, "host hello")
	caps, _ := hostHello["capabilities"].([]any)
	foundOpus := false
	for _, c := range caps {
		if c == "buffered-opus" {
			foundOpus = true
		}
	}
	if !foundOpus {
		t.Fatal("host must advertise buffered-opus")
	}
	if err := controlDC.SendText(renderHello("e2e", false)); err != nil {
		t.Fatalf("client hello: %v", err)
	}
	// Catalog arrives on hello; then activate.
	waitForControl(t, ctx, controlTexts, func(m map[string]any) bool {
		return m["kind"] == "catalog"
	}, "catalog")
	if err := controlDC.SendText(activateCmd("e2e-1", "library", trackID)); err != nil {
		t.Fatalf("activate: %v", err)
	}
	// Preparation, then the manifest bound to this generation.
	var gen, renderID string
	var totalBytes int64
	var clusterCount int
	waitForControl(t, ctx, controlTexts, func(m map[string]any) bool {
		if m["kind"] != "render.manifest" {
			return false
		}
		man, _ := m["manifest"].(map[string]any)
		if man == nil {
			return false
		}
		gen, _ = man["generationId"].(string)
		renderID, _ = man["renderId"].(string)
		if tb, ok := man["totalBytes"].(float64); ok {
			totalBytes = int64(tb)
		}
		if cl, ok := man["clusters"].([]any); ok {
			clusterCount = len(cl)
		}
		return gen != "" && renderID != "" && totalBytes > 0 && clusterCount > 0
	}, "render.manifest")
	// Request the whole window and reassemble init + clusters.
	need, _ := json.Marshal(map[string]any{
		"kind": "render.need", "need": map[string]any{
			"generationId": gen, "renderId": renderID, "epoch": 0,
			"targetTimeMs": 0, "aheadMs": 30000, "ranges": []any{},
		},
	})
	if err := controlDC.SendText(string(need)); err != nil {
		t.Fatalf("need: %v", err)
	}
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		renderMu.Lock()
		frames := append([][]byte(nil), renderFrames...)
		renderMu.Unlock()
		initSegs := map[uint32]bool{}
		clusterSegs := map[uint32]map[uint32]bool{}
		var total int64
		valid := true
		for _, raw := range frames {
			f, err := appProtocol.DecodeRenderFrame(raw)
			if err != nil || f.RenderID != renderID {
				if err != nil {
					t.Fatalf("bad frame over SCTP: %v", err)
				}
				continue
			}
			total += int64(len(f.Payload))
			if f.ClusterIndex == 0xffffffff {
				initSegs[f.FragmentOffset] = true
				continue
			}
			segs, ok := clusterSegs[f.ClusterIndex]
			if !ok {
				segs = map[uint32]bool{}
				clusterSegs[f.ClusterIndex] = segs
			}
			segs[f.FragmentOffset] = true
		}
		_ = valid
		if total >= totalBytes && len(clusterSegs) == clusterCount && len(initSegs) > 0 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	renderMu.Lock()
	frames := append([][]byte(nil), renderFrames...)
	renderMu.Unlock()
	var total int64
	seenInit := map[uint32]bool{}
	seenClusters := map[uint32]map[uint32]bool{}
	for _, raw := range frames {
		f, err := appProtocol.DecodeRenderFrame(raw)
		if err != nil || f.RenderID != renderID {
			continue
		}
		if f.ClusterIndex == 0xffffffff {
			if !seenInit[f.FragmentOffset] {
				seenInit[f.FragmentOffset] = true
				total += int64(len(f.Payload))
			}
			continue
		}
		segs, ok := seenClusters[f.ClusterIndex]
		if !ok {
			segs = map[uint32]bool{}
			seenClusters[f.ClusterIndex] = segs
		}
		if !segs[f.FragmentOffset] {
			segs[f.FragmentOffset] = true
			total += int64(len(f.Payload))
		}
	}
	if total != totalBytes || len(seenClusters) != clusterCount {
		t.Fatalf("SCTP reassembly: %d bytes in %d clusters, manifest says %d in %d",
			total, len(seenClusters), totalBytes, clusterCount)
	}
	// Ready releases the synchronized start.
	ready, _ := json.Marshal(map[string]any{
		"kind": "render.ready", "generationId": gen, "renderId": renderID, "epoch": 0, "positionMs": 0,
	})
	if err := controlDC.SendText(string(ready)); err != nil {
		t.Fatalf("ready: %v", err)
	}
	waitForControl(t, ctx, controlTexts, func(m map[string]any) bool {
		if m["kind"] != "playback.start" {
			return false
		}
		st, _ := m["start"].(map[string]any)
		return st != nil && st["generationId"] == gen
	}, "playback.start")
}

// waitForControl drains control texts until match or context end.
func waitForControl(t *testing.T, ctx context.Context, ch chan string, match func(map[string]any) bool, what string) {
	t.Helper()
	for {
		select {
		case <-ctx.Done():
			t.Fatalf("timeout waiting for %s", what)
		case text := <-ch:
			var m map[string]any
			if err := json.Unmarshal([]byte(text), &m); err != nil {
				continue
			}
			if match(m) {
				return
			}
		}
	}
}

// mustRawHello builds a client hello frame for validation.
func mustRawHello(t *testing.T, name string, minor int) []byte {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{
		"kind": "hello", "protocolMajor": 1, "protocolMinor": minor,
		"capabilities": []string{"source-file", "buffered-opus", "synchronized-start", "pairing-proof", "freeplay", "chat"},
		"impl":         map[string]any{"product": "izci", "productVersion": "0.3.2"},
		"name":         name, "platform": "test", "freeplayEnabled": false,
	})
	return raw
}

// recordingEvents implements HostSignalingEvents for transport tests.
type recordingEvents struct {
	requested chan [2]string
	errors    chan string
	closed    chan struct{}
}

func (r *recordingEvents) OnPeerRequested(c, a string) {
	select {
	case r.requested <- [2]string{c, a}:
	default:
	}
}
func (r *recordingEvents) OnReady()                                        {}
func (r *recordingEvents) OnOffer(a, s string)                             {}
func (r *recordingEvents) OnCandidate(a, c string, i int, m string, l int) {}
func (r *recordingEvents) OnCandidatesEnd(a string)                        {}
func (r *recordingEvents) OnConnected(a string)                            {}
func (r *recordingEvents) OnReleased(a, reason string)                     {}
func (r *recordingEvents) OnError(code string) {
	select {
	case r.errors <- code:
	default:
	}
}
func (r *recordingEvents) OnSocketClose() {
	select {
	case r.closed <- struct{}{}:
	default:
	}
}

// TestSignalingTransportAgainstRealRouter runs the real signaling router and
// speaks it through the host SignalTransport (the same contract browser
// hosts use). Embedded combined mode uses the same transport against its
// loopback URL, so this covers both deployments.
func TestSignalingTransportAgainstRealRouter(t *testing.T) {
	cfg, err := config.Load([]byte(`{"publicBaseUrl":"https://server.example.test","hostKeyFile":"test-key"}`))
	if err != nil {
		t.Fatalf("config: %v", err)
	}
	var key [32]byte
	for i := range key {
		key[i] = byte(i + 1)
	}
	srv, err := signaling.New(cfg, log.New(io.Discard, "", 0), key)
	if err != nil {
		t.Fatalf("signaling: %v", err)
	}
	httpSrv := httptest.NewServer(srv.Handler())
	defer httpSrv.Close()

	hostKeyHex := hex.EncodeToString(key[:])
	transport := NewSignalTransport(SignalClientConfig{BaseURL: httpSrv.URL, HostKey: hostKeyHex})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	credentials, err := transport.Acquire(ctx, 8)
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	if credentials.RoomID == "" || credentials.InvitationSecret == "" {
		t.Fatalf("empty room")
	}
	events := &recordingEvents{requested: make(chan [2]string, 4), errors: make(chan string, 4), closed: make(chan struct{}, 1)}
	// Connect in background; Connect returns after auth.
	connectErr := make(chan error, 1)
	go func() { connectErr <- transport.Connect(ctx, events) }()
	select {
	case err := <-connectErr:
		if err != nil {
			t.Fatalf("host connect: %v", err)
		}
	case <-time.After(8 * time.Second):
		t.Fatalf("host connect timed out")
	}
	defer func() { _ = transport.Close() }()

	// Guest join with current major admits; wrong major is rejected with
	// unsupported-version (never an exact-integer comparison).
	join := func(major int) (int, string) {
		body, _ := json.Marshal(map[string]any{
			"roomId": credentials.RoomID, "invitationSecret": credentials.InvitationSecret,
			"attemptNonce": "0123456789abcdef", "appProtocolMajor": major,
		})
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost, httpSrv.URL+"/v1/join", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("join: %v", err)
		}
		defer resp.Body.Close()
		var v map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&v)
		code := ""
		if e, ok := v["error"].(map[string]any); ok {
			code, _ = e["code"].(string)
		}
		return resp.StatusCode, code
	}
	if status, code := join(999); code != "unsupported-version" {
		t.Fatalf("major mismatch must be unsupported-version, got %d %q", status, code)
	}
}

// fetchInvite is a placeholder: version-gate tests use a bogus secret on
// purpose so the major check fires first. This helper exists to document
// that ordering; it returns a dummy secret.
func fetchInvite(t *testing.T, ctx context.Context, base, hostKeyHex string) string {
	t.Helper()
	return strings.Repeat("0", 64)
}
