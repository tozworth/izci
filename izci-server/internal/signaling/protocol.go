package signaling

import (
	"bytes"
	"encoding/json"
	"fmt"
	"unicode"
)

// Socket protocol: JSON messages with version, type, requestId, optional
// attemptId, and payload. This file is the definition; the representative
// fixtures under tests/multiplayer-server-contract/ are examples only.
//
// Client (browser) to server types: auth, accept, reject, offer, answer,
// candidate, candidates-end, connected, release.
// Server to client types: ready, peer.requested, peer.accepted,
// peer.rejected, offer, answer, candidate, candidates-end, peer.connected,
// peer.released, error.
//
// Success is silent except for the resulting notifications; failures arrive
// as error frames echoing requestId (and attemptId when present). requestId
// is required on client messages so errors can be correlated.

const (
	MsgAuth          = "auth"
	MsgReady         = "ready"
	MsgPeerRequested = "peer.requested"
	MsgAccept        = "accept"
	MsgReject        = "reject"
	MsgPeerAccepted  = "peer.accepted"
	MsgPeerRejected  = "peer.rejected"
	MsgOffer         = "offer"
	MsgAnswer        = "answer"
	MsgCandidate     = "candidate"
	MsgCandidatesEnd = "candidates-end"
	MsgConnected     = "connected"
	MsgPeerConnected = "peer.connected"
	MsgPeerReleased  = "peer.released"
	MsgRelease       = "release"
	MsgError         = "error"
)

// Role identifies which side of a room a socket serves.
const (
	RoleHost  = "host"
	RoleGuest = "guest"
)

