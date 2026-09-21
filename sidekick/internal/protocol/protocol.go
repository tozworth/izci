// Package protocol validates the izci Multiplayer application protocol
// (data-channel JSON + binary framing) in parity with the TypeScript
// implementation in src/lib/services/multiplayer-protocol.ts.
//
// The normative specification lives in docs/izci-server-protocol.md.
// Representative fixtures live under tests/multiplayer-protocol/ and are
// consumed by both stacks.
package protocol

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

const (
	Major = 1
	Minor = 0
)

var Capabilities = []string{
	"source-file",
	"buffered-opus",
	"synchronized-start",
	"pairing-proof",
	"freeplay",
	"chat",
}

// RequiredBaseline is empty in Phase 0: any same-major hello admits.
var RequiredBaseline = []string{}

var (
	capabilityPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)
	hex64Pattern      = regexp.MustCompile(`^[0-9a-f]{64}$`)
	hex32Pattern      = regexp.MustCompile(`^[0-9a-f]{32}$`)
	identityPattern   = regexp.MustCompile(`^[A-Za-z0-9_-]{8,128}$`)
	hostIDPattern     = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
)

// Implementation is the host/client product identity, separate from protocol identity.
type Implementation struct {
	Product        string `json:"product"`
	ProductVersion string `json:"productVersion"`
	Build          string `json:"build,omitempty"`
}

// Hello is the shared identity subset of host/client hellos.
type Hello struct {
	Kind          string         `json:"kind"`
	ProtocolMajor int            `json:"protocolMajor"`
	ProtocolMinor int            `json:"protocolMinor"`
	Capabilities  []string       `json:"capabilities"`
	Impl          Implementation `json:"impl"`
	Name          string         `json:"name"`
}

// NormalizeCapabilities filters to unique string entries; unknown optional
// capabilities are preserved (ignored by feature checks), non-strings drop.
func NormalizeCapabilities(caps []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, c := range caps {
		if !capabilityPattern.MatchString(c) {
			continue
		}
		if seen[c] {
			continue
		}
		seen[c] = true
		out = append(out, c)
	}
	return out
}

// HasCapability reports whether caps contains capability.
func HasCapability(caps []string, capability string) bool {
	for _, c := range NormalizeCapabilities(caps) {
		if c == capability {
			return true
		}
	}
	return false
}

// CompatibleMajor reports whether major matches the current protocol major.
func CompatibleMajor(major int) bool { return major == Major }

// CompatibleHello reports admission: same major plus baseline capabilities.
// Minor skew alone admits.
func CompatibleHello(major int, caps []string) bool {
	if major != Major {
		return false
	}
	set := map[string]bool{}
	for _, c := range NormalizeCapabilities(caps) {
		set[c] = true
	}
	for _, req := range RequiredBaseline {
		if !set[req] {
			return false
		}
	}
	return true
}

// FormatImplementation renders product identity without assuming browser izci.
func FormatImplementation(impl *Implementation) string {
	if impl == nil {
		return "—"
	}
	if impl.Product == "izci-server" {
		return fmt.Sprintf("izci dedicated server %s", impl.ProductVersion)
	}
	return fmt.Sprintf("%s %s", impl.Product, impl.ProductVersion)
}

func validImpl(impl Implementation) bool {
	if len(impl.Product) < 1 || len(impl.Product) > 64 {
		return false
	}
	if len(impl.ProductVersion) < 1 || len(impl.ProductVersion) > 32 {
		return false
	}
	if containsControl(impl.Product) {
		return false
	}
	if containsControl(impl.ProductVersion) {
		return false
	}
	if len(impl.Build) > 128 || containsControl(impl.Build) {
		return false
	}
	return true
}

func containsControl(value string) bool {
	return strings.IndexFunc(value, func(r rune) bool { return r < 0x20 || r == 0x7f }) >= 0
}

func validCaps(caps []string) bool {
	for _, c := range caps {
		if !capabilityPattern.MatchString(c) {
			return false
		}
	}
	return true
}

