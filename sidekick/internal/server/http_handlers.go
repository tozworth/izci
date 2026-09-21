package server

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

// HTTP handlers for host auth, rooms, join, and socket tickets. All routes
// live beneath the configured path prefix; every handler speaks strict JSON
// (unknown fields and trailing data are rejected) and answers errors with
// stable codes only. Secrets travel in bodies or bearer headers, never URLs.

func (s *Server) registerSignalingRoutes() {
	p := s.cfg.PathPrefix
	s.mux.HandleFunc(p+"/v1/host/sessions", s.handleCreateSession)
	s.mux.HandleFunc(p+"/v1/host/session", s.handleDeleteSession)
	s.mux.HandleFunc(p+"/v1/rooms", s.handleCreateRoom)
	s.mux.HandleFunc(p+"/v1/rooms/", s.handleRoomSub)
	s.mux.HandleFunc(p+"/v1/join", s.handleJoin)
	s.mux.HandleFunc(p+"/v1/socket-tickets", s.handleSocketTickets)
	s.mux.HandleFunc(p+"/v1/socket", s.handleSocket)
	s.registerIceRoute()
}

// decodeStrictBody decodes strict JSON: unknown fields and trailing data fail.
func decodeStrictBody(r *http.Request, v any) error {
	if r.Body == nil {
		return json.Unmarshal([]byte("{}"), v)
	}
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	if dec.More() {
		return errTrailingData
	}
	return nil
}

var errTrailingData = json.Unmarshal([]byte("["), &struct{}{})

// bearerDigest extracts a bearer token digest from the Authorization header.
func bearerDigest(r *http.Request) ([32]byte, bool) {
	var zero [32]byte
	h := r.Header.Get("Authorization")
	if h == "" {
		return zero, false
	}
	const prefix = "Bearer "
	if !strings.HasPrefix(h, prefix) {
		return zero, false
	}
	token := strings.TrimSpace(strings.TrimPrefix(h, prefix))
	if token == "" || len(token) > 256 {
		return zero, false
	}
	d, ok := parseSecretToken(token)
	if !ok {
		return zero, false
	}
	return d, true
}

func timeJSON(t time.Time) string {
	return t.UTC().Format(time.RFC3339)
}

func methodOnly(w http.ResponseWriter, r *http.Request, allow string, methods ...string) bool {
	for _, m := range methods {
		if r.Method == m {
			return true
		}
	}
	w.Header().Set("Allow", allow)
	writeError(w, http.StatusMethodNotAllowed, CodeMethodNotAllowed)
	return false
}

// --- Host sessions ---

type createSessionRequest struct {
	HostKey string `json:"hostKey"`
}

type sessionResponse struct {
	SessionToken string `json:"sessionToken"`
	ExpiresAt    string `json:"expiresAt"`
}

func (s *Server) handleCreateSession(w http.ResponseWriter, r *http.Request) {
	if !methodOnly(w, r, "POST, OPTIONS", http.MethodPost) {
		return
	}
	if s.isShuttingDown() {
		writeError(w, http.StatusServiceUnavailable, CodeServerShuttingDown)
		return
	}
	now := s.now()
	if ok, wait := s.loginLimiterAllow(s.clientIP(r), now); !ok {
		writeAPIError(w, http.StatusTooManyRequests, CodeRateLimited, wait, true)
		return
	}
	var req createSessionRequest
	if err := decodeStrictBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, CodeBadRequest)
		return
	}
	if req.HostKey == "" {
		writeError(w, http.StatusBadRequest, CodeBadRequest)
		return
	}
	key, ok := parseHexKey(strings.TrimSpace(req.HostKey))
	if !ok || !digestsEqual(sha256Sum(key[:]), s.hostKeyDigest) {
		s.logCode("login", CodeUnauthorized)
		writeError(w, http.StatusUnauthorized, CodeUnauthorized)
		return
	}
	token, err := newSecret()
	if err != nil {
		writeError(w, http.StatusInternalServerError, CodeBadRequest)
		return
	}
	digest, _ := parseSecretToken(token)
	exp := now.Add(time.Duration(s.cfg.Limits.HostSessionTTL))
	s.mu.Lock()
	s.sessions[digestKey(digest)] = &hostSession{digest: digest, expiresAt: exp}
	s.mu.Unlock()
	s.logCode("login", "ok")
	writeJSON(w, http.StatusCreated, sessionResponse{SessionToken: token, ExpiresAt: timeJSON(exp)})
}

