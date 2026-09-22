package host

import (
	"sync"

	"github.com/dunsparce9/izci/izci-server/internal/media"
)

// DeliveryBackend selects a delivery mode for a track. Phase 1 uses a fake;
// Phase 2 attaches the policy backend backed by the real catalog; Phase 3
// adds the buffered-Opus render tier without changing the session engine.
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

// PolicyDelivery applies the configured delivery policy to catalog tracks:
//
//	no playable item or audio disabled -> none
//	source transfer enabled and file matches size policy -> source-file
//	otherwise, finite decodable input -> render (when the decoder family
//	can render right now)
//	render failure plus explicitly permitted source fallback -> source-file
//	via ForceSource; never mode never falls back.
//
// Images are never playable.
type PolicyDelivery struct {
	Catalog *Catalog
	Policy  media.Policy
	Deps    media.Dependencies
	// RenderAvailable gates the render tier: ModeFor selects render only
	// when a coordinator and cache are wired. Tests without a renderer
	// keep Phase 2 transfer-only behavior.
	RenderAvailable bool

	mu sync.Mutex
	// forceSource records the revision that failed, not merely the track
	// ID. A replacement at the same stable ID gets a fresh render attempt.
	forceSource map[string]string
}

// ModeFor implements DeliveryBackend.
func (p *PolicyDelivery) ModeFor(trackID string) DeliveryMode {
	if trackID == "" || p.Catalog == nil {
		return DeliveryNone
	}
	track, ok := p.Catalog.Get(trackID)
	if !ok {
		return DeliveryNone
	}
	p.mu.Lock()
	forcedRevision := p.forceSource[trackID]
	p.mu.Unlock()
	if forcedRevision == track.SourceRevision && p.Policy.AllowsTransfer() {
		return DeliverySourceFile
	}
	canRender := p.RenderAvailable && p.Deps.CanRender(track.Kind, track.Extension)
	switch p.Policy.DeliveryFor(track.Kind, track.Extension, track.Size, canRender) {
	case "source-file":
		return DeliverySourceFile
	case "render":
		return DeliveryRender
	default:
		return DeliveryNone
	}
}

// ForceSource pins one track to source-file delivery after a render
// failure, mirroring the browser host's render-fallback set. It only takes
// effect where source transfer is enabled at all; never mode never falls
// back, so a failed render there stays failed rather than silently
// transferring.
func (p *PolicyDelivery) ForceSource(trackID, sourceRevision string) {
	if trackID == "" || sourceRevision == "" {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.forceSource == nil {
		p.forceSource = map[string]string{}
	}
	p.forceSource[trackID] = sourceRevision
}
