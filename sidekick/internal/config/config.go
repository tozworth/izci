// Package config loads and validates the sidekick's strict JSON configuration.
//
// The file must contain exactly the known fields (unknown fields are
// rejected) and every value is range-checked. Durations are JSON strings in
// Go duration syntax (e.g. "12h", "30s"). Sizes are byte counts.
package config

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"os"
	"path"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	// DefaultListen is the default bind address. The container example uses
	// 0.0.0.0:8787 instead.
	DefaultListen = "127.0.0.1:8787"

	maxTextLen   = 280
	maxIceURLs   = 16
	maxIceURLLen = 256
)

// Default limits shared with later phases (see docs/multiplayer-sidekick-plan.md).
const (
	DefaultMaxRooms                       = 4
	DefaultMaxPeersPerRoom                = 8
	DefaultMaxPendingAttemptsPerRoom      = 8
	DefaultMaxOpenSockets                 = 128
	DefaultHostSessionTTL                 = Duration(12 * time.Hour)
	DefaultRoomLeaseTTL                   = Duration(24 * time.Hour)
	DefaultSocketTicketTTL                = Duration(30 * time.Second)
	DefaultUnauthSocketTimeout            = Duration(5 * time.Second)
	DefaultAttemptTimeout                 = Duration(45 * time.Second)
	DefaultHostReconnectGrace             = Duration(90 * time.Second)
	DefaultMaxJSONMessageBytes            = 64 * 1024
	DefaultMaxSDPBytes                    = 50 * 1024
	DefaultMaxCandidateBytes              = 4 * 1024
	DefaultMaxCandidatesPerSidePerAttempt = 128
	DefaultMaxSocketQueueMessages         = 64
	DefaultMaxSocketQueueBytes            = 256 * 1024
	DefaultHeartbeatInterval              = Duration(20 * time.Second)
	DefaultHeartbeatTimeout               = Duration(10 * time.Second)
	DefaultCleanupInterval                = Duration(5 * time.Second)
	DefaultShutdownGrace                  = Duration(10 * time.Second)
)

// Duration is a time.Duration encoded as a JSON string ("12h", "30s").
type Duration time.Duration

// UnmarshalJSON implements json.Unmarshaler. Only strings are accepted.
func (d *Duration) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return fmt.Errorf("duration must be a string like \"30s\": %w", err)
	}
	v, err := time.ParseDuration(s)
	if err != nil {
		return fmt.Errorf("invalid duration %q: %w", s, err)
	}
	*d = Duration(v)
	return nil
}

// MarshalJSON implements json.Marshaler.
func (d Duration) MarshalJSON() ([]byte, error) {
	return json.Marshal(time.Duration(d).String())
}

// Seconds returns the duration in whole seconds.
func (d Duration) Seconds() int64 {
	return int64(time.Duration(d) / time.Second)
}

// Limits holds the operator-tunable room/socket/signaling bounds.
type Limits struct {
	MaxRooms                       int      `json:"maxRooms"`
	MaxPeersPerRoom                int      `json:"maxPeersPerRoom"`
	MaxPendingAttemptsPerRoom      int      `json:"maxPendingAttemptsPerRoom"`
	MaxOpenSockets                 int      `json:"maxOpenSockets"`
	HostSessionTTL                 Duration `json:"hostSessionTtl"`
	RoomLeaseTTL                   Duration `json:"roomLeaseTtl"`
	SocketTicketTTL                Duration `json:"socketTicketTtl"`
	UnauthSocketTimeout            Duration `json:"unauthSocketTimeout"`
	AttemptTimeout                 Duration `json:"attemptTimeout"`
	HostReconnectGrace             Duration `json:"hostReconnectGrace"`
	MaxJSONMessageBytes            int      `json:"maxJsonMessageBytes"`
	MaxSDPBytes                    int      `json:"maxSdpBytes"`
	MaxCandidateBytes              int      `json:"maxCandidateBytes"`
	MaxCandidatesPerSidePerAttempt int      `json:"maxCandidatesPerSidePerAttempt"`
	MaxSocketQueueMessages         int      `json:"maxSocketQueueMessages"`
	MaxSocketQueueBytes            int      `json:"maxSocketQueueBytes"`
	HeartbeatInterval              Duration `json:"heartbeatInterval"`
	HeartbeatTimeout               Duration `json:"heartbeatTimeout"`
	CleanupInterval                Duration `json:"cleanupInterval"`
	ShutdownGrace                  Duration `json:"shutdownGrace"`
}

