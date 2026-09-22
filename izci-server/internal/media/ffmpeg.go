package media

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Bounds for FFmpeg subprocesses. Probing is capped so a hostile file
// cannot stall a render worker; overall runtime is capped so an encoder
// crash or infinite input fails loudly instead of hanging a generation.
const (
	ffmpegProbeSize  = "8M"
	ffmpegProbeMs    = int64(15 * 1000 * 1000)
	ffmpegNicePrefix = ""
)

// FFmpegSettings tunes subprocess execution. Zero values select defaults.
type FFmpegSettings struct {
	// Binary is the ffmpeg executable. Empty means "ffmpeg" on PATH.
	Binary string
	// Timeout bounds one decode or encode process. Zero means DefaultTimeout.
	Timeout time.Duration
}

// DefaultFFmpegTimeout bounds a single render subprocess.
const DefaultFFmpegTimeout = 10 * time.Minute

func (s FFmpegSettings) binary() string {
	if s.Binary != "" {
		return s.Binary
	}
	return "ffmpeg"
}

func (s FFmpegSettings) timeout() time.Duration {
	if s.Timeout > 0 {
		return s.Timeout
	}
	return DefaultFFmpegTimeout
}

// scrubPath removes the absolute library path from captured diagnostics so
// errors can be logged without leaking filesystem layout. Callers must
// still never send raw diagnostics to clients.
func scrubPath(output, absPath, display string) string {
	if absPath != "" {
		output = strings.ReplaceAll(output, absPath, display)
	}
	return output
}

func truncateDiag(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…(truncated)"
}

// runFFmpeg executes one bounded FFmpeg process. Stderr is captured for
// server-side diagnostics (scrubbed); it never reaches the wire.
func runFFmpeg(ctx context.Context, settings FFmpegSettings, display string, stdin io.Reader, args ...string) (stdout []byte, diag string, err error) {
	bin := settings.binary()
	timeout := settings.timeout()
	cctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	cmd := exec.CommandContext(cctx, bin, args...)
	if stdin != nil {
		cmd.Stdin = stdin
	}
	var outBuf, errBuf bytes.Buffer
	// Encode outputs are small (minutes of Opus at bounded bitrate, under
	// a process timeout); decodes stream through a pipe instead.
	cmd.Stdout = &outBuf
	cmd.Stderr = &errBuf
	runErr := cmd.Run()
	diag = truncateDiag(scrubPath(errBuf.String(), args[len(args)-1], display), 4096)
	if cctx.Err() == context.DeadlineExceeded {
		return nil, diag, fmt.Errorf("media: ffmpeg timed out after %s (%s)", timeout, display)
	}
	if runErr != nil {
		return nil, diag, fmt.Errorf("media: ffmpeg failed (%s): %v", display, runErr)
	}
	return outBuf.Bytes(), diag, nil
}

// FFmpegProducer decodes ordinary audio and video soundtracks through
// system FFmpeg. It never decodes tracker modules: those go through
// system libopenmpt directly, and the server must not depend on FFmpeg
// having been built with libopenmpt.
type FFmpegProducer struct {
	Settings FFmpegSettings
}

func (p FFmpegProducer) Family() DecoderFamily { return DecoderFFmpeg }

func (p FFmpegProducer) Version() string { return Probe().FFmpegVersion }

// ProducePCM implements PCMProducer. Subsong is meaningless for streams
// and ignored.
func (p FFmpegProducer) ProducePCM(ctx context.Context, absPath string, _ int, w io.Writer) error {
	stream, done := DecodeToPCM(ctx, p.Settings, absPath, displayName(absPath))
	defer func() { _ = stream.Close() }()
	if _, err := io.Copy(w, stream); err != nil {
		return err
	}
	if err := <-done; err != nil {
		return err
	}
	return nil
}

// displayName keeps a short human identifier for diagnostics. Absolute
// paths never reach clients; see scrubPath.
func displayName(absPath string) string {
	return "…/" + filepath.Base(absPath)
}

// DecodeToPCM decodes ordinary audio (or a video soundtrack) to stereo
// 48 kHz float PCM on a stream. Video is discarded via audio-only mapping;
// inputs without an audio track fail instead of producing silence. The
// caller must close the returned stream; the decode stops when ctx ends.
func DecodeToPCM(ctx context.Context, settings FFmpegSettings, absPath, display string) (io.ReadCloser, <-chan error) {
	pr, pw := io.Pipe()
	done := make(chan error, 1)
	go func() {
		bin := settings.binary()
		cctx, cancel := context.WithTimeout(ctx, settings.timeout())
		defer cancel()
		defer func() { _ = pw.Close() }()
		cmd := exec.CommandContext(cctx, bin,
			"-hide_banner", "-nostdin",
			"-probesize", ffmpegProbeSize,
			"-analyzeduration", fmt.Sprintf("%d", ffmpegProbeMs),
			"-i", absPath,
			"-map", "0:a:0", "-vn",
			"-ac", "2", "-ar", fmt.Sprintf("%d", RenderSampleRate),
			"-c:a", "pcm_f32le", "-f", "f32le",
			"pipe:1",
		)
		var errBuf bytes.Buffer
		cmd.Stdout = pw
		cmd.Stderr = &errBuf
		runErr := cmd.Run()
		diag := truncateDiag(scrubPath(errBuf.String(), absPath, display), 2048)
		if cctx.Err() == context.DeadlineExceeded {
			done <- fmt.Errorf("media: decode timed out (%s)", display)
			return
		}
		if runErr != nil {
			done <- fmt.Errorf("media: decode failed (%s): %v | %s", display, runErr, diag)
			return
		}
		done <- nil
	}()
	return pr, done
}

// EncodeOpusWebM encodes a stereo 48 kHz float PCM stream to Opus in WebM
// with approximately one-second clusters, matching the browser host's
// buffered-render contract. PCM shorter than one frame (or empty) fails.
func EncodeOpusWebM(ctx context.Context, settings FFmpegSettings, pcm io.Reader, bitrateKbps int, display string) ([]byte, error) {
	if bitrateKbps < 16 {
		bitrateKbps = 16
	}
	if bitrateKbps > 512 {
		bitrateKbps = 512
	}
	webm, _, err := runFFmpeg(ctx, settings, display, pcm,
		"-hide_banner", "-nostdin",
		"-f", "f32le", "-ac", "2", "-ar", fmt.Sprintf("%d", RenderSampleRate),
		"-i", "pipe:0",
		"-map", "0:a:0",
		"-c:a", "libopus", "-b:a", fmt.Sprintf("%dk", bitrateKbps),
		"-cluster_time_limit", fmt.Sprintf("%d", RenderClusterMs),
		"-f", "webm", "pipe:1",
	)
	if err != nil {
		return nil, err
	}
	if len(webm) == 0 {
		return nil, fmt.Errorf("media: encoder produced no bytes (%s)", display)
	}
	return webm, nil
}
