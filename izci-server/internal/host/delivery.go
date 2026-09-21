package host

// DeliveryBackend selects a delivery mode for a track. Phase 1 uses a fake;
// real source/render backends attach in later phases without changing the
// session engine.
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
