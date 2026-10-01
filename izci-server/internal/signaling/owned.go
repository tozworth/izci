package signaling

import (
	"crypto/rand"
	"log"
	"time"

	"github.com/dunsparce9/izci/izci-server/internal/config"
)

// NewOwned provisions exactly one private owner via the parent process pipe.
// Public host login is disabled, including requests from localhost. Guests use
// the ordinary invitation/admission protocol; no desktop-specific wire format.
func NewOwned(cfg *config.Config, logger *log.Logger) (*Server, string, error) {
	var key [32]byte
	if _, err := rand.Read(key[:]); err != nil {
		return nil, "", err
	}
	s, err := New(cfg, logger, key)
	if err != nil {
		return nil, "", err
	}
	token, err := newSecret()
	if err != nil {
		return nil, "", err
	}
	digest, _ := parseSecretToken(token)
	s.sessions[digestKey(digest)] = &hostSession{digest: digest, expiresAt: s.now().Add(time.Duration(cfg.Limits.HostSessionTTL))}
	s.owned = true
	return s, token, nil
}
