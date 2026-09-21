package host

import (
	"github.com/dunsparce9/izci/izci-server/internal/media"
)

// DeliveryBackend selects a delivery mode for a track. Phase 1 uses a fake;
// Phase 2 attaches the policy backend backed by the real catalog; buffered
// Opus rendering lands in Phase 3 without changing the session engine.
type DeliveryBackend interface {
	ModeFor(trackID string) DeliveryMode
}

// FakeDelivery pretends every non-empty track is a source-file stub and
// empty IDs are undeliverable. It performs no I/O.
type FakeDelivery struct{}

// ModeFor implements DeliveryBackend.
func (FakeDelivery) ModeFor(trackID string) DeliveryMode {
	if trackID == "" {
		return DeliveryNone
	}
	return DeliverySourceFile
}

// NoneDelivery always reports none (audio disabled path).
type NoneDelivery struct{}

// ModeFor implements DeliveryBackend.
func (NoneDelivery) ModeFor(trackID string) DeliveryMode { return DeliveryNone }

// PolicyDelivery applies the configured source-transfer policy to catalog
// tracks: no playable item or audio disabled -> none; source transfer
// enabled and file matches size policy -> source-file; otherwise -> none
// (buffered rendering lands in Phase 3). Images are never playable.
type PolicyDelivery struct {
	Catalog *Catalog
	Policy  media.Policy
}

// ModeFor implements DeliveryBackend.
func (p PolicyDelivery) ModeFor(trackID string) DeliveryMode {
	if trackID == "" || p.Catalog == nil {
		return DeliveryNone
	}
	track, ok := p.Catalog.Get(trackID)
	if !ok {
		return DeliveryNone
	}
	switch p.Policy.ModeFor(track.Kind, track.Size) {
	case "source-file":
		return DeliverySourceFile
	default:
		return DeliveryNone
	}
}