func (s *Server) loginLimiterAllow(ip string, now time.Time) (bool, int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loginLimiter.allow(ip, now)
}

func (s *Server) joinLimiterAllow(ip string, now time.Time) (bool, int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.joinLimiter.allow(ip, now)
}

func (s *Server) handleDeleteSession(w http.ResponseWriter, r *http.Request) {
	if !methodOnly(w, r, "DELETE, OPTIONS", http.MethodDelete) {
		return
	}
	digest, ok := bearerDigest(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, CodeUnauthorized)
		return
	}
	now := s.now()
	var actions []socketAction
	s.mu.Lock()
	sess := s.sessionValidLocked(digest, now)
	if sess == nil {
		s.mu.Unlock()
		writeError(w, http.StatusUnauthorized, CodeUnauthorized)
		return
	}
	delete(s.sessions, digestKey(digest))
	for _, rm := range s.rooms {
		if rm.ownerDigest == digest {
			actions = append(actions, s.closeRoomLocked(rm, ReasonRoomClosed)...)
		}
	}
	s.mu.Unlock()
	for _, a := range actions {
		s.applySocketAction(a)
	}
	s.logCode("logout", "ok")
	w.WriteHeader(http.StatusNoContent)
}

// --- Rooms ---

type createRoomRequest struct {
	Capacity *int `json:"capacity,omitempty"`
	// Recreate carries a previous room's IDs so a host can rebuild the
	// same room (and invitation) atomically after a server restart. All
	// three must travel together; when absent a fresh room is created.
	RoomID           string `json:"roomId,omitempty"`
	OwnerSecret      string `json:"ownerSecret,omitempty"`
	InvitationSecret string `json:"invitationSecret,omitempty"`
}

type createRoomResponse struct {
	RoomID           string `json:"roomId"`
	OwnerSecret      string `json:"ownerSecret"`
	InvitationSecret string `json:"invitationSecret"`
	ExpiresAt        string `json:"expiresAt"`
}