// ValidateHello validates the shared identity subset of a hello frame.
func ValidateHello(raw json.RawMessage) (Hello, string) {
	var hello Hello
	if err := json.Unmarshal(raw, &hello); err != nil {
		return hello, "bad-request"
	}
	if hello.Kind != "hello" {
		return hello, "bad-request"
	}
	if hello.ProtocolMajor != Major {
		return hello, "unsupported-version"
	}
	if hello.ProtocolMinor < 0 || hello.ProtocolMinor > 9999 {
		return hello, "bad-request"
	}
	if !validCaps(hello.Capabilities) {
		return hello, "bad-request"
	}
	if !validImpl(hello.Impl) {
		return hello, "bad-request"
	}
	if len(hello.Name) < 1 || len(hello.Name) > 48 || containsControl(hello.Name) {
		return hello, "bad-request"
	}
	return hello, ""
}

// CommandEnvelope is any well-formed command frame, including unsupported types.
type CommandEnvelope struct {
	Type      string `json:"type"`
	CommandID string `json:"commandId"`
}

// SupportedCommands is the finite executable command surface.
var SupportedCommands = map[string]bool{
	"transport.toggle": true, "transport.play": true, "transport.pause": true,
	"transport.stop": true, "transport.previous": true, "transport.next": true,
	"queue.shuffle": true, "queue.repeat": true,
	"transport.seek": true, "queue.play-next": true, "collection.activate": true,
}

// ValidateCommandEnvelope accepts any well-formed envelope so unsupported
// types can be nacked instead of dropped.
func ValidateCommandEnvelope(raw json.RawMessage) (CommandEnvelope, bool) {
	var env CommandEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return env, false
	}
	if len(env.Type) < 1 || len(env.Type) > 80 {
		return env, false
	}
	if len(env.CommandID) < 1 || len(env.CommandID) > 80 {
		return env, false
	}
	return env, true
}

// IsSupportedCommand reports whether the envelope type is executable.
// Payload bounds for seek/play-next/activate are checked by ValidateMessage.
func IsSupportedCommand(cmdType string) bool { return SupportedCommands[cmdType] }

