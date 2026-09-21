package host

import (
	"encoding/json"
	"sync"
)

// Channel labels and required properties per docs/izci-server-protocol.md.
const (
	ChannelControl = "izci-control"
	ChannelMedia   = "izci-media"
	ChannelRender  = "izci-render"
)

// DataChannel is the minimal send/close surface the host needs. Pion and
// fake test channels both implement it, so session ownership stays
// testable without a browser.
type DataChannel interface {
	Label() string
	SendText(text string) error
	Close() error
}

// PeerChannels bundles the three channels for one peer.
type PeerChannels struct {
	Control DataChannel
	Media   DataChannel
	Render  DataChannel
}

// FakeChannel is an in-memory DataChannel for deterministic tests.
type FakeChannel struct {
	label  string
	mu     sync.Mutex
	sent   []string
	closed bool
}

// NewFakeChannel builds a fake channel.
func NewFakeChannel(label string) *FakeChannel {
	return &FakeChannel{label: label}
}

// Label implements DataChannel.
func (c *FakeChannel) Label() string { return c.label }

// SendText implements DataChannel.
func (c *FakeChannel) SendText(text string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return errChannelClosed
	}
	c.sent = append(c.sent, text)
	return nil
}

// Close implements DataChannel.
func (c *FakeChannel) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = true
	return nil
}

// Sent returns a copy of sent frames.
func (c *FakeChannel) Sent() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]string(nil), c.sent...)
}

// Messages decodes sent frames as JSON maps.
func (c *FakeChannel) Messages() []map[string]any {
	var out []map[string]any
	for _, text := range c.Sent() {
		var m map[string]any
		if err := json.Unmarshal([]byte(text), &m); err == nil {
			out = append(out, m)
		}
	}
	return out
}

type channelClosed string

func (e channelClosed) Error() string { return string(e) }

var errChannelClosed = channelClosed("channel closed")

// ControlMessage helpers mirror the protocol JSON shapes without importing
// browser internals. The normative spec is docs/izci-server-protocol.md.

func marshal(v any) string {
	raw, _ := json.Marshal(v)
	return string(raw)
}

// HelloMessage builds a host hello with implementation identity separate
// from protocol identity.
func HelloMessage(product, productVersion, name string, major, minor int, capabilities []string, identity, pairNonce string) string {
	msg := map[string]any{
		"kind":          "hello",
		"protocolMajor": major,
		"protocolMinor": minor,
		"capabilities":  capabilities,
		"impl":          map[string]any{"product": product, "productVersion": productVersion},
		"name":          name,
	}
	if identity != "" {
		msg["identity"] = identity
	}
	if pairNonce != "" {
		msg["pairNonce"] = pairNonce
	}
	return marshal(msg)
}

// AckMessage builds a command acknowledgement. Unsupported commands nack.
func AckMessage(commandID string, accepted bool, message string) string {
	msg := map[string]any{"kind": "ack", "commandId": commandID, "accepted": accepted}
	if message != "" {
		msg["message"] = message
	}
	return marshal(msg)
}

// CatalogMessage builds a stub catalog (Phase 1: empty collections with
// revision and shuffle/repeat state; real library lands in Phase 2).
func CatalogMessage(revision int, shuffle bool, repeat RepeatMode) string {
	return marshal(map[string]any{
		"kind": "catalog",
		"catalog": map[string]any{
			"revision":       revision,
			"queue":          []any{},
			"library":        []any{},
			"favorites":      []any{},
			"shuffleEnabled": shuffle,
			"repeatMode":     string(repeat),
		},
	})
}

// StateMessage builds shuffle/repeat state.
func StateMessage(shuffle bool, repeat RepeatMode) string {
	return marshal(map[string]any{"kind": "state", "shuffleEnabled": shuffle, "repeatMode": string(repeat)})
}

// DeliveryMessage builds host-authoritative delivery state.
func DeliveryMessage(delivery Delivery) string {
	var trackID any
	if delivery.TrackID != nil {
		trackID = *delivery.TrackID
	}
	var reason any
	if delivery.Reason != nil {
		reason = *delivery.Reason
	}
	return marshal(map[string]any{
		"kind": "delivery",
		"delivery": map[string]any{
			"generationId": delivery.GenerationID,
			"trackId":      trackID,
			"mode":         string(delivery.Mode),
			"reason":       reason,
		},
	})
}

// PlaybackMessage builds a minimal playback snapshot (Phase 1 stub).
func PlaybackMessage(clock Clock, trackID *string, sentAt int64) string {
	var track any
	if trackID != nil {
		track = map[string]any{"id": *trackID, "name": *trackID, "extension": "mp3", "kind": "stream", "size": 0, "lastModified": 0}
	}
	return marshal(map[string]any{
		"kind": "playback",
		"playback": map[string]any{
			"generationId": clock.GenerationID,
			"snapshot": map[string]any{
				"state": string(clock.State), "currentTime": clock.PositionSeconds,
				"duration": clock.DurationSeconds, "volume": 1.0, "muted": false, "backend": nil,
			},
			"track":  track,
			"sentAt": sentAt,
		},
	})
}

// PrepareMessage announces a preparation barrier.
func PrepareMessage(prep Preparation) string {
	return marshal(map[string]any{
		"kind": "playback.prepare",
		"preparation": map[string]any{
			"generationId": prep.GenerationID, "trackId": prep.TrackID, "delivery": string(prep.Delivery),
		},
	})
}

// CancelMessage aborts a pending barrier.
func CancelMessage(generationID string) string {
	return marshal(map[string]any{"kind": "playback.cancel", "generationId": generationID})
}

// PingMessage starts clock sampling for synchronized starts.
func PingMessage(generationID string, hostSentAt int64) string {
	return marshal(map[string]any{"kind": "clock.ping", "generationId": generationID, "hostSentAt": hostSentAt})
}

// StartMessage emits a synchronized start.
func StartMessage(generationID, trackID string, positionSeconds float64, startAt int64) string {
	return marshal(map[string]any{
		"kind": "playback.start",
		"start": map[string]any{
			"generationId": generationID, "trackId": trackID,
			"positionSeconds": positionSeconds, "startAt": startAt,
		},
	})
}
