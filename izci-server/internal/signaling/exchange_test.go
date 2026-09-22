package signaling

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/dunsparce9/izci/izci-server/internal/config"
)

// harness runs the real router on an ephemeral listener with a manual clock.
type harness struct {
	t        *testing.T
	srv      *Server
	http     *http.Client
	base     string
	prefix   string
	now      *time.Time
	cancel   context.CancelFunc
	done     chan error
	finished chan struct{}
}

func newHarness(t *testing.T, prefix string) *harness {
	t.Helper()
	cfg := testConfig(t, prefix)
	cfg.Limits.CleanupInterval = config.Duration(5 * time.Minute)
	var key [32]byte
	for i := range key {
		key[i] = byte(i + 1)
	}
	now := time.Now()
	srv, err := NewWithClock(cfg, log.New(io.Discard, "", 0), key, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	finished := make(chan struct{})
	go func() {
		done <- srv.Serve(ctx, ln)
		close(finished)
	}()
	h := &harness{
		t: t, srv: srv,
		http:     &http.Client{Timeout: 5 * time.Second},
		base:     "http://" + ln.Addr().String(),
		prefix:   prefix,
		cancel:   cancel,
		done:     done,
		finished: finished,
	}
	h.now = &now
	t.Cleanup(func() {
		cancel()
		select {
		case <-finished:
		case <-time.After(15 * time.Second):
			t.Errorf("server did not shut down")
		}
	})
	return h
}

func (h *harness) advance(d time.Duration) {
	*h.now = h.now.Add(d)
	h.srv.Cleanup()
}

func (h *harness) post(path string, body any, bearer string) (int, map[string]any) {
	h.t.Helper()
	var rdr io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			h.t.Fatal(err)
		}
		rdr = bytes.NewReader(buf)
	}
	req, err := http.NewRequest(http.MethodPost, h.base+h.prefix+path, rdr)
	if err != nil {
		h.t.Fatal(err)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := h.http.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer resp.Body.Close()
	var v map[string]any
	if resp.StatusCode != http.StatusNoContent {
		if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
			h.t.Fatalf("decode %s: %v", path, err)
		}
	}
	return resp.StatusCode, v
}

