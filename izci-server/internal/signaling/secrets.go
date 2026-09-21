package signaling

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"regexp"
)

// Opaque ID/secret helpers. IDs are 128-bit hex; secrets and tokens are
// 256-bit base64url (no padding). Only digests are stored; raw values travel
// in a single response and are never logged.

var (
	hexIDPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)
	noncePattern = regexp.MustCompile(`^[A-Za-z0-9_-]{8,128}$`)
)

func sha256Sum(data []byte) [32]byte {
	return sha256.Sum256(data)
}

func digestOfString(s string) [32]byte {
	return sha256.Sum256([]byte(s))
}

func digestKey(d [32]byte) string {
	return string(d[:])
}

func digestsEqual(a, b [32]byte) bool {
	return subtle.ConstantTimeCompare(a[:], b[:]) == 1
}

// newRoomID returns a random 128-bit room ID as 32 lowercase hex chars.
func newRoomID() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("cannot generate room id: %w", err)
	}
	return hex.EncodeToString(raw[:]), nil
}

// newAttemptID returns a random 128-bit attempt ID as 32 hex chars.
func newAttemptID() (string, error) {
	return newRoomID()
}

// newSecret returns 32 random bytes encoded as base64url (43 chars). Used for
// owner secrets, invitation secrets, session tokens, connection tokens, and
// socket tickets alike; all are stored as SHA-256 digests.
func newSecret() (string, error) {
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", fmt.Errorf("cannot generate secret: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw[:]), nil
}

// newRequestID returns a random socket message correlation ID.
func newRequestID() string {
	var raw [8]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "req-fallback"
	}
	return "srv-" + hex.EncodeToString(raw[:])
}

func validHexID(s string) bool {
	return hexIDPattern.MatchString(s)
}

func validNonce(s string) bool {
	return noncePattern.MatchString(s)
}

// parseSecretToken decodes a 256-bit base64url token and returns its digest.
// It reports whether the shape is valid; unknown-but-shaped tokens simply
// miss every digest map.
func parseSecretToken(s string) ([32]byte, bool) {
	var zero [32]byte
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil || len(raw) != 32 {
		return zero, false
	}
	return sha256.Sum256(raw), true
}

// parseHexKey decodes a 64-char hex operator key for login comparison.
func parseHexKey(s string) ([32]byte, bool) {
	var zero [32]byte
	if len(s) != 64 {
		return zero, false
	}
	raw, err := hex.DecodeString(s)
	if err != nil || len(raw) != 32 {
		return zero, false
	}
	var key [32]byte
	copy(key[:], raw)
	return key, true
}