func (s *Server) handleCreateRoom(w http.ResponseWriter, r *http.Request) {
	if !methodOnly(w, r, "POST, OPTIONS", http.MethodPost) {
		return
	}
	if s.isShuttingDown() {
		writeError(w, http.StatusServiceUnavailable, CodeServerShuttingDown)
		return
	}
	digest, ok := bearerDigest(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, CodeUnauthorized)
		return
	}
	now := s.now()
	var req createRoomRequest
	if r.ContentLength != 0 {
		if err := decodeStrictBody(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, CodeBadRequest)
			return
		}
	}
	capacity := s.cfg.Limits.MaxPeersPerRoom
	if req.Capacity != nil {
		capacity = *req.Capacity
	}
	if capacity < 1 || capacity > s.cfg.Limits.MaxPeersPerRoom {
		writeError(w, http.StatusBadRequest, CodeBadRequest)
		return
	}
	// A recreate names its room and both secrets; a fresh create names
	// none of them. Anything in between is a bad request.
	recreate := req.RoomID != "" || req.OwnerSecret != "" || req.InvitationSecret != ""
	var roomID, ownerSecret, inviteSecret string
	var ownerDigest, inviteDigest [32]byte
	if recreate {
		if !validHexID(req.RoomID) {
			writeError(w, http.StatusBadRequest, CodeBadRequest)
			return
		}
		var ok bool
		if ownerDigest, ok = parseSecretToken(strings.TrimSpace(req.OwnerSecret)); !ok {
			writeError(w, http.StatusBadRequest, CodeBadRequest)
			return
		}
		if inviteDigest, ok = parseSecretToken(strings.TrimSpace(req.InvitationSecret)); !ok {
			writeError(w, http.StatusBadRequest, CodeBadRequest)
			return
		}
		roomID, ownerSecret, inviteSecret = req.RoomID, strings.TrimSpace(req.OwnerSecret), strings.TrimSpace(req.InvitationSecret)
	} else {
		var err error
		if roomID, err = newRoomID(); err != nil {
			writeError(w, http.StatusInternalServerError, CodeBadRequest)
			return
		}
		if ownerSecret, err = newSecret(); err != nil {
			writeError(w, http.StatusInternalServerError, CodeBadRequest)
			return
		}
		if inviteSecret, err = newSecret(); err != nil {
			writeError(w, http.StatusInternalServerError, CodeBadRequest)
			return
		}
		ownerDigest, _ = parseSecretToken(ownerSecret)
		inviteDigest, _ = parseSecretToken(inviteSecret)
	}
	s.mu.Lock()
	if s.sessionValidLocked(digest, now) == nil {
		s.mu.Unlock()
		writeError(w, http.StatusUnauthorized, CodeUnauthorized)
		return
	}
	if existing := s.rooms[roomID]; existing != nil && now.Before(existing.leaseUntil) {
		// Collision with a live room: only the matching owner secret
		// adopts it (another tab cannot overwrite a live room). The
		// saved invitation is reinstalled so old invites keep working.
		if !recreate || !digestsEqual(ownerDigest, existing.ownerSecretDigest) {
			s.mu.Unlock()
			// Random-ID collisions are astronomically unlikely; a
			// named collision without the owner secret is a conflict.
			// Named or not, never leak which side mismatched.
			s.logCode("room.create", CodeRoomUnavailable)
			writeError(w, http.StatusConflict, CodeRoomUnavailable)
			return
		}
		existing.ownerDigest = digest
		existing.inviteDigest = inviteDigest
		existing.leaseUntil = now.Add(time.Duration(s.cfg.Limits.RoomLeaseTTL))
		exp := existing.leaseUntil
		s.mu.Unlock()
		s.logCode("room.create", "ok")
		writeJSON(w, http.StatusOK, createRoomResponse{
			RoomID: roomID, OwnerSecret: ownerSecret,
			InvitationSecret: inviteSecret, ExpiresAt: timeJSON(exp),
		})
		return
	}
	if len(s.rooms) >= s.cfg.Limits.MaxRooms {
		s.mu.Unlock()
		writeError(w, http.StatusConflict, CodeRoomFull)
		return
	}
	exp := now.Add(time.Duration(s.cfg.Limits.RoomLeaseTTL))
	delete(s.rooms, roomID) // drop any expired record under the same ID
	s.rooms[roomID] = &room{
		id:                roomID,
		ownerDigest:       digest,
		ownerSecretDigest: ownerDigest,
		inviteDigest:      inviteDigest,
		capacity:          capacity,
		createdAt:         now,
		leaseUntil:        exp,
		connections:       make(map[string]*connection),
	}
	s.mu.Unlock()
	s.logCode("room.create", "ok")
	writeJSON(w, http.StatusCreated, createRoomResponse{
		RoomID: roomID, OwnerSecret: ownerSecret,
		InvitationSecret: inviteSecret, ExpiresAt: timeJSON(exp),
	})
}

type ownerSecretRequest struct {
	OwnerSecret string `json:"ownerSecret"`
}

type roomStatusResponse struct {
	RoomID    string `json:"roomId"`
	ExpiresAt string `json:"expiresAt"`
}

type rotateResponse struct {
	RoomID           string `json:"roomId"`
	InvitationSecret string `json:"invitationSecret"`
}

