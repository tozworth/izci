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
// testable without a browser. Media transfer needs binary frames plus
// backpressure visibility (bufferedAmount), mirroring the browser's
// SOURCE_FILE_QUEUE_LIMIT / RENDER_QUEUE_HIGH_WATER expectations.
type DataChannel interface {
	Label() string
	SendText(text string) error
	SendBinary(data []byte) error
	BufferedAmount() uint64
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
	label    string
	mu       sync.Mutex
	sent     []string
	binaries [][]byte
	// bufferedAmount is manually controlled for backpressure tests;
	// SendBinary/SendText do not auto-inflate it (the sender's queue
	// accounting lives in the transfer loop, like the browser peer).
	bufferedAmount uint64
	closed         bool
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

// SendBinary implements DataChannel: binary source/render fragments are
// stored separately so tests can assert framing without parsing text.
func (c *FakeChannel) SendBinary(data []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return errChannelClosed
	}
	cpy := append([]byte(nil), data...)
	c.binaries = append(c.binaries, cpy)
	return nil
}

// BufferedAmount implements DataChannel.
func (c *FakeChannel) BufferedAmount() uint64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.bufferedAmount
}

// SetBufferedAmount controls backpressure visibility in tests.
func (c *FakeChannel) SetBufferedAmount(n uint64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.bufferedAmount = n
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

// SentBinary returns a copy of binary frames.
func (c *FakeChannel) SentBinary() [][]byte {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([][]byte, len(c.binaries))
	for i, b := range c.binaries {
		out[i] = append([]byte(nil), b...)
	}
	return out
}

// BinaryBytes returns total binary payload bytes.
func (c *FakeChannel) BinaryBytes() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	n := 0
	for _, b := range c.binaries {
		n += len(b)
	}
	return n
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

func PairSecretMessage(hostIdentity, secret string) string {
	return marshal(map[string]any{"kind": "pair.secret", "hostIdentity": hostIdentity, "secret": secret})
}

func PairingMessage(paired, freeplay bool, hostID, name string) string {
	return marshal(map[string]any{"kind": "pairing", "paired": paired, "freeplayActive": freeplay, "hostId": hostID, "name": name})
}

func ChatMotdMessage(motd, hostName string) string {
	return marshal(map[string]any{"kind": "chat.motd", "motd": motd, "hostName": hostName})
}

func ChatMessage(message chatMessage) string {
	return marshal(map[string]any{"kind": "chat.message", "message": message})
}

func ChatHistoryMessage(messages []chatMessage) string {
	if messages == nil {
		messages = []chatMessage{}
	}
	return marshal(map[string]any{"kind": "chat.history", "messages": messages})
}

func ArtworkMessage(artwork any) string {
	return marshal(map[string]any{"kind": "artwork", "artwork": artwork})
}

// CatalogMessage builds a stub catalog (Phase 1: empty collections with
// revision and shuffle/repeat state; real library lands in Phase 2).
func CatalogMessage(revision int, shuffle bool, repeat RepeatMode) string {
	return CatalogMessageWithItems(revision, []map[string]any{}, []map[string]any{}, []map[string]any{}, shuffle, repeat)
}

// CatalogMessageWithItems builds a real catalog with queue/library/favorites
// TrackItems, revision, and shuffle/repeat state. Virtual paths only;
// filesystem paths never reach the wire. Item limits are applied by the
// caller (Catalog.Snapshot) before encoding.
func CatalogMessageWithItems(revision int, queue, lib, favs []map[string]any, shuffle bool, repeat RepeatMode) string {
	if queue == nil {
		queue = []map[string]any{}
	}
	if lib == nil {
		lib = []map[string]any{}
	}
	if favs == nil {
		favs = []map[string]any{}
	}
	return marshal(map[string]any{
		"kind": "catalog",
		"catalog": map[string]any{
			"revision":       revision,
			"queue":          queue,
			"library":        lib,
			"favorites":      favs,
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

// PlaybackMessage builds a playback snapshot for tests without a catalog item.
func PlaybackMessage(clock Clock, trackID *string, sentAt int64) string {
	var track any
	if trackID != nil {
		track = map[string]any{"id": *trackID, "name": *trackID, "extension": "mp3", "kind": "stream", "size": 0, "lastModified": 0}
	}
	return PlaybackMessageWithTrack(clock, trackAsMap(track), sentAt)
}

func trackAsMap(v any) map[string]any {
	if v == nil {
		return nil
	}
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return nil
}

// PlaybackMessageWithTrack builds a playback snapshot with a real TrackItem
// (or null when no track). The generationId ties the snapshot to its
// delivery generation.
func PlaybackMessageWithTrack(clock Clock, track map[string]any, sentAt int64) string {
	var trackAny any
	if track != nil {
		trackAny = track
	}
	position := clock.PositionSeconds
	if clock.State == StatePlaying && sentAt > clock.StartedAtMs {
		position += float64(sentAt-clock.StartedAtMs) / 1000
	}
	if clock.DurationSeconds > 0 && position > clock.DurationSeconds {
		position = clock.DurationSeconds
	}
	return marshal(map[string]any{
		"kind": "playback",
		"playback": map[string]any{
			"generationId": clock.GenerationID,
			"snapshot": map[string]any{
				"state": string(clock.State), "currentTime": position,
				"duration": clock.DurationSeconds, "volume": 1.0, "muted": false, "backend": nil,
			},
			"track":  trackAny,
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

// RenderManifestMessage emits a render.manifest binding a cached render to
// one delivery generation. The manifest's generationId is the delivery
// generation; renderId/trackId/sourceRevision describe the cached bytes.
func RenderManifestMessage(manifest map[string]any) string {
	return marshal(map[string]any{"kind": "render.manifest", "manifest": manifest})
}
