// Package config loads and validates the server's strict JSON configuration.
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
	"path/filepath"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/tozworth/izci/izci-server/internal/library"
)

const (
	// DefaultListen is the default bind address. The container example uses
	// 0.0.0.0:8787 instead.
	DefaultListen = "127.0.0.1:8787"

	maxTextLen   = 280
	maxIceURLs   = 16
	maxIceURLLen = 256

	// DefaultRelayCredentialTTL is the lifetime of TURN credentials issued
	// by POST /v1/ice (standard coturn REST shared-secret expiry).
	DefaultRelayCredentialTTL = Duration(10 * time.Minute)
	// DefaultMaxIcePerConnection caps POST /v1/ice issuance per admitted
	// connection so one guest cannot mint unbounded TURN credentials.
	DefaultMaxIcePerConnection = 16
)

// Default limits shared with later phases (see docs/multiplayer-server-plan.md).
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

// Library and media defaults for Phase 2 (persistent library + source-file
// playback) and Phase 3 (buffered Opus rendering). See
// docs/izci-server-plan.md.
const (
	DefaultLibraryScanConcurrency = 8
	DefaultSourceTransferMode     = "always"
	DefaultSourceTransferMaxBytes = int64(32 * 1024 * 1024)
	DefaultCatalogMaxPerCollect   = 50000
	DefaultCatalogMaxTotal        = 100000
	DefaultRenderBitrateKbps      = 128
	DefaultRenderCacheSizeMB      = int64(512)
	DefaultRenderMaxEncoders      = 2
	DefaultMaxCommandsPerMinute   = 600
	DefaultMaxSeeksPerMinute      = 120
	DefaultMaxFreeplaySessions    = 8
	DefaultMaxSourceTransfers     = 16
	DefaultMaxRenderRanges        = 4096
	DefaultMaxRenderNeedsPerMin   = 600
	DefaultMaxChatHistory         = 200
	DefaultMaxControlMessageBytes = 64 * 1024
	DefaultMaxMediaBufferedBytes  = 512 * 1024
	DefaultMaxRenderBufferedBytes = 512 * 1024
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
	MaxCommandsPerMinute           int      `json:"maxCommandsPerMinute"`
	MaxSeeksPerMinute              int      `json:"maxSeeksPerMinute"`
	MaxFreeplaySessions            int      `json:"maxFreeplaySessions"`
	MaxSourceTransfers             int      `json:"maxSourceTransfers"`
	MaxRenderRanges                int      `json:"maxRenderRanges"`
	MaxRenderNeedsPerMinute        int      `json:"maxRenderNeedsPerMinute"`
	MaxChatHistory                 int      `json:"maxChatHistory"`
	MaxControlMessageBytes         int      `json:"maxControlMessageBytes"`
	MaxMediaBufferedBytes          int      `json:"maxMediaBufferedBytes"`
	MaxRenderBufferedBytes         int      `json:"maxRenderBufferedBytes"`
}

// HostPolicy controls dedicated-host privileges and optional social features.
// Pairing is an application privilege established only after invitation
// admission; it never authorizes signaling administration.
type HostPolicy struct {
	SharedControl string `json:"sharedControl"` // "all" or "paired"
	AutoPair      bool   `json:"autoPair"`
	ChatEnabled   bool   `json:"chatEnabled"`
	Motd          string `json:"motd"`
}

// RTCConfig controls server-side ICE gathering. PublicIPs are fixed public
// candidate mappings for one-to-one NAT; UDPMin/UDPMax optionally constrain
// the ephemeral UDP range for firewall rules (both zero means unrestricted).
type RTCConfig struct {
	PublicIPs []string `json:"publicIps"`
	UDPMin    uint16   `json:"udpPortMin"`
	UDPMax    uint16   `json:"udpPortMax"`
}