// handleRoomSub dispatches POST /v1/rooms/{room}/resume|renew|rotate and
// DELETE /v1/rooms/{room}.
func (s *Server) handleRoomSub(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, s.cfg.PathPrefix+"/v1/rooms/")
	parts := strings.Split(rest, "/")
	if len(parts) == 0 || parts[0] == "" || !validHexID(parts[0]) {
		writeError(w, http.StatusNotFound, CodeRoomUnavailable)
		return
	}
	roomID := parts[0]
	if r.Method == http.MethodDelete && len(parts) == 1 {
		s.handleDeleteRoom(w, r, roomID)
		return
	}
	if r.Method != http.MethodPost || len(parts) != 2 {
		if r.Method != http.MethodPost && r.Method != http.MethodDelete {
			w.Header().Set("Allow", "POST, DELETE, OPTIONS")
			writeError(w, http.StatusMethodNotAllowed, CodeMethodNotAllowed)
			return
		}
		writeError(w, http.StatusNotFound, CodeNotFound)
		return
	}
	switch parts[1] {
	case "resume":
		s.handleResumeRoom(w, r, roomID)
	case "renew":
		s.handleRenewRoom(w, r, roomID)
	case "rotate":
		s.handleRotateRoom(w, r, roomID)
	default:
		writeError(w, http.StatusNotFound, CodeNotFound)
	}
}

func (s *Server) handleResumeRoom(w http.ResponseWriter, r *http.Request, roomID string) {
	digest, ok := bearerDigest(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, CodeUnauthorized)
		return
	}
	var req ownerSecretRequest
	if err := decodeStrictBody(r, &req); err != nil || req.OwnerSecret == "" {
		writeError(w, http.StatusBadRequest, CodeBadRequest)
		return
	}
	presented, ok := parseSecretToken(strings.TrimSpace(req.OwnerSecret))
	if !ok {
		writeError(w, http.StatusUnauthorized, CodeUnauthorized)
		return
	}
	now := s.now()
	s.mu.Lock()
	if s.sessionValidLocked(digest, now) == nil {
		s.mu.Unlock()
		writeError(w, http.StatusUnauthorized, CodeUnauthorized)
		return
	}
	rm := s.getRoomLocked(roomID, now)
	if rm == nil {
		s.mu.Unlock()
		writeError(w, http.StatusNotFound, CodeRoomUnavailable)
		return
	}
	if !digestsEqual(presented, rm.ownerSecretDigest) {
		s.mu.Unlock()
		s.logCode("room.resume", CodeUnauthorized)
		writeError(w, http.StatusUnauthorized, CodeUnauthorized)
		return
	}
	// Another logged-in tab holding a live ownership cannot be overwritten:
	// only the current owner session (or an expired one) may resume.
	if rm.ownerDigest != digest && s.sessionValidLocked(rm.ownerDigest, now) != nil {
		s.mu.Unlock()
		s.logCode("room.resume", CodeRoomUnavailable)
		writeError(w, http.StatusConflict, CodeRoomUnavailable)
		return
	}
	rm.ownerDigest = digest
	rm.leaseUntil = now.Add(time.Duration(s.cfg.Limits.RoomLeaseTTL))
	exp := rm.leaseUntil
	s.mu.Unlock()
	s.logCode("room.resume", "ok")
	writeJSON(w, http.StatusOK, roomStatusResponse{RoomID: roomID, ExpiresAt: timeJSON(exp)})
}

func (s *Server) ownerRoom(w http.ResponseWriter, digest [32]byte, roomID string, now time.Time) *room {
	rm := s.getRoomLocked(roomID, now)
	if rm == nil {
		writeError(w, http.StatusNotFound, CodeRoomUnavailable)
		return nil
	}
	if rm.ownerDigest != digest || s.sessionValidLocked(digest, now) == nil {
		writeError(w, http.StatusUnauthorized, CodeUnauthorized)
		return nil
	}
	return rm
}

