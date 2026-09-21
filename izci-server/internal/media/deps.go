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
// Phase 2 never renders; Phase 3 requires FFmpeg Opus/WebM plus libopenmpt.
func (d Dependencies) RenderAvailable() bool {
	return d.FFmpegVersion != "" && d.FFmpegOpus && d.FFmpegWebM && d.LibopenmptVersion != ""
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
	// Preferred: pkg-config reports the dev package version.
	if out, err := exec.Command("pkg-config", "--modversion", "libopenmpt").Output(); err == nil {
		if v := strings.TrimSpace(string(out)); v != "" {
			return "libopenmpt " + v
		}
	}
	// Fallback: openmpt123 binary version.
	if out, err := exec.Command("openmpt123", "--version").Output(); err == nil {
		if v := strings.TrimSpace(string(out)); v != "" {
			first := strings.SplitN(v, "\n", 2)[0]
			return strings.TrimSpace(first)
		}
	}
	// Last resort: dynamic linker cache presence (no version).
	if out, err := exec.Command("ldconfig", "-p").Output(); err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			if strings.Contains(line, "libopenmpt") {
				return "libopenmpt (version unknown via ldconfig)"
			}
		}
	}
	return ""
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
		b.WriteString("buffered Opus rendering: unavailable (Phase 3); ")
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