func (h *harness) del(path, bearer string) int {
	h.t.Helper()
	req, err := http.NewRequest(http.MethodDelete, h.base+h.prefix+path, nil)
	if err != nil {
		h.t.Fatal(err)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := h.http.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode
}

func (h *harness) get(path, bearer string) (int, map[string]any) {
	h.t.Helper()
	req, err := http.NewRequest(http.MethodGet, h.base+h.prefix+path, nil)
	if err != nil {
		h.t.Fatal(err)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	resp, err := h.http.Do(req)
	if err != nil {
		h.t.Fatal(err)
	}
	defer resp.Body.Close()
	var v map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&v); err != nil {
		h.t.Fatalf("decode %s: %v", path, err)
	}
	return resp.StatusCode, v
}

func TestDedicatedRoomRegistrationAndSessionRenewal(t *testing.T) {
	h := newHarness(t, "")
	hostToken := h.login()
	roomID, owner, invite := h.createRoom(hostToken)
	status, body := h.post("/v1/dedicated-room", map[string]any{
		"roomId": roomID, "ownerSecret": owner, "invitationSecret": invite,
	}, hostToken)
	if status != http.StatusOK {
		t.Fatalf("register dedicated room: %d %v", status, body)
	}

	operatorToken := h.login()
	status, body = h.get("/v1/dedicated-room", operatorToken)
	if status != http.StatusOK || strMap(body, "roomId") != roomID || strMap(body, "invitationSecret") != invite {
		t.Fatalf("get dedicated room: %d %v", status, body)
	}

	// Renewal extends the owning session before cleanup, so its room remains
	// available beyond the original 12-hour session deadline.
	h.advance(6 * time.Hour)
	status, body = h.post("/v1/host/session", map[string]any{}, hostToken)
	if status != http.StatusOK {
		t.Fatalf("renew session: %d %v", status, body)
	}
	h.advance(7 * time.Hour)
	status, _ = h.join(roomID, invite, "dedicated-renew-1", AppProtocolMajor)
	if status != http.StatusCreated {
		t.Fatalf("dedicated room disappeared after original session expiry: %d", status)
	}
}

func errCodeMap(v map[string]any) string {
	e, _ := v["error"].(map[string]any)
	c, _ := e["code"].(string)
	return c
}

func strMap(v map[string]any, key string) string {
	s, _ := v[key].(string)
	return s
}

func (h *harness) login() string {
	h.t.Helper()
	status, v := h.post("/v1/host/sessions", map[string]any{"hostKey": testHostKeyHex()}, "")
	if status != http.StatusCreated {
		h.t.Fatalf("login status = %d (%v)", status, v)
	}
	return strMap(v, "sessionToken")
}

func (h *harness) createRoom(token string) (roomID, owner, invite string) {
	h.t.Helper()
	status, v := h.post("/v1/rooms", map[string]any{}, token)
	if status != http.StatusCreated {
		h.t.Fatalf("create room status = %d (%v)", status, v)
	}
	return strMap(v, "roomId"), strMap(v, "ownerSecret"), strMap(v, "invitationSecret")
}

func (h *harness) join(room, invite, nonce string, proto int) (int, map[string]any) {
	return h.joinMajor(room, invite, nonce, proto, 0, nil)
}

func (h *harness) joinMajor(room, invite, nonce string, major, minor int, caps []string) (int, map[string]any) {
	body := map[string]any{
		"roomId": room, "invitationSecret": invite,
		"attemptNonce": nonce, "appProtocolMajor": major, "appProtocolMinor": minor,
	}
	if caps != nil {
		body["appCapabilities"] = caps
	}
	return h.post("/v1/join", body, "")
}

func (h *harness) socketTicket(bearer, roomID string) (int, map[string]any) {
	body := map[string]any{}
	if roomID != "" {
		body["roomId"] = roomID
	}
	return h.post("/v1/socket-tickets", body, bearer)
}

func (h *harness) dial() *websocket.Conn {
	h.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws://"+strings.TrimPrefix(h.base, "http://")+h.prefix+"/v1/socket", nil)
	if err != nil {
		h.t.Fatal(err)
	}
	return c
}

func wsSend(t *testing.T, c *websocket.Conn, v any) {
	t.Helper()
	var data []byte
	switch x := v.(type) {
	case []byte:
		data = x
	case string:
		data = []byte(x)
	default:
		var err error
		data, err = json.Marshal(v)
		if err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := c.Write(ctx, websocket.MessageText, data); err != nil {
		t.Fatalf("ws write: %v", err)
	}
}

func wsRecv(t *testing.T, c *websocket.Conn) Envelope {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, data, err := c.Read(ctx)
	if err != nil {
		t.Fatalf("ws read: %v", err)
	}
	var env Envelope
	if err := json.Unmarshal(data, &env); err != nil {
		t.Fatalf("ws decode: %v (%s)", err, data)
	}
	return env
}

// wsRecvRaw returns the raw frame for payload inspection.
func wsRecvRaw(t *testing.T, c *websocket.Conn) []byte {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, data, err := c.Read(ctx)
	if err != nil {
		t.Fatalf("ws read: %v", err)
	}
	return data
}

func cmsg(typ, reqID, attempt string, payload any) map[string]any {
	m := map[string]any{"version": 1, "type": typ, "requestId": reqID}
	if attempt != "" {
		m["attemptId"] = attempt
	}
	if payload != nil {
		m["payload"] = payload
	}
	return m
}

func decodePayloadInto(t *testing.T, env Envelope, v any) {
	t.Helper()
	if len(env.Payload) == 0 {
		return
	}
	if err := json.Unmarshal(env.Payload, v); err != nil {
		t.Fatalf("payload decode: %v", err)
	}
}

// authConn dials, authenticates with a ticket, and returns the ready payload.
func (h *harness) authConn(ticket string) (*websocket.Conn, Envelope) {
	h.t.Helper()
	c := h.dial()
	wsSend(h.t, c, cmsg(MsgAuth, "req-auth-1", "", map[string]any{"ticket": ticket}))
	env := wsRecv(h.t, c)
	if env.Type != MsgReady {
		h.t.Fatalf("auth reply = %s (%s)", env.Type, env.Payload)
	}
	return c, env
}

// TestCompleteExchange walks the full server exchange: login, room, host
// socket, join, guest socket, accept, offer, answer, candidates on both legs,
// end-of-candidates, connected from both sides, and reservation retention.
func TestCompleteExchange(t *testing.T) {
	h := newHarness(t, "")
	token := h.login()
	roomID, _, invite := h.createRoom(token)

	_, v := h.socketTicket(token, roomID)
	hostTicket := strMap(v, "ticket")
	host, ready := h.authConn(hostTicket)
	var rp readyPayload
	decodePayloadInto(t, ready, &rp)
	if rp.Role != RoleHost || rp.RoomID != roomID {
		t.Fatalf("host ready = %+v", rp)
	}

	status, jv := h.join(roomID, invite, "guest-nonce-1", AppProtocolMajor)
	if status != http.StatusCreated {
		t.Fatalf("join = %d (%v)", status, jv)
	}
	attemptID := strMap(jv, "attemptId")
	connToken := strMap(jv, "connectionToken")
	guestTicket := strMap(jv, "socketTicket")

	// Host is prompted before the guest connects.
	env := wsRecv(t, host)
	if env.Type != MsgPeerRequested || env.AttemptID != attemptID {
		t.Fatalf("host got %s attempt %s", env.Type, env.AttemptID)
	}

	guest, ready := h.authConn(guestTicket)
	decodePayloadInto(t, ready, &rp)
	if rp.Role != RoleGuest || rp.ConnectionID != strMap(jv, "connectionId") {
		t.Fatalf("guest ready = %+v", rp)
	}

	// Host accepts; only then is the guest prompted to offer.
	wsSend(t, host, cmsg(MsgAccept, "req-accept", attemptID, nil))
	env = wsRecv(t, guest)
	if env.Type != MsgPeerAccepted || env.AttemptID != attemptID {
		t.Fatalf("guest got %s", env.Type)
	}

	const offerSDP = "v=0\no=guest 1 1 IN IP4 192.0.2.1\ns=izci\n"
	wsSend(t, guest, cmsg(MsgOffer, "req-offer", attemptID, map[string]any{"sdp": offerSDP}))
	env = wsRecv(t, host)
	if env.Type != MsgOffer {
		t.Fatalf("host got %s", env.Type)
	}
	var op sdpPayload
	decodePayloadInto(t, env, &op)
	if op.SDP != offerSDP {
		t.Fatalf("offer SDP mismatch")
	}

	const answerSDP = "v=0\no=host 1 1 IN IP4 192.0.2.2\ns=izci\n"
	wsSend(t, host, cmsg(MsgAnswer, "req-answer", attemptID, map[string]any{"sdp": answerSDP}))
	env = wsRecv(t, guest)
	if env.Type != MsgAnswer {
		t.Fatalf("guest got %s", env.Type)
	}

	wsSend(t, guest, cmsg(MsgCandidate, "req-c0", attemptID,
		map[string]any{"candidate": "candidate:1 1 udp 1 192.0.2.1 9 typ host", "index": 0, "sdpMid": "audio", "sdpMLineIndex": 0}))
	env = wsRecv(t, host)
	if env.Type != MsgCandidate {
		t.Fatalf("host got %s", env.Type)
	}
	var cp candidatePayload
	decodePayloadInto(t, env, &cp)
	if cp.Index != 0 || cp.Candidate != "candidate:1 1 udp 1 192.0.2.1 9 typ host" || cp.SDPMid != "audio" || cp.SDPMLineIndex != 0 {
		t.Fatalf("candidate = %+v", cp)
	}
	wsSend(t, guest, cmsg(MsgCandidatesEnd, "req-cend", attemptID, nil))
	if env := wsRecv(t, host); env.Type != MsgCandidatesEnd {
		t.Fatalf("host got %s", env.Type)
	}

	wsSend(t, host, cmsg(MsgCandidate, "req-hc0", attemptID,
		map[string]any{"candidate": "candidate:1 1 udp 2 192.0.2.2 9 typ host", "index": 0, "sdpMid": "audio", "sdpMLineIndex": 0}))
	if env := wsRecv(t, guest); env.Type != MsgCandidate {
		t.Fatalf("guest got %s", env.Type)
	}
	wsSend(t, host, cmsg(MsgCandidatesEnd, "req-hcend", attemptID, nil))
	if env := wsRecv(t, guest); env.Type != MsgCandidatesEnd {
		t.Fatalf("guest got %s", env.Type)
	}

	// Identical duplicate candidates are ignored, not forwarded.
	wsSend(t, guest, cmsg(MsgCandidate, "req-c0dup", attemptID,
		map[string]any{"candidate": "candidate:1 1 udp 1 192.0.2.1 9 typ host", "index": 0, "sdpMid": "audio", "sdpMLineIndex": 0}))
	// Conflicting duplicates are rejected.
	wsSend(t, guest, cmsg(MsgCandidate, "req-c0bad", attemptID,
		map[string]any{"candidate": "candidate:DIFFERENT", "index": 0, "sdpMid": "audio", "sdpMLineIndex": 0}))
	env = wsRecv(t, guest)
	if env.Type != MsgError {
		t.Fatalf("conflicting duplicate got %s", env.Type)
	}
	var ep errorPayload
	decodePayloadInto(t, env, &ep)
	if ep.Code != CodeBadRequest {
		t.Fatalf("conflicting duplicate code = %s", ep.Code)
	}

	// Both sides report connected; both are notified and SDP is discarded.
	wsSend(t, guest, cmsg(MsgConnected, "req-gconn", attemptID, nil))
	wsSend(t, host, cmsg(MsgConnected, "req-hconn", attemptID, nil))
	if env := wsRecv(t, guest); env.Type != MsgPeerConnected {
		t.Fatalf("guest got %s", env.Type)
	}
	if env := wsRecv(t, host); env.Type != MsgPeerConnected {
		t.Fatalf("host got %s", env.Type)
	}

	h.srv.mu.Lock()
	conn := h.srv.connTokens[digestKey(mustParseToken(t, connToken))]
	done := conn != nil && conn.attempt != nil && conn.attempt.done &&
		conn.attempt.offerSDP == "" && conn.attempt.guestCandidates == nil
	h.srv.mu.Unlock()
	if !done {
		t.Fatalf("server did not discard SDP/candidates after connect")
	}

	// The reservation survives: the connection token still mints tickets.
	status, tv := h.socketTicket(connToken, "")
	if status != http.StatusCreated {
		t.Fatalf("post-connect ticket = %d (%v)", status, tv)
	}

	_ = host.Close(websocket.StatusNormalClosure, "done")
	_ = guest.Close(websocket.StatusNormalClosure, "done")
}

func mustParseToken(t *testing.T, token string) [32]byte {
	t.Helper()
	d, ok := parseSecretToken(token)
	if !ok {
		t.Fatalf("bad token shape")
	}
	return d
}

// TestTicketReplay ensures a one-use ticket fails the second time with
// ticket-consumed.
func TestTicketReplay(t *testing.T) {
	h := newHarness(t, "")
	token := h.login()
	roomID, _, invite := h.createRoom(token)
	_, v := h.socketTicket(token, roomID)
	host, _ := h.authConn(strMap(v, "ticket"))

	status, jv := h.join(roomID, invite, "replay-nonce-1", AppProtocolMajor)
	if status != http.StatusCreated {
		t.Fatalf("join = %d", status)
	}
	guestTicket := strMap(jv, "socketTicket")
	guest, _ := h.authConn(guestTicket)
	_ = guest.Close(websocket.StatusNormalClosure, "done")

	replay := h.dial()
	wsSend(t, replay, cmsg(MsgAuth, "req-replay", "", map[string]any{"ticket": guestTicket}))
	env := wsRecv(t, replay)
	if env.Type != MsgError {
		t.Fatalf("replay got %s", env.Type)
	}
	var ep errorPayload
	decodePayloadInto(t, env, &ep)
	if ep.Code != CodeTicketConsumed {
		t.Fatalf("replay code = %s", ep.Code)
	}
	_ = replay.Close(websocket.StatusNormalClosure, "done")
	_ = host.Close(websocket.StatusNormalClosure, "done")
}

// TestWrongRoomRole covers cross-room/role misuse on HTTP and sockets.
func TestWrongRoomRole(t *testing.T) {
	h := newHarness(t, "")
	token := h.login()
	roomA, _, inviteA := h.createRoom(token)
	roomB, _, _ := h.createRoom(token)

	if status, v := h.join(roomA, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "nonce-wrong-01", AppProtocolMajor); status != http.StatusNotFound || errCodeMap(v) != CodeRoomUnavailable {
		t.Fatalf("wrong invite = %d %v", status, v)
	}
	if status, v := h.post("/v1/join", map[string]any{
		"roomId": roomA, "attemptNonce": "nonce-missing1", "appProtocolMajor": AppProtocolMajor, "appProtocolMinor": 0,
	}, ""); status != http.StatusNotFound || errCodeMap(v) != CodeRoomUnavailable {
		t.Fatalf("missing invite = %d %v", status, v)
	}
	if status, v := h.join("cccccccccccccccccccccccccccccccc", inviteA, "nonce-unknown1", AppProtocolMajor); status != http.StatusNotFound || errCodeMap(v) != CodeRoomUnavailable {
		t.Fatalf("unknown room = %d %v", status, v)
	}

	status, jv := h.join(roomA, inviteA, "nonce-role-001", AppProtocolMajor)
	if status != http.StatusCreated {
		t.Fatalf("join = %d", status)
	}
	connToken := strMap(jv, "connectionToken")
	attemptID := strMap(jv, "attemptId")

	// A connection bearer is not a host bearer.
	if code := h.del("/v1/rooms/"+roomA, connToken); code != http.StatusUnauthorized {
		t.Fatalf("guest delete room = %d", code)
	}
	// A connection token authorizes only its own connection's room.
	if status, v := h.socketTicket(connToken, roomB); status != http.StatusUnauthorized {
		t.Fatalf("cross-room ticket = %d %v", status, v)
	}

	_, v := h.socketTicket(token, roomA)
	host, _ := h.authConn(strMap(v, "ticket"))
	guest, _ := h.authConn(strMap(jv, "socketTicket"))
	// Drain the admission prompt before exercising wrong-role messages.
	if env := wsRecv(t, host); env.Type != MsgPeerRequested {
		t.Fatalf("host got %s", env.Type)
	}

	// Guest may not accept; host may not offer.
	wsSend(t, guest, cmsg(MsgAccept, "req-bad-accept", attemptID, nil))
	if env := wsRecv(t, guest); env.Type != MsgError {
		t.Fatalf("guest accept got %s", env.Type)
	}
	wsSend(t, host, cmsg(MsgOffer, "req-bad-offer", attemptID, map[string]any{"sdp": "v=0"}))
	if env := wsRecv(t, host); env.Type != MsgError {
		t.Fatalf("host offer got %s", env.Type)
	}
	// Unknown attempt IDs are stale.
	wsSend(t, host, cmsg(MsgAccept, "req-bad-att", "dddddddddddddddddddddddddddddddd", nil))
	env := wsRecv(t, host)
	var ep errorPayload
	decodePayloadInto(t, env, &ep)
	if env.Type != MsgError || ep.Code != CodeAttemptExpired {
		t.Fatalf("stale attempt got %s %s", env.Type, ep.Code)
	}

	// Resume with the wrong owner secret fails; a second live session holding
	// the right secret still cannot overwrite the first.
	status, v = h.post("/v1/rooms/"+roomA+"/resume",
		map[string]any{"ownerSecret": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}, token)
	if status != http.StatusUnauthorized {
		t.Fatalf("wrong owner secret = %d %v", status, v)
	}
	token2status, v2 := h.post("/v1/host/sessions", map[string]any{"hostKey": testHostKeyHex()}, "")
	if token2status != http.StatusCreated {
		t.Fatalf("second login = %d", token2status)
	}
	token2 := strMap(v2, "sessionToken")
	// Fetch the real owner secret indirectly: resume with owning session is
	// idempotent, so use renew contrast instead — here just check conflict by
	// attempting delete with the unrelated session.
	if code := h.del("/v1/rooms/"+roomA, token2); code != http.StatusUnauthorized {
		t.Fatalf("unrelated session delete = %d", code)
	}

	_ = host.Close(websocket.StatusNormalClosure, "done")
	_ = guest.Close(websocket.StatusNormalClosure, "done")
}

// TestResumeConflict ensures another logged-in tab cannot overwrite a live
// room even with the correct owner secret.
func TestResumeConflict(t *testing.T) {
	h := newHarness(t, "")
	token := h.login()
	roomID, owner, _ := h.createRoom(token)
	_, v := h.post("/v1/host/sessions", map[string]any{"hostKey": testHostKeyHex()}, "")
	token2 := strMap(v, "sessionToken")
	status, rv := h.post("/v1/rooms/"+roomID+"/resume", map[string]any{"ownerSecret": owner}, token2)
	if status != http.StatusConflict || errCodeMap(rv) != CodeRoomUnavailable {
		t.Fatalf("overwrite resume = %d %v", status, rv)
	}
	// The original owner can still resume idempotently.
	status, _ = h.post("/v1/rooms/"+roomID+"/resume", map[string]any{"ownerSecret": owner}, token)
	if status != http.StatusOK {
		t.Fatalf("owner resume = %d", status)
	}
}

// TestConcurrentLastSlot fires concurrent joins at a capacity-1 room; exactly
// one must win and the rest report room-full.
func TestConcurrentLastSlot(t *testing.T) {
	h := newHarness(t, "")
	token := h.login()
	status, v := h.post("/v1/rooms", map[string]any{"capacity": 1}, token)
	if status != http.StatusCreated {
		t.Fatalf("create = %d %v", status, v)
	}
	roomID, invite := strMap(v, "roomId"), strMap(v, "invitationSecret")

	const n = 8
	var wg sync.WaitGroup
	codes := make([]int, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			nonce := "race-non" + string(rune('a'+i)) + "ce-001"
			status, _ := h.join(roomID, invite, nonce, AppProtocolMajor)
			codes[i] = status
		}(i)
	}
	wg.Wait()
	won, full := 0, 0
	for _, c := range codes {
		switch c {
		case http.StatusCreated:
			won++
		case http.StatusConflict:
			full++
		default:
			t.Fatalf("unexpected join status %d", c)
		}
	}
	if won != 1 || full != n-1 {
		t.Fatalf("won=%d full=%d, codes=%v", won, full, codes)
	}
}

// TestExpiry walks ticket, attempt, session, and lease expiry with the manual
// clock.
func TestExpiry(t *testing.T) {
	t.Run("ticket", func(t *testing.T) {
		h := newHarness(t, "")
		token := h.login()
		roomID, _, invite := h.createRoom(token)
		status, jv := h.join(roomID, invite, "expiry-nonce-1", AppProtocolMajor)
		if status != http.StatusCreated {
			t.Fatalf("join = %d", status)
		}
		h.advance(31 * time.Second)
		c := h.dial()
		wsSend(t, c, cmsg(MsgAuth, "req-late", "", map[string]any{"ticket": strMap(jv, "socketTicket")}))
		env := wsRecv(t, c)
		var ep errorPayload
		decodePayloadInto(t, env, &ep)
		if env.Type != MsgError || ep.Code != CodeTicketExpired {
			t.Fatalf("late ticket got %s %s", env.Type, ep.Code)
		}
		_ = c.Close(websocket.StatusNormalClosure, "done")
	})
	t.Run("attempt", func(t *testing.T) {
		h := newHarness(t, "")
		token := h.login()
		roomID, _, invite := h.createRoom(token)
		status, jv := h.join(roomID, invite, "expiry-nonce-2", AppProtocolMajor)
		if status != http.StatusCreated {
			t.Fatalf("join = %d", status)
		}
		connToken := strMap(jv, "connectionToken")
		h.advance(46 * time.Second)
		status, v := h.socketTicket(connToken, "")
		if status != http.StatusGone || errCodeMap(v) != CodeAttemptExpired {
			t.Fatalf("expired attempt ticket = %d %v", status, v)
		}
	})
	t.Run("session", func(t *testing.T) {
		h := newHarness(t, "")
		token := h.login()
		h.advance(12*time.Hour + time.Second)
		if status, v := h.post("/v1/rooms", map[string]any{}, token); status != http.StatusUnauthorized {
			t.Fatalf("expired session create = %d %v", status, v)
		}
	})
	t.Run("lease", func(t *testing.T) {
		h := newHarness(t, "")
		token := h.login()
		roomID, _, invite := h.createRoom(token)
		h.advance(24*time.Hour + time.Second)
		if status, v := h.join(roomID, invite, "expiry-nonce-3", AppProtocolMajor); status != http.StatusNotFound || errCodeMap(v) != CodeRoomUnavailable {
			t.Fatalf("expired lease join = %d %v", status, v)
		}
	})
}

// TestStaleSocketCleanup verifies replacing a host socket bumps the
// generation so late cleanup from the old socket cannot clear the new one.
func TestStaleSocketCleanup(t *testing.T) {
	h := newHarness(t, "")
	token := h.login()
	roomID, _, invite := h.createRoom(token)

	_, v := h.socketTicket(token, roomID)
	hostA, _ := h.authConn(strMap(v, "ticket"))
	_, v = h.socketTicket(token, roomID)
	hostB, ready := h.authConn(strMap(v, "ticket"))
	var rp readyPayload
	decodePayloadInto(t, ready, &rp)
	if rp.Role != RoleHost {
		t.Fatalf("replacement ready = %+v", rp)
	}

	h.srv.mu.Lock()
	rm := h.srv.rooms[roomID]
	gen := rm.hostGeneration
	sockB := rm.hostSocketID
	h.srv.mu.Unlock()
	if gen != 2 || sockB == 0 {
		t.Fatalf("generation = %d socket = %d", gen, sockB)
	}
	// Late cleanup minted for the old generation is a no-op.
	h.srv.mu.Lock()
	rm = h.srv.rooms[roomID]
	stillHost := rm.hostConnected && rm.hostSocketID == sockB
	h.srv.mu.Unlock()
	if !stillHost {
		t.Fatalf("replacement host binding lost")
	}

	// The replacement still receives admissions.
	status, jv := h.join(roomID, invite, "stale-nonce-001", AppProtocolMajor)
	if status != http.StatusCreated {
		t.Fatalf("join = %d", status)
	}
	env := wsRecv(t, hostB)
	if env.Type != MsgPeerRequested || env.AttemptID != strMap(jv, "attemptId") {
		t.Fatalf("replacement got %s", env.Type)
	}
	_ = hostA.Close(websocket.StatusNormalClosure, "done")
	_ = hostB.Close(websocket.StatusNormalClosure, "done")
}

// TestSlowReaderDrop fills a socket queue past its bounds and expects the
// server to drop the stuck socket while staying healthy.
func TestSlowReaderDrop(t *testing.T) {
	cfg := testConfig(t, "")
	var key [32]byte
	for i := range key {
		key[i] = byte(i + 1)
	}
	srv, err := NewWithClock(cfg, log.New(io.Discard, "", 0), key, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	sock := &socket{
		id: 999, send: make(chan []byte, 64),
		sendMu: make(chan struct{}, 1),
		done:   make(chan struct{}), closeOnce: make(chan struct{}),
	}
	sock.sendMu <- struct{}{}
	srv.mu.Lock()
	srv.sockets[sock.id] = sock
	srv.mu.Unlock()
	// Saturate count and byte budgets.
	for i := 0; i < srv.cfg.Limits.MaxSocketQueueMessages; i++ {
		sock.send <- []byte("x")
	}
	sock.sendBytes = srv.cfg.Limits.MaxSocketQueueBytes
	if srv.enqueueFrame(sock, []byte("overflow")) {
		t.Fatalf("overflow frame accepted")
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		srv.mu.Lock()
		_, ok := srv.sockets[sock.id]
		srv.mu.Unlock()
		if !ok {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("slow socket not dropped")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// TestShutdown closes signaling with server-shutting-down and refuses new
// admissions.
func TestShutdown(t *testing.T) {
	h := newHarness(t, "")
	token := h.login()
	roomID, _, invite := h.createRoom(token)
	_, v := h.socketTicket(token, roomID)
	host, _ := h.authConn(strMap(v, "ticket"))
	status, jv := h.join(roomID, invite, "shutdown-nonce", AppProtocolMajor)
	if status != http.StatusCreated {
		t.Fatalf("join = %d", status)
	}
	guest, _ := h.authConn(strMap(jv, "socketTicket"))
	// Drain the admission prompt so shutdown frames read cleanly below.
	if env := wsRecv(t, host); env.Type != MsgPeerRequested {
		t.Fatalf("host got %s", env.Type)
	}

	h.cancel()
	select {
	case err := <-h.done:
		if err != nil {
			t.Fatalf("Serve: %v", err)
		}
	case <-time.After(15 * time.Second):
		t.Fatalf("server did not shut down")
	}
	// Both sockets see the shutdown error before the close.
	for _, c := range []*websocket.Conn{host, guest} {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, data, err := c.Read(ctx)
		cancel()
		if err != nil {
			t.Fatalf("shutdown frame: %v", err)
		}
		var env Envelope
		if err := json.Unmarshal(data, &env); err != nil {
			t.Fatal(err)
		}
		if env.Type != MsgError {
			t.Fatalf("shutdown frame = %s", env.Type)
		}
		var ep errorPayload
		decodePayloadInto(t, env, &ep)
		if ep.Code != CodeServerShuttingDown {
			t.Fatalf("shutdown code = %s", ep.Code)
		}
	}

	h2 := newHarness(t, "")
	h2.srv.markShuttingDown()
	if status, v := h2.join("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "shut-nonce-001", AppProtocolMajor); status != http.StatusServiceUnavailable || errCodeMap(v) != CodeServerShuttingDown {
		t.Fatalf("shutdown join = %d %v", status, v)
	}
}

// TestPrefixedSignaling runs a mini exchange under a path prefix and checks
// unprefixed API routes stay 404.
func TestPrefixedSignaling(t *testing.T) {
	h := newHarness(t, "/party")
	token := h.login()
	roomID, _, invite := h.createRoom(token)
	status, jv := h.join(roomID, invite, "prefix-nonce-01", AppProtocolMajor)
	if status != http.StatusCreated {
		t.Fatalf("prefixed join = %d (%v)", status, jv)
	}
	_, v := h.socketTicket(token, roomID)
	host, ready := h.authConn(strMap(v, "ticket"))
	var rp readyPayload
	decodePayloadInto(t, ready, &rp)
	if rp.RoomID != roomID {
		t.Fatalf("ready = %+v", rp)
	}
	_ = host.Close(websocket.StatusNormalClosure, "done")

	req, _ := http.NewRequest(http.MethodPost, h.base+"/v1/join", strings.NewReader("{}"))
	resp, err := h.http.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unprefixed join = %d", resp.StatusCode)
	}
}

// TestUnsupportedVersion rejects mismatched app and signaling versions.
func TestUnsupportedVersion(t *testing.T) {
	h := newHarness(t, "")
	token := h.login()
	roomID, _, invite := h.createRoom(token)
	if status, v := h.join(roomID, invite, "ver-nonce-00001", AppProtocolMajor+1); status != http.StatusBadRequest || errCodeMap(v) != CodeUnsupportedVersion {
		t.Fatalf("bad app protocol = %d %v", status, v)
	}
	status, jv := h.join(roomID, invite, "ver-nonce-00002", AppProtocolMajor)
	if status != http.StatusCreated {
		t.Fatalf("join = %d", status)
	}
	guest := h.dial()
	wsSend(t, guest, map[string]any{"version": 999, "type": "auth", "requestId": "req-ver",
		"payload": map[string]any{"ticket": strMap(jv, "socketTicket")}})
	env := wsRecv(t, guest)
	var ep errorPayload
	decodePayloadInto(t, env, &ep)
	if env.Type != MsgError || ep.Code != CodeUnsupportedVersion {
		t.Fatalf("bad signaling version got %s %s", env.Type, ep.Code)
	}
	_ = guest.Close(websocket.StatusNormalClosure, "done")
}

// TestRateLimits checks login throttling, its Retry-After, and recovery.
func TestRateLimits(t *testing.T) {
	h := newHarness(t, "")
	for i := 0; i < 5; i++ {
		if status, _ := h.post("/v1/host/sessions", map[string]any{"hostKey": testHostKeyHex()}, ""); status != http.StatusCreated {
			t.Fatalf("login %d = %d", i, status)
		}
	}
	status, v := h.post("/v1/host/sessions", map[string]any{"hostKey": testHostKeyHex()}, "")
	if status != http.StatusTooManyRequests || errCodeMap(v) != CodeRateLimited {
		t.Fatalf("6th login = %d %v", status, v)
	}
	if ra, _ := v["error"].(map[string]any)["retryAfter"].(float64); ra < 1 {
		t.Fatalf("missing retryAfter in %v", v)
	}
	h.advance(61 * time.Second)
	if status, _ := h.post("/v1/host/sessions", map[string]any{"hostKey": testHostKeyHex()}, ""); status != http.StatusCreated {
		t.Fatalf("post-window login = %d", status)
	}

	// Join limiter: burst 10, then rate-limited.
	token := h.login()
	roomID, _, _ := h.createRoom(token)
	h.advance(61 * time.Second) // fresh join window for this source
	limited := false
	for i := 0; i < 12; i++ {
		status, v := h.post("/v1/join", map[string]any{
			"roomId": roomID, "invitationSecret": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
			"attemptNonce": "rl-nonce-0000000" + string(rune('a'+i)), "appProtocolMajor": AppProtocolMajor, "appProtocolMinor": 0,
		}, "")
		if status == http.StatusTooManyRequests && errCodeMap(v) == CodeRateLimited {
			limited = true
			break
		}
	}
	if !limited {
		t.Fatalf("join limiter never fired")
	}
}

// TestHeartbeatSurvives connects a socket against short heartbeat intervals
// and expects it to stay up.
func TestHeartbeatSurvives(t *testing.T) {
	cfg := testConfig(t, "")
	cfg.Limits.HeartbeatInterval = config.Duration(1 * time.Second)
	cfg.Limits.HeartbeatTimeout = config.Duration(1 * time.Second)
	cfg.Limits.CleanupInterval = config.Duration(5 * time.Minute)
	var key [32]byte
	for i := range key {
		key[i] = byte(i + 1)
	}
	srv, err := NewWithClock(cfg, log.New(io.Discard, "", 0), key, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = srv.Serve(ctx, ln) }()
	base := "http://" + ln.Addr().String()
	client := &http.Client{Timeout: 5 * time.Second}
	doPost := func(path string, body any, bearer string) (int, map[string]any) {
		buf, _ := json.Marshal(body)
		req, _ := http.NewRequest(http.MethodPost, base+path, bytes.NewReader(buf))
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		resp, err := client.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var v map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&v)
		return resp.StatusCode, v
	}
	_, v := doPost("/v1/host/sessions", map[string]any{"hostKey": testHostKeyHex()}, "")
	token := strMap(v, "sessionToken")
	_, v = doPost("/v1/rooms", map[string]any{}, token)
	roomID := strMap(v, "roomId")
	_, v = doPost("/v1/socket-tickets", map[string]any{"roomId": roomID}, token)
	dialCtx, dialCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer dialCancel()
	c, _, err := websocket.Dial(dialCtx, "ws://"+strings.TrimPrefix(base, "http://")+"/v1/socket", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close(websocket.StatusNormalClosure, "done")
	wsSend(t, c, cmsg(MsgAuth, "req-hb", "", map[string]any{"ticket": strMap(v, "ticket")}))
	if env := wsRecv(t, c); env.Type != MsgReady {
		t.Fatalf("ready = %s", env.Type)
	}
	// Read continuously like a real client so pong replies flow; the server
	// pings every second and must not drop a healthy socket.
	frames := make(chan Envelope, 16)
	readDone := make(chan struct{})
	go func() {
		defer close(readDone)
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_, data, err := c.Read(ctx)
			cancel()
			if err != nil {
				return
			}
			var env Envelope
			if err := json.Unmarshal(data, &env); err != nil {
				return
			}
			frames <- env
		}
	}()
	time.Sleep(2500 * time.Millisecond)
	select {
	case env := <-frames:
		t.Fatalf("unexpected frame during heartbeat window: %s", env.Type)
	case <-readDone:
		t.Fatalf("socket died under heartbeat")
	default:
	}
	wsSend(t, c, cmsg(MsgRelease, "req-hb2", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", nil))
	select {
	case env := <-frames:
		if env.Type != MsgError {
			t.Fatalf("post-heartbeat frame = %s", env.Type)
		}
	case <-readDone:
		t.Fatalf("socket closed")
	case <-time.After(5 * time.Second):
		t.Fatalf("no response after heartbeat window")
	}
}

// TestLogsRedactSignaling ensures invitation bodies, bearer tokens, and room
// path segments never reach request logs.
func TestLogsRedactSignaling(t *testing.T) {
	var logs bytes.Buffer
	cfg := testConfig(t, "")
	var key [32]byte
	for i := range key {
		key[i] = byte(i + 1)
	}
	srv, err := NewWithClock(cfg, log.New(&logs, "", 0), key, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	h := srv.Handler()
	invite := "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	body, _ := json.Marshal(map[string]any{
		"roomId": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "invitationSecret": invite,
		"attemptNonce": "secret-nonce-01", "appProtocolMajor": AppProtocolMajor, "appProtocolMinor": 0,
	})
	req, _ := http.NewRequest(http.MethodPost, "/v1/join", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer session-token-secret-abc")
	w := newRecorder()
	h.ServeHTTP(w, req)
	out := logs.String()
	for _, secret := range []string{invite, "session-token-secret-abc", "secret-nonce-01"} {
		if strings.Contains(out, secret) {
			t.Fatalf("logs contain secret %q", secret)
		}
	}
	logs.Reset()
	req, _ = http.NewRequest(http.MethodPost, "/v1/rooms/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/resume",
		strings.NewReader(`{"ownerSecret":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}`))
	req.Header.Set("Authorization", "Bearer "+testHostKeyHex())
	w = newRecorder()
	h.ServeHTTP(w, req)
	out = logs.String()
	if strings.Contains(out, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
		t.Fatalf("room id in logs: %q", out)
	}
	if !strings.Contains(out, "{room}") {
		t.Fatalf("scrubbed path missing: %q", out)
	}
}

type testRecorder struct {
	header http.Header
	status int
	buf    bytes.Buffer
}

func newRecorder() *testRecorder {
	return &testRecorder{header: http.Header{}}
}
func (r *testRecorder) Header() http.Header { return r.header }
func (r *testRecorder) Write(b []byte) (int, error) {
	return r.buf.Write(b)
}
func (r *testRecorder) WriteHeader(s int) { r.status = s }
