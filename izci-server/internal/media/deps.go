// Package media owns source transfer, native decoders, Opus renders, and
// the render cache. Phase 2 implements dependency probing, the delivery
// policy, and source-file transfer; buffered Opus rendering lands in Phase 3
// without changing the session engine.
package media

import (
	"bytes"
	"fmt"
	"os/exec"
	"strings"
)

// HivelyVersion is the built-in HivelyTracker replayer version. Rendering
// lands in Phase 3; Phase 2 reports the version so startup diagnostics can
// distinguish a missing system renderer from formats still serviceable
// through source transfer.
const HivelyVersion = "0.1.0"

// Dependencies reports system renderer availability separately from
// source-transfer serviceability.
type Dependencies struct {
	FFmpegVersion     string
	FFmpegOpus        bool
	FFmpegWebM        bool
	LibopenmptVersion string
	HivelyVersion     string
}

// RenderAvailable reports whether native buffered Opus rendering is possible.
// Full-pipeline availability needs FFmpeg Opus/WebM plus libopenmpt;
// per-family rendering (Hively is built in) is decided by CanRender.
func (d Dependencies) RenderAvailable() bool {
	return d.FFmpegVersion != "" && d.FFmpegOpus && d.FFmpegWebM && d.LibopenmptVersion != ""
}

// CanRender reports whether one track's decoder family can render right
// now. FFmpeg needs Opus/WebM support; libopenmpt needs a loadable system
// library; Hively is built into the server and always available.
func (d Dependencies) CanRender(kind, extension string) bool {
	family, err := DecoderFor(kind, extension)
	if err != nil {
		return false
	}
	// Every decoder feeds the system FFmpeg Opus/WebM encoder. The
	// built-in Hively decoder and a loadable libopenmpt are not sufficient
	// on their own when that common output stage is unavailable.
	if d.FFmpegVersion == "" || !d.FFmpegOpus || !d.FFmpegWebM {
		return false
	}
	switch family {
	case DecoderFFmpeg:
		return true
	case DecoderOpenMPT:
		return d.LibopenmptVersion != ""
	case DecoderHively:
		return true
	default:
		return false
	}
}

// SourceTransferServiceable lists families still playable via source-file
// transfer even when rendering is unavailable.
func (d Dependencies) SourceTransferServiceable() []string {
	return []string{"ordinary audio", "tracker modules", "Hively AHX/HVL", "video soundtracks (source)"}
}

// Probe checks system FFmpeg (decode + Opus/WebM encode support) and system
// libopenmpt separately, plus the built-in Hively version. It never fails:
// missing tools are reported as empty versions with RenderAvailable()==false.
func Probe() Dependencies {
	d := Dependencies{HivelyVersion: HivelyVersion}
	if out, err := exec.Command("ffmpeg", "-hide_banner", "-version").Output(); err == nil {
		first := strings.SplitN(string(out), "\n", 2)[0]
		d.FFmpegVersion = strings.TrimSpace(first)
		if enc, err := exec.Command("ffmpeg", "-hide_banner", "-encoders").Output(); err == nil {
			d.FFmpegOpus = bytes.Contains(enc, []byte("libopus")) || strings.Contains(string(enc), " opus ")
		}
		if mux, err := exec.Command("ffmpeg", "-hide_banner", "-muxers").Output(); err == nil {
			d.FFmpegWebM = strings.Contains(string(mux), "webm")
		}
	}
	d.LibopenmptVersion = probeLibopenmpt()
	return d
}

func probeLibopenmpt() string {
	// Load the library on the same path the decoder uses, so probing and
	// decoding never disagree. pkg-config/openmpt123/ldconfig evidence
	// without a loadable library would advertise renders that fail.
	return OpenMPTVersion()
}

// Describe renders one-line startup diagnostics that clearly distinguish a
// missing renderer from formats still serviceable through source transfer.
func (d Dependencies) Describe() string {
	var b strings.Builder
	if d.FFmpegVersion == "" {
		b.WriteString("ffmpeg: missing; ")
	} else {
		fmt.Fprintf(&b, "ffmpeg: %s opus=%v webm=%v; ", truncate(d.FFmpegVersion, 80), d.FFmpegOpus, d.FFmpegWebM)
	}
	if d.LibopenmptVersion == "" {
		b.WriteString("libopenmpt: missing; ")
	} else {
		fmt.Fprintf(&b, "libopenmpt: %s; ", truncate(d.LibopenmptVersion, 80))
	}
	fmt.Fprintf(&b, "hively: %s; ", d.HivelyVersion)
	if d.RenderAvailable() {
		b.WriteString("buffered Opus rendering: available; ")
	} else {
		b.WriteString("buffered Opus rendering: unavailable; ")
	}
	b.WriteString("source transfer serves: " + strings.Join(d.SourceTransferServiceable(), ", "))
	return b.String()
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}