// Envelope is the wire shape of every socket message.
type Envelope struct {
	Version   int             `json:"version"`
	Type      string          `json:"type"`
	RequestID string          `json:"requestId"`
	AttemptID string          `json:"attemptId,omitempty"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

// Payload shapes. Empty payloads may be omitted or given as {}.
type authPayload struct {
	Ticket string `json:"ticket"`
}

type sdpPayload struct {
	SDP string `json:"sdp"`
}

type candidatePayload struct {
	Candidate     string `json:"candidate"`
	Index         int    `json:"index"`
	SDPMid        string `json:"sdpMid"`
	SDPMLineIndex int    `json:"sdpMLineIndex"`
}

type candidateWirePayload struct {
	Candidate     string  `json:"candidate"`
	Index         *int    `json:"index"`
	SDPMid        *string `json:"sdpMid"`
	SDPMLineIndex *int    `json:"sdpMLineIndex"`
}

type errorPayload struct {
	Code       string `json:"code"`
	RetryAfter int    `json:"retryAfter,omitempty"`
}

type readyPayload struct {
	Role         string `json:"role"`
	RoomID       string `json:"roomId"`
	ConnectionID string `json:"connectionId,omitempty"`
}

type peerRequestedPayload struct {
	ConnectionID string `json:"connectionId"`
}

type peerRejectedPayload struct {
	Reason string `json:"reason"`
}

type peerReleasedPayload struct {
	Reason string `json:"reason"`
}

// Release reasons surfaced to peers.
const (
	ReasonRejected       = "rejected"
	ReasonReleased       = "released"
	ReasonAttemptExpired = "attempt-expired"
	ReasonRoomClosed     = "room-closed"
	ReasonHostGone       = "host-unavailable"
)

// clientMessageTypes may be sent by sockets after auth.
var clientMessageTypes = map[string]bool{
	MsgAuth: true, MsgAccept: true, MsgReject: true,
	MsgOffer: true, MsgAnswer: true, MsgCandidate: true,
	MsgCandidatesEnd: true, MsgConnected: true, MsgRelease: true,
}

// hostOnlyTypes may only be sent by the host socket.
var hostOnlyTypes = map[string]bool{MsgAccept: true, MsgReject: true}

// guestOnlyTypes may only be sent by a guest socket.
var guestOnlyTypes = map[string]bool{MsgOffer: true}

// attemptScopedTypes require a shaped attemptId in the envelope.
var attemptScopedTypes = map[string]bool{
	MsgAccept: true, MsgReject: true, MsgOffer: true, MsgAnswer: true,
	MsgCandidate: true, MsgCandidatesEnd: true, MsgConnected: true, MsgRelease: true,
}

func validRequestID(s string) bool {
	if len(s) == 0 || len(s) > 128 {
		return false
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

// parseEnvelope strictly decodes one socket frame. Unknown fields, unknown
// types, bad versions, and malformed IDs are rejected with a stable code.
func parseEnvelope(data []byte, maxBytes int) (Envelope, string) {
	var env Envelope
	if len(data) > maxBytes {
		return env, CodePayloadTooLarge
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&env); err != nil {
		return env, CodeBadRequest
	}
	if dec.More() {
		return env, CodeBadRequest
	}
	if env.Version != SignalingVersion {
		return env, CodeUnsupportedVersion
	}
	if !clientMessageTypes[env.Type] {
		return env, CodeBadRequest
	}
	if !validRequestID(env.RequestID) {
		return env, CodeBadRequest
	}
	if attemptScopedTypes[env.Type] {
		if !validHexID(env.AttemptID) {
			return env, CodeBadRequest
		}
	} else if env.Type != MsgAuth && env.AttemptID != "" && !validHexID(env.AttemptID) {
		return env, CodeBadRequest
	}
	if len(env.Payload) > maxBytes {
		return env, CodePayloadTooLarge
	}
	return env, ""
}

// decodePayload strictly decodes the envelope payload into v. A missing
// payload decodes as the zero value; unknown fields are rejected.
func decodePayload(env Envelope, v any) error {
	if len(env.Payload) == 0 {
		return nil
	}
	dec := json.NewDecoder(bytes.NewReader(env.Payload))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	if dec.More() {
		return fmt.Errorf("trailing payload data")
	}
	return nil
}

// errorFrame renders a server error message echoing request/attempt IDs.
func errorFrame(requestID, attemptID, code string, retryAfter int, hasRetry bool) []byte {
	p := errorPayload{Code: code}
	if hasRetry {
		p.RetryAfter = retryAfter
	}
	raw, _ := json.Marshal(p)
	env := Envelope{Version: SignalingVersion, Type: MsgError, RequestID: requestID, AttemptID: attemptID, Payload: raw}
	out, _ := json.Marshal(env)
	return out
}

// serverFrame renders a server-originated notification.
func serverFrame(msgType, attemptID string, payload any) []byte {
	var raw json.RawMessage
	if payload != nil {
		raw, _ = json.Marshal(payload)
	}
	env := Envelope{Version: SignalingVersion, Type: msgType, RequestID: newRequestID(), AttemptID: attemptID, Payload: raw}
	out, _ := json.Marshal(env)
	return out
}

// validateClientSemantics checks per-type payload shapes and value bounds
// that do not need registry state. Role and attempt checks happen against
// the registry in socket.go.
func validateClientSemantics(env Envelope, maxSDP, maxCandidate, maxCandidates int) (authPayload, sdpPayload, candidatePayload, string) {
	switch env.Type {
	case MsgAuth:
		var p authPayload
		if err := decodePayload(env, &p); err != nil || p.Ticket == "" || len(p.Ticket) > 256 {
			return p, sdpPayload{}, candidatePayload{}, CodeBadRequest
		}
		return p, sdpPayload{}, candidatePayload{}, ""
	case MsgOffer, MsgAnswer:
		var p sdpPayload
		if err := decodePayload(env, &p); err != nil {
			return authPayload{}, p, candidatePayload{}, CodeBadRequest
		}
		if len(p.SDP) == 0 || len(p.SDP) > maxSDP {
			return authPayload{}, p, candidatePayload{}, CodeBadRequest
		}
		return authPayload{}, p, candidatePayload{}, ""
	case MsgCandidate:
		var wire candidateWirePayload
		if err := decodePayload(env, &wire); err != nil || wire.Index == nil || wire.SDPMid == nil || wire.SDPMLineIndex == nil {
			return authPayload{}, sdpPayload{}, candidatePayload{}, CodeBadRequest
		}
		p := candidatePayload{
			Candidate:     wire.Candidate,
			Index:         *wire.Index,
			SDPMid:        *wire.SDPMid,
			SDPMLineIndex: *wire.SDPMLineIndex,
		}
		if len(p.Candidate) == 0 || len(p.Candidate) > maxCandidate {
			return authPayload{}, sdpPayload{}, p, CodeBadRequest
		}
		if p.Index < 0 || p.Index >= maxCandidates {
			return authPayload{}, sdpPayload{}, p, CodeBadRequest
		}
		if len(p.SDPMid) > 64 || p.SDPMLineIndex < 0 || p.SDPMLineIndex > 65535 {
			return authPayload{}, sdpPayload{}, p, CodeBadRequest
		}
		return authPayload{}, sdpPayload{}, p, ""
	case MsgAccept, MsgReject, MsgCandidatesEnd, MsgConnected, MsgRelease:
		var extra map[string]json.RawMessage
		if err := decodePayload(env, &extra); err != nil || len(extra) != 0 {
			return authPayload{}, sdpPayload{}, candidatePayload{}, CodeBadRequest
		}
		return authPayload{}, sdpPayload{}, candidatePayload{}, ""
	default:
		return authPayload{}, sdpPayload{}, candidatePayload{}, CodeBadRequest
	}
}

// validateFixtureEnvelope applies the stateless wire checks shared by the
// contract fixtures: version, known type, shaped IDs. Role/state checks need
// a live server and are covered by Go exchange tests instead.
func validateFixtureEnvelope(env Envelope) string {
	if env.Version != SignalingVersion {
		return CodeUnsupportedVersion
	}
	known := clientMessageTypes[env.Type] || env.Type == MsgReady ||
		env.Type == MsgPeerRequested || env.Type == MsgPeerAccepted ||
		env.Type == MsgPeerRejected || env.Type == MsgPeerConnected ||
		env.Type == MsgPeerReleased || env.Type == MsgError
	if !known {
		return CodeBadRequest
	}
	if !validRequestID(env.RequestID) {
		return CodeBadRequest
	}
	if env.AttemptID != "" && !validHexID(env.AttemptID) {
		return CodeBadRequest
	}
	return ""
}