// Config is the server's top-level JSON configuration.
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
	// RelaySecretFile optionally points at a file holding the shared
	// secret for a coturn REST (static-auth-secret) relay. When set, the
	// turn:/turns: entries of IceURLs are issued time-limited credentials
	// by POST /v1/ice; without it those URLs are advertised bare.
	RelaySecretFile string `json:"relaySecretFile"`
	// RelayCredentialTtl is the TURN credential lifetime (default 10m).
	RelayCredentialTtl Duration `json:"relayCredentialTtl"`
	// MaxIcePerConnection caps POST /v1/ice calls per admitted connection.
	MaxIcePerConnection int            `json:"maxIcePerConnection"`
	Limits              Limits         `json:"limits"`
	Library             LibraryConfig  `json:"library"`
	SourceTransfer      SourceTransfer `json:"sourceTransfer"`
	Render              RenderConfig   `json:"render"`
	Database            DatabaseConfig `json:"database"`
	Catalog             CatalogConfig  `json:"catalog"`
	Host                HostPolicy     `json:"host"`
	RTC                 RTCConfig      `json:"rtc"`
}

// LibraryRoot maps one filesystem directory to one virtual mount such as
// "/music". Catalog records expose only virtual paths; absolute
// filesystem paths are never published.
type LibraryRoot struct {
	Name    string   `json:"name"`
	Path    string   `json:"path"`
	Include []string `json:"include"`
	Exclude []string `json:"exclude"`
}

// LibraryConfig holds named library roots and scan behavior.
type LibraryConfig struct {
	Roots []LibraryRoot `json:"roots"`
	// ScanConcurrency bounds parallel file inspection during scans.
	ScanConcurrency int `json:"scanConcurrency"`
	// RescanInterval re-scans library roots periodically; zero disables.
	RescanInterval Duration `json:"rescanInterval"`
}

// SourceTransfer holds the Phase 2 delivery policy:
//
//	no playable item or audio disabled -> none
//	source transfer enabled and file matches size policy -> source-file
//	otherwise (finite decodable input without a renderer yet) -> none
//
// Modes: "always" transfers every playable file, "never" disables
// source transfer entirely, "threshold" transfers files at or under
// MaxBytes. The server never silently transfers when mode is "never".
type SourceTransfer struct {
	Mode     string `json:"mode"`
	MaxBytes int64  `json:"maxBytes"`
}

// RenderConfig owns buffered-Opus rendering: encoder bitrate, on-disk
// cache location and bound, and the encoder-process cap. An empty
// CacheDir derives a directory (alongside the database when set,
// otherwise the OS temp dir); rendered bytes are rebuildable cache
// entries, never library records.
type RenderConfig struct {
	BitrateKbps int    `json:"bitrateKbps"`
	CacheDir    string `json:"cacheDir"`
	CacheSizeMB int64  `json:"cacheSizeMB"`
	MaxEncoders int    `json:"maxEncoders"`
}

// DatabaseConfig owns the SQLite location. An empty Path keeps durable
// host state (identity, library, queue, pairings) in memory only; setting
// a file path makes restarts preserve identity and catalog stability.
type DatabaseConfig struct {
	Path string `json:"path"`
}

// CatalogConfig bounds catalog encoding. Item limits are applied before
// encoding so oversized libraries cannot blow the control channel.
type CatalogConfig struct {
	MaxItemsPerCollection int `json:"maxItemsPerCollection"`
	MaxTotalItems         int `json:"maxTotalItems"`
}