// Config is the sidekick's top-level JSON configuration.
type Config struct {
	Listen         string   `json:"listen"`
	PublicBaseURL  string   `json:"publicBaseUrl"`
	PathPrefix     string   `json:"pathPrefix"`
	AllowedOrigins []string `json:"allowedOrigins"`
	HostKeyFile    string   `json:"hostKeyFile"`
	TrustedProxies []string `json:"trustedProxies"`
	Description    string   `json:"description"`
	Contact        string   `json:"contact"`
	IceURLs        []string `json:"iceUrls"`
	Limits         Limits   `json:"limits"`
}

// Default returns the configuration with default listen address and limits.
// Required operator fields (PublicBaseURL, HostKeyFile) are left empty and
// must be supplied by the config file.
func Default() Config {
	return Config{
		Listen:         DefaultListen,
		PathPrefix:     "",
		AllowedOrigins: []string{},
		TrustedProxies: []string{},
		IceURLs:        []string{},
		Limits: Limits{
			MaxRooms:                       DefaultMaxRooms,
			MaxPeersPerRoom:                DefaultMaxPeersPerRoom,
			MaxPendingAttemptsPerRoom:      DefaultMaxPendingAttemptsPerRoom,
			MaxOpenSockets:                 DefaultMaxOpenSockets,
			HostSessionTTL:                 DefaultHostSessionTTL,
			RoomLeaseTTL:                   DefaultRoomLeaseTTL,
			SocketTicketTTL:                DefaultSocketTicketTTL,
			UnauthSocketTimeout:            DefaultUnauthSocketTimeout,
			AttemptTimeout:                 DefaultAttemptTimeout,
			HostReconnectGrace:             DefaultHostReconnectGrace,
			MaxJSONMessageBytes:            DefaultMaxJSONMessageBytes,
			MaxSDPBytes:                    DefaultMaxSDPBytes,
			MaxCandidateBytes:              DefaultMaxCandidateBytes,
			MaxCandidatesPerSidePerAttempt: DefaultMaxCandidatesPerSidePerAttempt,
			MaxSocketQueueMessages:         DefaultMaxSocketQueueMessages,
			MaxSocketQueueBytes:            DefaultMaxSocketQueueBytes,
			HeartbeatInterval:              DefaultHeartbeatInterval,
			HeartbeatTimeout:               DefaultHeartbeatTimeout,
			CleanupInterval:                DefaultCleanupInterval,
			ShutdownGrace:                  DefaultShutdownGrace,
		},
	}
}

// Load parses strict JSON configuration, applying defaults for omitted fields.
func Load(data []byte) (*Config, error) {
	cfg := Default()
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&cfg); err != nil {
		return nil, fmt.Errorf("invalid config: %w", err)
	}
	if dec.More() {
		return nil, fmt.Errorf("invalid config: unexpected trailing data")
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	return &cfg, nil
}

// LoadFile reads and parses the config file at path.
func LoadFile(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("cannot read config file: %w", err)
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return nil, fmt.Errorf("invalid config: file is empty")
	}
	return Load(data)
}

// Validate checks every field of an already-decoded Config.
func (c *Config) Validate() error {
	if err := validateListen(c.Listen); err != nil {
		return err
	}
	prefix, err := normalizePrefix(c.PathPrefix)
	if err != nil {
		return err
	}
	c.PathPrefix = prefix
	if err := validatePublicBaseURL(c.PublicBaseURL, prefix); err != nil {
		return err
	}
	if err := validateOrigins(c.AllowedOrigins); err != nil {
		return err
	}
	if strings.TrimSpace(c.HostKeyFile) == "" {
		return fmt.Errorf("invalid config: hostKeyFile is required")
	}
	if err := validateProxies(c.TrustedProxies); err != nil {
		return err
	}
	if err := validateText("description", c.Description); err != nil {
		return err
	}
	if err := validateText("contact", c.Contact); err != nil {
		return err
	}
	if err := validateIceURLs(c.IceURLs); err != nil {
		return err
	}
	if err := c.Limits.validate(); err != nil {
		return err
	}
	return nil
}

