package media

// Delivery policy:
//
//	no playable item or audio disabled -> none
//	source transfer enabled and file matches size policy -> source-file
//	otherwise, finite decodable input -> cached buffered WebM/Opus
//	render failure and explicitly permitted source fallback -> source-file
//
// "always transfer", "never transfer", and byte-size thresholds are all
// supported. The server never silently transfers when mode is "never":
// fallback after a render failure is permitted only when source transfer
// is enabled at all (always/threshold). A later policy may consider cache
// presence, client decoder capabilities, CPU pressure, or outbound
// bandwidth, but must not hide those heuristics in unrelated code.
const (
	ModeAlways    = "always"
	ModeNever     = "never"
	ModeThreshold = "threshold"
)

// Policy is the configured delivery policy.
type Policy struct {
	Mode     string
	MaxBytes int64
}

// ModeFor selects "source-file" or "none" for one track. Kind must be the
// canonical TrackKind ("stream", "module", "video", "image"); images are
// never playable. Size <=0 means unknown size: threshold mode treats it as
// transferable (content evidence decides), never mode still refuses.
// ModeFor answers the transfer question only; DeliveryFor answers the full
// policy including the render tier.
func (p Policy) ModeFor(kind string, size int64) string {
	if p.DeliveryFor(kind, "", size, false) == "source-file" {
		return "source-file"
	}
	return "none"
}

// DeliveryFor selects "source-file", "render", or "none" for one track.
// canRender reports whether the track's decoder family can render right
// now (system decoders present, built-in Hively always). Render failure
// fallback is decided by callers via AllowsTransfer: a failed render falls
// back to source-file only where source transfer is enabled at all.
func (p Policy) DeliveryFor(kind, extension string, size int64, canRender bool) string {
	switch kind {
	case "stream", "module", "video":
	default:
		return "none"
	}
	switch p.Mode {
	case ModeAlways:
		return "source-file"
	case ModeNever:
		if canRender {
			return "render"
		}
		return "none"
	case ModeThreshold:
		if size <= 0 {
			return "source-file"
		}
		if size <= p.MaxBytes {
			return "source-file"
		}
		if canRender {
			return "render"
		}
		return "none"
	default:
		return "none"
	}
}

// AllowsTransfer reports whether source transfer is enabled at all.
func (p Policy) AllowsTransfer() bool { return p.Mode == ModeAlways || p.Mode == ModeThreshold }