// Default returns the configuration with default listen address and limits.
// Required operator fields (PublicBaseURL, HostKeyFile) are left empty and
// must be supplied by the config file.
func Default() Config {
	return Config{
		Listen:              DefaultListen,
		PathPrefix:          "",
		AllowedOrigins:      []string{},
		TrustedProxies:      []string{},
		IceURLs:             []string{},
		RelayCredentialTtl:  DefaultRelayCredentialTTL,
		MaxIcePerConnection: DefaultMaxIcePerConnection,
		Library: LibraryConfig{
			Roots:           []LibraryRoot{},
			ScanConcurrency: DefaultLibraryScanConcurrency,
			RescanInterval:  Duration(0),
		},
		SourceTransfer: SourceTransfer{
			Mode:     DefaultSourceTransferMode,
			MaxBytes: DefaultSourceTransferMaxBytes,
		},
		Render: RenderConfig{
			BitrateKbps: DefaultRenderBitrateKbps,
			CacheDir:    "",
			CacheSizeMB: DefaultRenderCacheSizeMB,
			MaxEncoders: DefaultRenderMaxEncoders,
		},
		Database: DatabaseConfig{Path: ""},
		Catalog: CatalogConfig{
			MaxItemsPerCollection: DefaultCatalogMaxPerCollect,
			MaxTotalItems:         DefaultCatalogMaxTotal,
		},
		Host: HostPolicy{SharedControl: "all", AutoPair: true, ChatEnabled: true},
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
			MaxCommandsPerMinute:           DefaultMaxCommandsPerMinute,
			MaxSeeksPerMinute:              DefaultMaxSeeksPerMinute,
			MaxFreeplaySessions:            DefaultMaxFreeplaySessions,
			MaxSourceTransfers:             DefaultMaxSourceTransfers,
			MaxRenderRanges:                DefaultMaxRenderRanges,
			MaxRenderNeedsPerMinute:        DefaultMaxRenderNeedsPerMin,
			MaxChatHistory:                 DefaultMaxChatHistory,
			MaxControlMessageBytes:         DefaultMaxControlMessageBytes,
			MaxMediaBufferedBytes:          DefaultMaxMediaBufferedBytes,
			MaxRenderBufferedBytes:         DefaultMaxRenderBufferedBytes,
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
	if strings.TrimSpace(c.RelaySecretFile) != "" && len(c.RelaySecretFile) > 1024 {
		return fmt.Errorf("invalid config: relaySecretFile path is too long")
	}
	if ttl := time.Duration(c.RelayCredentialTtl); ttl < time.Minute || ttl > time.Hour {
		return fmt.Errorf("invalid config: relayCredentialTtl must be between 1m and 1h")
	}
	if c.MaxIcePerConnection < 1 || c.MaxIcePerConnection > 1024 {
		return fmt.Errorf("invalid config: maxIcePerConnection must be between 1 and 1024")
	}
	if err := c.Limits.validate(); err != nil {
		return err
	}
	if err := c.Library.validate(); err != nil {
		return err
	}
	if err := c.SourceTransfer.validate(); err != nil {
		return err
	}
	if err := c.Render.validate(); err != nil {
		return err
	}
	if err := c.Database.validate(); err != nil {
		return err
	}
	if err := c.Catalog.validate(); err != nil {
		return err
	}
	if err := c.Host.validate(); err != nil {
		return err
	}
	if err := c.RTC.validate(); err != nil {
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
		{"maxCommandsPerMinute", l.MaxCommandsPerMinute, 1, 100000},
		{"maxSeeksPerMinute", l.MaxSeeksPerMinute, 1, 100000},
		{"maxFreeplaySessions", l.MaxFreeplaySessions, 1, 1024},
		{"maxSourceTransfers", l.MaxSourceTransfers, 1, 4096},
		{"maxRenderRanges", l.MaxRenderRanges, 1, 100000},
		{"maxRenderNeedsPerMinute", l.MaxRenderNeedsPerMinute, 1, 100000},
		{"maxChatHistory", l.MaxChatHistory, 1, 200},
		{"maxControlMessageBytes", l.MaxControlMessageBytes, 1024, 1024 * 1024},
		{"maxMediaBufferedBytes", l.MaxMediaBufferedBytes, 16 * 1024, 16 * 1024 * 1024},
		{"maxRenderBufferedBytes", l.MaxRenderBufferedBytes, 16 * 1024, 16 * 1024 * 1024},
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

func (h *HostPolicy) validate() error {
	switch h.SharedControl {
	case "all", "paired":
	default:
		return fmt.Errorf("invalid config: host.sharedControl must be all or paired")
	}
	if utf8.RuneCountInString(h.Motd) > 500 {
		return fmt.Errorf("invalid config: host.motd must be at most 500 characters")
	}
	for _, r := range h.Motd {
		if unicode.IsControl(r) {
			return fmt.Errorf("invalid config: host.motd must not contain control characters")
		}
	}
	return nil
}

func (r *RTCConfig) validate() error {
	if len(r.PublicIPs) > 16 {
		return fmt.Errorf("invalid config: rtc.publicIps must have at most 16 entries")
	}
	for _, raw := range r.PublicIPs {
		ip, err := netip.ParseAddr(raw)
		if err != nil || ip.IsUnspecified() || ip.IsMulticast() {
			return fmt.Errorf("invalid config: rtc.publicIps entry %q must be a unicast IP", raw)
		}
	}
	if (r.UDPMin == 0) != (r.UDPMax == 0) {
		return fmt.Errorf("invalid config: rtc.udpPortMin and rtc.udpPortMax must both be zero or both be set")
	}
	if r.UDPMin != 0 && (r.UDPMin > r.UDPMax || int(r.UDPMax)-int(r.UDPMin) < 31) {
		return fmt.Errorf("invalid config: rtc UDP range must contain at least 32 ports")
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

// LoadRelaySecret reads the shared coturn REST secret file. The file holds
// the raw secret text (as with coturn's static-auth-secret) with optional
// surrounding whitespace. Errors never include secret material.
func LoadRelaySecret(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("cannot read relay secret file: %w", err)
	}
	secret := bytes.TrimSpace(data)
	if len(secret) < 8 || len(secret) > 512 {
		return nil, fmt.Errorf("relay secret must be between 8 and 512 bytes")
	}
	return secret, nil
}

// HostKeyLength is the required operator key size in bytes.
const HostKeyLength = 32

// validate is the shared mount-name alphabet: single-segment names map to
// "/<name>"; multi-segment mounts like "music/rock" map to
// "/music/rock". Segments use URL-safe characters only.
func validMountName(name string) bool {
	if name == "" || len(name) > 128 {
		return false
	}
	// Allow "music" or "music/rock" but no leading/trailing slash,
	// no empty segments, no dot segments.
	if strings.HasPrefix(name, "/") || strings.HasSuffix(name, "/") {
		return false
	}
	for _, seg := range strings.Split(name, "/") {
		if seg == "" || seg == "." || seg == ".." {
			return false
		}
		if len(seg) > 64 {
			return false
		}
		for _, r := range seg {
			if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' {
				continue
			}
			switch r {
			case '-', '_':
				continue
			}
			return false
		}
	}
	return true
}

// VirtualMount returns the canonical virtual prefix for a root name.
func (r LibraryRoot) VirtualMount() string {
	return "/" + strings.Trim(r.Name, "/")
}

// validate checks named library roots, virtual mounts, and scan behavior.
// Unknown fields are already rejected by DisallowUnknownFields; here we
// reject ambiguous or overlapping virtual roots and filesystem roots.
func (l *LibraryConfig) validate() error {
	if len(l.Roots) > 64 {
		return fmt.Errorf("invalid config: library.roots must have at most 64 entries")
	}
	if l.ScanConcurrency < 1 || l.ScanConcurrency > 64 {
		return fmt.Errorf("invalid config: library.scanConcurrency must be between 1 and 64")
	}
	if d := time.Duration(l.RescanInterval); d < 0 || d > 24*time.Hour {
		return fmt.Errorf("invalid config: library.rescanInterval must be between 0 and 24h")
	}
	seenMounts := map[string]string{}
	seenPaths := []string{}
	for i, root := range l.Roots {
		if !validMountName(root.Name) {
			return fmt.Errorf("invalid config: library.roots[%d].name must be 1-64 char segments of [A-Za-z0-9_-] separated by \"/\"", i)
		}
		mount := LibraryRoot{Name: root.Name}.VirtualMount()
		// Normalize case-insensitively for ambiguity: "/Music" vs "/music".
		lower := strings.ToLower(mount)
		if prev, dup := seenMounts[lower]; dup {
			return fmt.Errorf("invalid config: library.roots[%d] virtual mount %q overlaps %q", i, mount, prev)
		}
		// Prefix overlap: "/music" overlaps "/music/rock".
		for prevLower, prev := range seenMounts {
			if lower == prevLower || strings.HasPrefix(lower+"/", prevLower+"/") || strings.HasPrefix(prevLower+"/", lower+"/") {
				return fmt.Errorf("invalid config: library.roots[%d] virtual mount %q overlaps %q", i, mount, prev)
			}
		}
		seenMounts[lower] = mount
		if strings.TrimSpace(root.Path) == "" || len(root.Path) > 4096 {
			return fmt.Errorf("invalid config: library.roots[%d].path is required (1-4096 chars)", i)
		}
		for _, r := range root.Path {
			if unicode.IsControl(r) {
				return fmt.Errorf("invalid config: library.roots[%d].path must not contain control characters", i)
			}
		}
		if len(root.Include) > 128 || len(root.Exclude) > 128 {
			return fmt.Errorf("invalid config: library.roots[%d] include/exclude must have at most 128 patterns", i)
		}
		for field, patterns := range map[string][]string{"include": root.Include, "exclude": root.Exclude} {
			seen := map[string]bool{}
			for j, pattern := range patterns {
				if err := library.ValidateGlob(pattern); err != nil {
					return fmt.Errorf("invalid config: library.roots[%d].%s[%d] %v", i, field, j, err)
				}
				if seen[pattern] {
					return fmt.Errorf("invalid config: library.roots[%d].%s contains duplicate pattern %q", i, field, pattern)
				}
				seen[pattern] = true
			}
		}
		// Filesystem overlap: one root containing another would scan the
		// same file twice under two virtual mounts (ambiguous identity).
		clean, err := filepath.Abs(strings.TrimSpace(root.Path))
		if err != nil {
			return fmt.Errorf("invalid config: library.roots[%d].path is invalid", i)
		}
		clean = filepath.Clean(clean)
		for _, prev := range seenPaths {
			rel, relErr := filepath.Rel(prev, clean)
			reverseRel, reverseErr := filepath.Rel(clean, prev)
			if (relErr == nil && (rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))))) ||
				(reverseErr == nil && (reverseRel == "." || (reverseRel != ".." && !strings.HasPrefix(reverseRel, ".."+string(filepath.Separator))))) {
				return fmt.Errorf("invalid config: library.roots[%d].path %q overlaps another root %q", i, root.Path, prev)
			}
		}
		seenPaths = append(seenPaths, clean)
	}
	return nil
}