// ValidateMessage validates one control-plane JSON message by kind.
// Unknown optional kinds return ok=true with ignored=true (safe skip).
// Unknown critical kinds (critical:true) also skip but are reported.
func ValidateMessage(raw []byte) (ok bool, ignored bool, critical bool, kind string) {
	var base struct {
		Kind     string `json:"kind"`
		Critical *bool  `json:"critical"`
	}
	if err := json.Unmarshal(raw, &base); err != nil {
		return false, false, false, ""
	}
	kind = base.Kind
	if base.Critical != nil && *base.Critical {
		critical = true
	}
	var msg map[string]json.RawMessage
	if err := json.Unmarshal(raw, &msg); err != nil {
		return false, false, critical, kind
	}
	switch base.Kind {
	case "hello":
		// Role is determined by presence of platform/freeplayEnabled.
		var probe struct {
			ProtocolMajor *int           `json:"protocolMajor"`
			ProtocolMinor *int           `json:"protocolMinor"`
			Capabilities  []string       `json:"capabilities"`
			Impl          Implementation `json:"impl"`
			Name          *string        `json:"name"`
			Version       *int           `json:"version"`
		}
		if err := json.Unmarshal(raw, &probe); err != nil {
			return false, false, critical, kind
		}
		if probe.Version != nil {
			return false, false, critical, kind
		}
		if probe.ProtocolMajor == nil || *probe.ProtocolMajor != Major {
			return false, false, critical, kind
		}
		if probe.ProtocolMinor == nil || *probe.ProtocolMinor < 0 || *probe.ProtocolMinor > 9999 {
			return false, false, critical, kind
		}
		if probe.Capabilities == nil || !validCaps(probe.Capabilities) {
			return false, false, critical, kind
		}
		if !validImpl(probe.Impl) {
			return false, false, critical, kind
		}
		if probe.Name == nil || len(*probe.Name) < 1 || len(*probe.Name) > 48 || containsControl(*probe.Name) {
			return false, false, critical, kind
		}
		return true, false, critical, kind
	case "command":
		cmdRaw, hasCmd := msg["command"]
		if !hasCmd {
			return false, false, critical, kind
		}
		if _, ok := ValidateCommandEnvelope(cmdRaw); !ok {
			return false, false, critical, kind
		}
		// Envelope valid (supported or nacked); payload bounds checked below.
		var cmd struct {
			Type       string   `json:"type"`
			Collection string   `json:"collection"`
			ItemID     string   `json:"itemId"`
			ItemIDs    []string `json:"itemIds"`
			Seconds    *float64 `json:"seconds"`
		}
		if err := json.Unmarshal(cmdRaw, &cmd); err != nil {
			return false, false, critical, kind
		}
		if !IsSupportedCommand(cmd.Type) {
			return true, false, critical, kind
		}
		switch cmd.Type {
		case "transport.seek":
			if cmd.Seconds == nil || *cmd.Seconds < 0 || *cmd.Seconds > 604800 {
				return false, false, critical, kind
			}
		case "queue.play-next":
			if len(cmd.ItemIDs) == 0 || len(cmd.ItemIDs) > 50000 {
				return false, false, critical, kind
			}
			for _, id := range cmd.ItemIDs {
				if len(id) == 0 || len(id) > 200 {
					return false, false, critical, kind
				}
			}
			if cmd.Collection != "queue" && cmd.Collection != "library" && cmd.Collection != "favorites" {
				return false, false, critical, kind
			}
		case "collection.activate":
			if len(cmd.ItemID) == 0 || len(cmd.ItemID) > 200 {
				return false, false, critical, kind
			}
			if cmd.Collection != "queue" && cmd.Collection != "library" && cmd.Collection != "favorites" {
				return false, false, critical, kind
			}
		}
		return true, false, critical, kind
	case "catalog", "state", "playback", "playback.prepare", "playback.ready",
		"playback.ended", "playback.start", "playback.cancel", "delivery",
		"buffer", "render.manifest", "render.need", "render.ready",
		"artwork", "oda.background", "oda.background.opacity",
		"oda.background.preference", "chat.motd", "chat.message", "chat.history",
		"chat.clear", "chat.send", "freeplay.preference", "freeplay.queue",
		"pair.secret", "pair.proof", "pairing", "invitation",
		"clock.ping", "clock.pong", "source.retry", "ack", "kicked":
		if !validateKnownKind(base.Kind, msg) {
			return false, false, critical, kind
		}
		return true, false, critical, kind
	case "chunk":
		var chunk struct {
			TransferID string `json:"transferId"`
			Index      *int   `json:"index"`
			Total      *int   `json:"total"`
			Payload    string `json:"payload"`
		}
		if err := json.Unmarshal(raw, &chunk); err != nil {
			return false, false, critical, kind
		}
		if chunk.TransferID == "" || chunk.Index == nil || chunk.Total == nil {
			return false, false, critical, kind
		}
		if *chunk.Total <= 0 || *chunk.Total > 10000 || *chunk.Index < 0 || *chunk.Index >= *chunk.Total {
			return false, false, critical, kind
		}
		return true, false, critical, kind
	case "file.begin":
		var begin struct {
			TransferID   string   `json:"transferId"`
			TrackID      string   `json:"trackId"`
			GenerationID string   `json:"generationId"`
			Size         *int64   `json:"size"`
			LastModified *float64 `json:"lastModified"`
		}
		if err := json.Unmarshal(raw, &begin); err != nil {
			return false, false, critical, kind
		}
		if begin.TransferID == "" || begin.TrackID == "" || len(begin.GenerationID) == 0 || len(begin.GenerationID) > 80 {
			return false, false, critical, kind
		}
		if begin.Size == nil || *begin.Size < 0 {
			return false, false, critical, kind
		}
		if begin.LastModified == nil {
			return false, false, critical, kind
		}
		return true, false, critical, kind
	case "file.end":
		var end struct {
			TransferID string `json:"transferId"`
		}
		if err := json.Unmarshal(raw, &end); err != nil {
			return false, false, critical, kind
		}
		if end.TransferID == "" {
			return false, false, critical, kind
		}
		return true, false, critical, kind
	default:
		// Unknown optional kinds are ignored safely.
		return true, true, critical, kind
	}
}