func (s *Server) handleRenewRoom(w http.ResponseWriter, r *http.Request, roomID string) {
	digest, ok := bearerDigest(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, CodeUnauthorized)
		return
	}
	now := s.now()
	s.mu.Lock()
	rm := s.ownerRoom(w, digest, roomID, now)
	if rm == nil {
		s.mu.Unlock()
		return
	}
	rm.leaseUntil = now.Add(time.Duration(s.cfg.Limits.RoomLeaseTTL))
	exp := rm.leaseUntil
	s.mu.Unlock()
	writeJSON(w, http.StatusOK, roomStatusResponse{RoomID: roomID, ExpiresAt: timeJSON(exp)})
}

func (s *Server) handleRotateRoom(w http.ResponseWriter, r *http.Request, roomID string) {
	digest, ok := bearerDigest(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, CodeUnauthorized)
		return
	}
	now := s.now()
	secret, err := newSecret()
	if err != nil {
		writeError(w, http.StatusInternalServerError, CodeBadRequest)
		return
	}
	s.mu.Lock()
	rm := s.ownerRoom(w, digest, roomID, now)
	if rm == nil {
		s.mu.Unlock()
		return
	}
	inviteDigest, _ := parseSecretToken(secret)
	rm.inviteDigest = inviteDigest
	s.mu.Unlock()
	s.logCode("room.rotate", "ok")
	writeJSON(w, http.StatusOK, rotateResponse{RoomID: roomID, InvitationSecret: secret})
}

func (s *Server) handleDeleteRoom(w http.ResponseWriter, r *http.Request, roomID string) {
	digest, ok := bearerDigest(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, CodeUnauthorized)
		return
	}
	now := s.now()
	s.mu.Lock()
	rm := s.ownerRoom(w, digest, roomID, now)
	if rm == nil {
		s.mu.Unlock()
		return
	}
	actions := s.closeRoomLocked(rm, ReasonRoomClosed)
	s.mu.Unlock()
	for _, a := range actions {
		s.applySocketAction(a)
	}
	s.logCode("room.delete", "ok")
	w.WriteHeader(http.StatusNoContent)
}

// --- Join ---

type joinRequest struct {
	RoomID           string   `json:"roomId"`
	InvitationSecret string   `json:"invitationSecret"`
	AttemptNonce     string   `json:"attemptNonce"`
	AppMajor         *int     `json:"appProtocolMajor"`
	AppMinor         *int     `json:"appProtocolMinor"`
	AppCapabilities  []string `json:"appCapabilities"`
	// Legacy exact-version field (pre-Phase-0). Accepted only to report
	// unsupported-version rather than a generic bad-request.
	LegacyAppProtocol *int `json:"appProtocol"`
}

type joinResponse struct {
	ConnectionID     string `json:"connectionId"`
	ConnectionToken  string `json:"connectionToken"`
	AttemptID        string `json:"attemptId"`
	SocketTicket     string `json:"socketTicket"`
	TicketExpiresAt  string `json:"ticketExpiresAt"`
	AttemptExpiresAt string `json:"attemptExpiresAt"`
}