func (s *SourceTransfer) validate() error {
	switch s.Mode {
	case "always", "never", "threshold":
	default:
		return fmt.Errorf("invalid config: sourceTransfer.mode must be one of \"always\", \"never\", \"threshold\"")
	}
	if s.MaxBytes < 0 || s.MaxBytes > 8*1024*1024*1024 {
		return fmt.Errorf("invalid config: sourceTransfer.maxBytes must be between 0 and 8GiB")
	}
	if s.Mode == "threshold" && s.MaxBytes <= 0 {
		return fmt.Errorf("invalid config: sourceTransfer.maxBytes must be positive in threshold mode")
	}
	return nil
}

func (r *RenderConfig) validate() error {
	if r.BitrateKbps < 24 || r.BitrateKbps > 512 {
		return fmt.Errorf("invalid config: render.bitrateKbps must be between 24 and 512")
	}
	if r.CacheDir != "" {
		if len(r.CacheDir) > 4096 {
			return fmt.Errorf("invalid config: render.cacheDir is too long")
		}
		for _, c := range r.CacheDir {
			if unicode.IsControl(c) {
				return fmt.Errorf("invalid config: render.cacheDir must not contain control characters")
			}
		}
	}
	if r.CacheSizeMB < 16 || r.CacheSizeMB > 65536 {
		return fmt.Errorf("invalid config: render.cacheSizeMB must be between 16 and 65536")
	}
	if r.MaxEncoders < 1 || r.MaxEncoders > 16 {
		return fmt.Errorf("invalid config: render.maxEncoders must be between 1 and 16")
	}
	return nil
}

func (d *DatabaseConfig) validate() error {
	if d.Path == "" {
		return nil
	}
	if len(d.Path) > 4096 {
		return fmt.Errorf("invalid config: database.path is too long")
	}
	for _, r := range d.Path {
		if unicode.IsControl(r) {
			return fmt.Errorf("invalid config: database.path must not contain control characters")
		}
	}
	return nil
}

func (c *CatalogConfig) validate() error {
	if c.MaxItemsPerCollection < 1 || c.MaxItemsPerCollection > 50000 {
		return fmt.Errorf("invalid config: catalog.maxItemsPerCollection must be between 1 and 50000")
	}
	if c.MaxTotalItems < 1 || c.MaxTotalItems > 150000 {
		return fmt.Errorf("invalid config: catalog.maxTotalItems must be between 1 and 150000")
	}
	return nil
}

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