func validateListen(addr string) error {
	if strings.TrimSpace(addr) == "" {
		return fmt.Errorf("invalid config: listen is required")
	}
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("invalid config: listen must be host:port: %w", err)
	}
	if host == "" {
		return fmt.Errorf("invalid config: listen host is empty")
	}
	n, err := net.LookupPort("tcp", port)
	if err != nil || n <= 0 || n > 65535 {
		return fmt.Errorf("invalid config: listen has invalid port %q", port)
	}
	return nil
}

// normalizePrefix cleans the deployment path prefix: "" or "/a/b" (no
// trailing slash, no "." / ".." segments).
func normalizePrefix(p string) (string, error) {
	if p == "" || p == "/" {
		return "", nil
	}
	if !strings.HasPrefix(p, "/") {
		return "", fmt.Errorf("invalid config: pathPrefix must start with \"/\"")
	}
	if strings.HasSuffix(p, "/") {
		return "", fmt.Errorf("invalid config: pathPrefix must not end with \"/\"")
	}
	if path.Clean(p) != p {
		return "", fmt.Errorf("invalid config: pathPrefix is not clean")
	}
	for _, seg := range strings.Split(strings.TrimPrefix(p, "/"), "/") {
		if seg == "" || seg == "." || seg == ".." {
			return "", fmt.Errorf("invalid config: pathPrefix has empty or relative segment")
		}
		for _, r := range seg {
			if r < 0x20 || r == 0x7f || r > unicode.MaxASCII || (!isPathChar(r)) {
				return "", fmt.Errorf("invalid config: pathPrefix has invalid character")
			}
		}
	}
	return p, nil
}

func isPathChar(r rune) bool {
	if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' {
		return true
	}
	switch r {
	case '-', '_', '.', '~':
		return true
	}
	return false
}

func validatePublicBaseURL(raw, prefix string) error {
	if strings.TrimSpace(raw) == "" {
		return fmt.Errorf("invalid config: publicBaseUrl is required")
	}
	u, err := url.Parse(raw)
	if err != nil || !u.IsAbs() {
		return fmt.Errorf("invalid config: publicBaseUrl must be an absolute URL")
	}
	if u.User != nil {
		return fmt.Errorf("invalid config: publicBaseUrl must not contain credentials")
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("invalid config: publicBaseUrl must not contain query or fragment")
	}
	if u.Hostname() == "" {
		return fmt.Errorf("invalid config: publicBaseUrl must have a host")
	}
	switch u.Scheme {
	case "https":
	case "http":
		if !isLoopbackHost(u.Hostname()) {
			return fmt.Errorf("invalid config: publicBaseUrl must use https (http is allowed only for loopback)")
		}
	default:
		return fmt.Errorf("invalid config: publicBaseUrl must use https")
	}
	basePath := strings.TrimSuffix(u.EscapedPath(), "/")
	if basePath == "/" {
		basePath = ""
	}
	if basePath != prefix {
		return fmt.Errorf("invalid config: publicBaseUrl path %q must match pathPrefix %q", basePath, prefix)
	}
	return nil
}

func isLoopbackHost(host string) bool {
	h := strings.ToLower(strings.TrimSuffix(host, "."))
	if h == "localhost" {
		return true
	}
	if ip, err := netip.ParseAddr(h); err == nil {
		return ip.IsLoopback()
	}
	return false
}

// NormalizeOrigin parses an exact browser origin (scheme://host[:port]) and
// returns its canonical form.
func NormalizeOrigin(raw string) (string, error) {
	u, err := url.Parse(raw)
	if err != nil || !u.IsAbs() {
		return "", fmt.Errorf("must be an absolute URL")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("scheme must be http or https")
	}
	if u.User != nil {
		return "", fmt.Errorf("must not contain credentials")
	}
	if u.Hostname() == "" {
		return "", fmt.Errorf("must have a host")
	}
	if u.Path != "" && u.Path != "/" || u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("must not contain path, query, or fragment")
	}
	scheme := strings.ToLower(u.Scheme)
	host := strings.ToLower(u.Hostname())
	if strings.HasSuffix(host, ".") {
		host = strings.TrimSuffix(host, ".")
	}
	if u.Port() != "" {
		return scheme + "://" + host + ":" + u.Port(), nil
	}
	return scheme + "://" + host, nil
}

