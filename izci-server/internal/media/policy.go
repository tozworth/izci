package media

// Delivery policy for Phase 2:
//
//	no playable item or audio disabled -> none
//	source transfer enabled and file matches size policy -> source-file
//	otherwise (finite decodable input without a renderer yet) -> none
//
// "always transfer", "never transfer", and byte-size thresholds are all
// supported. The server never silently transfers when mode is "never".
// Render fallback and richer heuristics land in Phase 3; this file must not
// hide those heuristics in unrelated code.
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
func (p Policy) ModeFor(kind string, size int64) string {
	switch kind {
	case "stream", "module", "video":
	default:
		return "none"
	}
	switch p.Mode {
	case ModeAlways:
		return "source-file"
	case ModeNever:
		return "none"
	case ModeThreshold:
		if size <= 0 {
			return "source-file"
		}
		if size <= p.MaxBytes {
			return "source-file"
		}
		return "none"
	default:
		return "none"
	}
}

// AllowsTransfer reports whether source transfer is enabled at all.
func (p Policy) AllowsTransfer() bool { return p.Mode == ModeAlways || p.Mode == ModeThreshold }