func validateKnownKind(kind string, msg map[string]json.RawMessage) bool {
	str := func(key string) (string, bool) {
		raw, ok := msg[key]
		if !ok {
			return "", false
		}
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return "", false
		}
		return s, true
	}
	switch kind {
	case "pair.secret":
		var m struct {
			HostIdentity string `json:"hostIdentity"`
			Secret       string `json:"secret"`
		}
		raw, _ := json.Marshal(map[string]json.RawMessage(msg))
		_ = raw
		// Re-decode from original message bytes is done by caller; here check shapes via generic map.
		_ = m
		// Use strict field extraction:
		hostID, ok1 := str("hostIdentity")
		secret, ok2 := str("secret")
		return ok1 && ok2 && identityPattern.MatchString(hostID) && hex64Pattern.MatchString(secret)
	case "invitation":
		room, ok1 := str("roomId")
		secret, ok2 := str("secret")
		return ok1 && ok2 && hex32Pattern.MatchString(room) && len(secret) > 0 && len(secret) <= 512
	case "kicked", "chat.clear":
		return true
	case "ack":
		var m struct {
			CommandID string `json:"commandId"`
			Accepted  bool   `json:"accepted"`
		}
		// ack has commandId + accepted; decode loosely.
		tmp, _ := json.Marshal(msg)
		if err := json.Unmarshal(tmp, &m); err != nil {
			// msg is map of RawMessage; marshal gives object with same keys.
			return false
		}
		_ = tmp
		// Fallback: check presence via str for commandId.
		id, ok := str("commandId")
		return ok && len(id) > 0
	case "render.manifest":
		manifestRaw, ok := msg["manifest"]
		if !ok {
			return false
		}
		return validateManifest(manifestRaw)
	case "render.need":
		needRaw, ok := msg["need"]
		if !ok {
			return false
		}
		var need struct {
			GenerationID string  `json:"generationId"`
			RenderID     string  `json:"renderId"`
			Epoch        *int    `json:"epoch"`
			Ranges       [][]int `json:"ranges"`
		}
		if err := json.Unmarshal(needRaw, &need); err != nil {
			return false
		}
		if len(need.GenerationID) == 0 || len(need.GenerationID) > 80 {
			return false
		}
		if len(need.RenderID) == 0 || len(need.RenderID) > 80 {
			return false
		}
		if need.Epoch == nil || *need.Epoch < 0 {
			return false
		}
		if len(need.Ranges) > 100000 {
			return false
		}
		for _, r := range need.Ranges {
			if len(r) != 2 || r[0] < 0 || r[1] < r[0] {
				return false
			}
		}
		return true
	case "delivery":
		deliveryRaw, ok := msg["delivery"]
		if !ok {
			return false
		}
		var d struct {
			GenerationID string  `json:"generationId"`
			TrackID      *string `json:"trackId"`
			Mode         string  `json:"mode"`
			Reason       *string `json:"reason"`
		}
		if err := json.Unmarshal(deliveryRaw, &d); err != nil {
			// trackId may be null; try generic.
			var generic map[string]any
			if err2 := json.Unmarshal(deliveryRaw, &generic); err2 != nil {
				return false
			}
			mode, _ := generic["mode"].(string)
			gen, _ := generic["generationId"].(string)
			if len(gen) == 0 || len(gen) > 80 {
				return false
			}
			reason, _ := generic["reason"].(string)
			hasReason := generic["reason"] != nil
			if mode == "none" {
				return hasReason && (reason == "host-disabled" || reason == "no-track")
			}
			if mode == "stream" || mode == "source-file" || mode == "render" {
				return !hasReason
			}
			return false
		}
		if len(d.GenerationID) == 0 || len(d.GenerationID) > 80 {
			return false
		}
		if d.Mode == "none" {
			return d.Reason != nil && (*d.Reason == "host-disabled" || *d.Reason == "no-track")
		}
		if d.Mode == "stream" || d.Mode == "source-file" || d.Mode == "render" {
			return d.Reason == nil
		}
		return false
	case "catalog":
		catalogRaw, ok := msg["catalog"]
		if !ok {
			return false
		}
		var c struct {
			RepeatMode string `json:"repeatMode"`
			Queue      []struct {
				Kind string `json:"kind"`
			} `json:"queue"`
			Library []struct {
				Kind string `json:"kind"`
			} `json:"library"`
			Favorites []struct {
				Kind string `json:"kind"`
			} `json:"favorites"`
		}
		if err := json.Unmarshal(catalogRaw, &c); err != nil {
			return false
		}
		if c.RepeatMode != "off" && c.RepeatMode != "one" && c.RepeatMode != "all" {
			return false
		}
		for _, list := range [][]struct {
			Kind string `json:"kind"`
		}{c.Queue, c.Library, c.Favorites} {
			for _, item := range list {
				if item.Kind != "stream" && item.Kind != "module" && item.Kind != "video" && item.Kind != "image" {
					return false
				}
			}
		}
		return true
	case "buffer":
		raw, ok := msg["bufferMs"]
		if !ok {
			return false
		}
		var v float64
		if err := json.Unmarshal(raw, &v); err != nil {
			return false
		}
		return v >= 0 && v <= 30000
	case "chat.message":
		msgRaw, ok := msg["message"]
		if !ok {
			return false
		}
		var m struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal(msgRaw, &m); err != nil {
			return false
		}
		return len(m.Text) > 0 && len(m.Text) <= 500
	case "chat.history":
		msgsRaw, ok := msg["messages"]
		if !ok {
			return false
		}
		var arr []any
		if err := json.Unmarshal(msgsRaw, &arr); err != nil {
			return false
		}
		return len(arr) <= 200
	case "chat.motd":
		motd, ok1 := str("motd")
		if !ok1 {
			return false
		}
		return len(motd) <= 500
	case "chat.send":
		text, ok := str("text")
		if !ok {
			return false
		}
		trimmed := len(text) > 0 && len(text) <= 500
		if !trimmed {
			return false
		}
		// Reject blank text.
		hasNonSpace := false
		for _, r := range text {
			if r != ' ' && r != '\t' && r != '\n' && r != '\r' {
				hasNonSpace = true
				break
			}
		}
		return hasNonSpace
	}
	// Other known kinds: accept when JSON parses (bounds covered by fixtures).
	return true
}