func validateOrigins(origins []string) error {
	seen := make(map[string]struct{}, len(origins))
	for _, o := range origins {
		n, err := NormalizeOrigin(o)
		if err != nil {
			return fmt.Errorf("invalid config: allowedOrigins entry %q: %w", o, err)
		}
		if _, dup := seen[n]; dup {
			return fmt.Errorf("invalid config: duplicate allowedOrigins entry %q", o)
		}
		seen[n] = struct{}{}
	}
	return nil
}

func validateProxies(proxies []string) error {
	for _, p := range proxies {
		if _, err := netip.ParsePrefix(p); err == nil {
			continue
		}
		addr, err := netip.ParseAddr(p)
		if err != nil {
			return fmt.Errorf("invalid config: trustedProxies entry %q must be an IP or CIDR", p)
		}
		_ = addr
	}
	return nil
}

func validateText(name, s string) error {
	if utf8.RuneCountInString(s) > maxTextLen {
		return fmt.Errorf("invalid config: %s must be at most %d characters", name, maxTextLen)
	}
	for _, r := range s {
		if unicode.IsControl(r) {
			return fmt.Errorf("invalid config: %s must not contain control characters", name)
		}
	}
	return nil
}

func validateIceURLs(urls []string) error {
	if len(urls) > maxIceURLs {
		return fmt.Errorf("invalid config: iceUrls must have at most %d entries", maxIceURLs)
	}
	for _, raw := range urls {
		if len(raw) > maxIceURLLen {
			return fmt.Errorf("invalid config: iceUrls entry is too long")
		}
		u, err := url.Parse(raw)
		if err != nil || !u.IsAbs() {
			return fmt.Errorf("invalid config: iceUrls entry %q must be an absolute URL", raw)
		}
		switch strings.ToLower(u.Scheme) {
		case "stun", "stuns", "turn", "turns":
		default:
			return fmt.Errorf("invalid config: iceUrls entry %q must use stun/stuns/turn/turns", raw)
		}
		// STUN/TURN URIs are usually opaque ("stun:host:port", RFC 7064);
		// hierarchical ("stun://host:port") forms are accepted too.
		host := u.Hostname()
		if host == "" && u.Opaque != "" {
			host = u.Opaque
			if h, _, err := net.SplitHostPort(u.Opaque); err == nil {
				host = h
			}
		}
		if host == "" {
			return fmt.Errorf("invalid config: iceUrls entry %q must have a host", raw)
		}
	}
	return nil
}