func (s *Server) handleJoin(w http.ResponseWriter, r *http.Request) {
	if !methodOnly(w, r, "POST, OPTIONS", http.MethodPost) {
		return
	}
	if s.isShuttingDown() {
		writeError(w, http.StatusServiceUnavailable, CodeServerShuttingDown)
		return
	}
	now := s.now()
	if ok, wait := s.joinLimiterAllow(s.clientIP(r), now); !ok {
		writeAPIError(w, http.StatusTooManyRequests, CodeRateLimited, wait, true)
		return
	}
	var req joinRequest
	if err := decodeStrictBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, CodeBadRequest)
		return
	}
	// Application admission compares the major plus required baseline
	// capabilities, not an exact integer. Minor skew alone admits.
	if req.AppMajor == nil || *req.AppMajor != AppProtocolMajor {
		writeError(w, http.StatusBadRequest, CodeUnsupportedVersion)
		return
	}
	if req.AppMinor != nil && (*req.AppMinor < 0 || *req.AppMinor > 9999) {
		writeError(w, http.StatusBadRequest, CodeBadRequest)
		return
	}
	for _, cap := range req.AppCapabilities {
		if len(cap) == 0 || len(cap) > 64 {
			writeError(w, http.StatusBadRequest, CodeBadRequest)
			return
		}
	}
	// Baseline is currently empty; unknown capabilities are ignored.
	if !validHexID(req.RoomID) {
		writeError(w, http.StatusNotFound, CodeRoomUnavailable)
		return
	}
	if !validNonce(req.AttemptNonce) {
		writeError(w, http.StatusBadRequest, CodeBadRequest)
		return
	}
	// Wrong and missing invitations are indistinguishable: room-unavailable.
	presented, shapeOK := parseSecretToken(strings.TrimSpace(req.InvitationSecret))
	if !shapeOK {
		s.logCode("join", CodeRoomUnavailable)
		writeError(w, http.StatusNotFound, CodeRoomUnavailable)
		return
	}
	connID, err := newRoomID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, CodeBadRequest)
		return
	}
	connToken, err := newSecret()
	if err != nil {
		writeError(w, http.StatusInternalServerError, CodeBadRequest)
		return
	}
	attemptID, err := newAttemptID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, CodeBadRequest)
		return
	}
	sockTicket, err := newSecret()
	if err != nil {
		writeError(w, http.StatusInternalServerError, CodeBadRequest)
		return
	}
	s.mu.Lock()
	rm := s.getRoomLocked(req.RoomID, now)
	if rm == nil {
		s.mu.Unlock()
		s.logCode("join", CodeRoomUnavailable)
		writeError(w, http.StatusNotFound, CodeRoomUnavailable)
		return
	}
	if !digestsEqual(presented, rm.inviteDigest) {
		s.mu.Unlock()
		s.logCode("join", CodeRoomUnavailable)
		writeError(w, http.StatusNotFound, CodeRoomUnavailable)
		return
	}
	if !rm.hostPresent() {
		s.mu.Unlock()
		s.logCode("join", CodeHostUnavailable)
		writeError(w, http.StatusConflict, CodeHostUnavailable)
		return
	}
	if rm.liveConnections() >= rm.capacity || rm.pendingAttempts() >= s.cfg.Limits.MaxPendingAttemptsPerRoom {
		s.mu.Unlock()
		s.logCode("join", CodeRoomFull)
		writeError(w, http.StatusConflict, CodeRoomFull)
		return
	}
	connDigest, _ := parseSecretToken(connToken)
	ticketDigest, _ := parseSecretToken(sockTicket)
	attemptExp := now.Add(time.Duration(s.cfg.Limits.AttemptTimeout))
	ticketExp := now.Add(time.Duration(s.cfg.Limits.SocketTicketTTL))
	conn := &connection{
		id:          connID,
		tokenDigest: connDigest,
		roomID:      rm.id,
		createdAt:   now,
		attempt: &attempt{
			id:              attemptID,
			nonce:           req.AttemptNonce,
			createdAt:       now,
			expiresAt:       attemptExp,
			guestCandidates: make(map[int]candidatePayload),
			hostCandidates:  make(map[int]candidatePayload),
		},
	}
	rm.connections[connID] = conn
	s.connTokens[digestKey(connDigest)] = conn
	s.tickets[digestKey(ticketDigest)] = &ticket{
		digest: ticketDigest, role: RoleGuest,
		roomID: rm.id, connectionID: connID, expiresAt: ticketExp,
	}
	// Prompt a live host socket; a host that connects later gets pending
	// requests flushed on ready.
	var hostNotify []byte
	if rm.hostSocketID != 0 {
		hostNotify = serverFrame(MsgPeerRequested, attemptID, peerRequestedPayload{ConnectionID: connID})
	}
	hostSock := rm.hostSocketID
	s.mu.Unlock()
	if hostNotify != nil {
		s.sendToSocket(hostSock, hostNotify)
	}
	s.logCode("join", "ok")
	writeJSON(w, http.StatusCreated, joinResponse{
		ConnectionID: connID, ConnectionToken: connToken, AttemptID: attemptID,
		SocketTicket: sockTicket, TicketExpiresAt: timeJSON(ticketExp),
		AttemptExpiresAt: timeJSON(attemptExp),
	})
}