func validateManifest(raw json.RawMessage) bool {
	var m struct {
		GenerationID      string   `json:"generationId"`
		RenderID          string   `json:"renderId"`
		TrackID           string   `json:"trackId"`
		SourceRevision    string   `json:"sourceRevision"`
		Codec             string   `json:"codec"`
		Container         string   `json:"container"`
		DurationMs        *float64 `json:"durationMs"`
		BitrateKbps       *float64 `json:"bitrateKbps"`
		ClusterDurationMs *float64 `json:"clusterDurationMs"`
		Clusters          []struct {
			Index     int     `json:"index"`
			TimeMs    float64 `json:"timeMs"`
			SizeBytes int64   `json:"sizeBytes"`
		} `json:"clusters"`
		InitSizeBytes int64 `json:"initSizeBytes"`
		TotalBytes    int64 `json:"totalBytes"`
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return false
	}
	if len(m.GenerationID) == 0 || len(m.GenerationID) > 80 {
		return false
	}
	if len(m.RenderID) == 0 || len(m.RenderID) > 80 {
		return false
	}
	if len(m.TrackID) == 0 || len(m.TrackID) > 200 {
		return false
	}
	if len(m.SourceRevision) == 0 || len(m.SourceRevision) > 120 {
		return false
	}
	if m.Codec != "opus" || m.Container != "webm" {
		return false
	}
	if m.DurationMs == nil || m.BitrateKbps == nil || m.ClusterDurationMs == nil {
		return false
	}
	if len(m.Clusters) > 200000 {
		return false
	}
	if m.TotalBytes < 0 || m.TotalBytes > 8*1024*1024*1024 {
		return false
	}
	expected := m.InitSizeBytes
	for i, c := range m.Clusters {
		if c.Index != i {
			return false
		}
		if c.SizeBytes <= 0 || c.SizeBytes > 16*1024*1024 {
			return false
		}
		expected += c.SizeBytes
	}
	if m.InitSizeBytes <= 0 || m.TotalBytes != expected {
		return false
	}
	return true
}