func (l *Limits) validate() error {
	checkInt := func(name string, v, min, max int) error {
		if v < min || v > max {
			return fmt.Errorf("invalid config: limits.%s must be between %d and %d", name, min, max)
		}
		return nil
	}
	checkDur := func(name string, v Duration, min, max time.Duration) error {
		d := time.Duration(v)
		if d < min || d > max {
			return fmt.Errorf("invalid config: limits.%s must be between %s and %s", name, min, max)
		}
		return nil
	}
	for _, c := range []struct {
		name        string
		v, min, max int
	}{
		{"maxRooms", l.MaxRooms, 1, 1024},
		{"maxPeersPerRoom", l.MaxPeersPerRoom, 1, 1024},
		{"maxPendingAttemptsPerRoom", l.MaxPendingAttemptsPerRoom, 1, 1024},
		{"maxOpenSockets", l.MaxOpenSockets, 1, 65536},
		{"maxJsonMessageBytes", l.MaxJSONMessageBytes, 1024, 1024 * 1024},
		{"maxSdpBytes", l.MaxSDPBytes, 1024, 1024 * 1024},
		{"maxCandidateBytes", l.MaxCandidateBytes, 256, 64 * 1024},
		{"maxCandidatesPerSidePerAttempt", l.MaxCandidatesPerSidePerAttempt, 1, 4096},
		{"maxSocketQueueMessages", l.MaxSocketQueueMessages, 1, 1024},
		{"maxSocketQueueBytes", l.MaxSocketQueueBytes, 4096, 16 * 1024 * 1024},
	} {
		if err := checkInt(c.name, c.v, c.min, c.max); err != nil {
			return err
		}
	}
	for _, c := range []struct {
		name     string
		v        Duration
		min, max time.Duration
	}{
		{"hostSessionTtl", l.HostSessionTTL, time.Minute, 168 * time.Hour},
		{"roomLeaseTtl", l.RoomLeaseTTL, time.Minute, 720 * time.Hour},
		{"socketTicketTtl", l.SocketTicketTTL, time.Second, 10 * time.Minute},
		{"unauthSocketTimeout", l.UnauthSocketTimeout, time.Second, time.Minute},
		{"attemptTimeout", l.AttemptTimeout, 5 * time.Second, 10 * time.Minute},
		{"hostReconnectGrace", l.HostReconnectGrace, 5 * time.Second, 30 * time.Minute},
		{"heartbeatInterval", l.HeartbeatInterval, time.Second, 5 * time.Minute},
		{"heartbeatTimeout", l.HeartbeatTimeout, time.Second, 5 * time.Minute},
		{"cleanupInterval", l.CleanupInterval, time.Second, 5 * time.Minute},
		{"shutdownGrace", l.ShutdownGrace, 0, 5 * time.Minute},
	} {
		if err := checkDur(c.name, c.v, c.min, c.max); err != nil {
			return err
		}
	}
	return nil
}

// TrustedProxyPrefixes parses TrustedProxies into netip.Prefix values. A bare
// IP becomes a host route (/32 or /128).
func (c *Config) TrustedProxyPrefixes() ([]netip.Prefix, error) {
	out := make([]netip.Prefix, 0, len(c.TrustedProxies))
	for _, p := range c.TrustedProxies {
		if prefix, err := netip.ParsePrefix(p); err == nil {
			out = append(out, prefix.Masked())
			continue
		}
		addr, err := netip.ParseAddr(p)
		if err != nil {
			return nil, fmt.Errorf("invalid trusted proxy %q: %w", p, err)
		}
		out = append(out, netip.PrefixFrom(addr, addr.BitLen()))
	}
	return out, nil
}

// PublicOrigin returns the canonical origin of PublicBaseURL.
func (c *Config) PublicOrigin() string {
	u, err := url.Parse(c.PublicBaseURL)
	if err != nil {
		return ""
	}
	n, err := NormalizeOrigin(u.Scheme + "://" + u.Host)
	if err != nil {
		return ""
	}
	return n
}

// AllowedOriginSet returns the public origin plus every configured allowed
// origin, deduplicated.
func (c *Config) AllowedOriginSet() map[string]struct{} {
	set := make(map[string]struct{}, len(c.AllowedOrigins)+1)
	if o := c.PublicOrigin(); o != "" {
		set[o] = struct{}{}
	}
	for _, o := range c.AllowedOrigins {
		if n, err := NormalizeOrigin(o); err == nil {
			set[n] = struct{}{}
		}
	}
	return set
}

// HostKeyLength is the required operator key size in bytes.
const HostKeyLength = 32

// LoadHostKey reads the secret file at path and decodes the 32-byte operator
// key. The file must contain hex-encoded bytes with optional surrounding
// whitespace. Errors never include key material.
func LoadHostKey(path string) ([HostKeyLength]byte, error) {
	var zero [HostKeyLength]byte
	data, err := os.ReadFile(path)
	if err != nil {
		return zero, fmt.Errorf("cannot read host key file: %w", err)
	}
	text := strings.TrimSpace(string(data))
	raw, err := hex.DecodeString(text)
	if err != nil {
		return zero, fmt.Errorf("host key file must contain hex-encoded bytes")
	}
	if len(raw) != HostKeyLength {
		return zero, fmt.Errorf("host key must decode to %d bytes, got %d", HostKeyLength, len(raw))
	}
	var key [HostKeyLength]byte
	copy(key[:], raw)
	return key, nil
}