// --- Socket tickets ---

type socketTicketRequest struct {
	RoomID string `json:"roomId,omitempty"`
}

type socketTicketResponse struct {
	Ticket    string `json:"ticket"`
	ExpiresAt string `json:"expiresAt"`
}

func (s *Server) handleSocketTickets(w http.ResponseWriter, r *http.Request) {
	if !methodOnly(w, r, "POST, OPTIONS", http.MethodPost) {
		return
	}
	if s.isShuttingDown() {
		writeError(w, http.StatusServiceUnavailable, CodeServerShuttingDown)
		return
	}
	digest, ok := bearerDigest(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, CodeUnauthorized)
		return
	}
	var req socketTicketRequest
	if r.ContentLength != 0 {
		if err := decodeStrictBody(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, CodeBadRequest)
			return
		}
	}
	if req.RoomID != "" && !validHexID(req.RoomID) {
		writeError(w, http.StatusBadRequest, CodeBadRequest)
		return
	}
	now := s.now()
	secret, err := newSecret()
	if err != nil {
		writeError(w, http.StatusInternalServerError, CodeBadRequest)
		return
	}
	ticketDigest, _ := parseSecretToken(secret)
	ticketExp := now.Add(time.Duration(s.cfg.Limits.SocketTicketTTL))
	s.mu.Lock()
	// Host bearer: roomId required, caller must own the room.
	if s.sessionValidLocked(digest, now) != nil {
		if req.RoomID == "" {
			s.mu.Unlock()
			writeError(w, http.StatusBadRequest, CodeBadRequest)
			return
		}
		rm := s.getRoomLocked(req.RoomID, now)
		if rm == nil {
			s.mu.Unlock()
			writeError(w, http.StatusNotFound, CodeRoomUnavailable)
			return
		}
		if rm.ownerDigest != digest {
			s.mu.Unlock()
			writeError(w, http.StatusUnauthorized, CodeUnauthorized)
			return
		}
		s.tickets[digestKey(ticketDigest)] = &ticket{
			digest: ticketDigest, role: RoleHost,
			roomID: rm.id, expiresAt: ticketExp,
		}
		s.mu.Unlock()
		writeJSON(w, http.StatusCreated, socketTicketResponse{Ticket: secret, ExpiresAt: timeJSON(ticketExp)})
		return
	}
	// Connection bearer: authorizes only its own connection.
	conn, ok := s.connTokens[digestKey(digest)]
	if !ok {
		s.mu.Unlock()
		writeError(w, http.StatusUnauthorized, CodeUnauthorized)
		return
	}
	if conn.released {
		s.mu.Unlock()
		writeError(w, http.StatusGone, CodeAttemptExpired)
		return
	}
	if req.RoomID != "" && req.RoomID != conn.roomID {
		s.mu.Unlock()
		writeError(w, http.StatusUnauthorized, CodeUnauthorized)
		return
	}
	if s.getRoomLocked(conn.roomID, now) == nil {
		s.mu.Unlock()
		writeError(w, http.StatusNotFound, CodeRoomUnavailable)
		return
	}
	s.tickets[digestKey(ticketDigest)] = &ticket{
		digest: ticketDigest, role: RoleGuest,
		roomID: conn.roomID, connectionID: conn.id, expiresAt: ticketExp,
	}
	s.mu.Unlock()
	writeJSON(w, http.StatusCreated, socketTicketResponse{Ticket: secret, ExpiresAt: timeJSON(ticketExp)})
}

// logCode records a lifecycle/error code. Values are fixed tokens; request
// bodies, SDP, candidates, invitations, and tokens never reach the logger.
func (s *Server) logCode(op, code string) {
	s.logger.Printf("sidekick %s %s", op, code)
}
