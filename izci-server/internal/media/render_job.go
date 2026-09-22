package media

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"time"
)

// RenderRequest describes one rendition: the catalog track plus the
// delivery parameters. Absolute paths stay server-side; only the key,
// manifest, and bytes cross module boundaries.
type RenderRequest struct {
	TrackID        string
	AbsPath        string
	Kind           string
	Extension      string
	Subsong        int
	SourceRevision string
	BitrateKbps    int
}

// decoderVersion resolves the cache-key decoder version from probed
// dependencies. Empty means the decoder is unavailable: callers must fail
// with *ErrDecoderUnavailable rather than render or cache.
func decoderVersion(deps Dependencies, family DecoderFamily) string {
	// FFmpeg is the common Opus/WebM encoder for every PCM producer, not
	// merely the decoder for ordinary media.
	if deps.FFmpegVersion == "" || !deps.FFmpegOpus || !deps.FFmpegWebM {
		return ""
	}
	switch family {
	case DecoderFFmpeg:
		return truncate(deps.FFmpegVersion, 128)
	case DecoderOpenMPT:
		if deps.LibopenmptVersion == "" {
			return ""
		}
		return truncate(deps.LibopenmptVersion+"; encoder "+deps.FFmpegVersion, 256)
	case DecoderHively:
		return truncate("hively "+HivelyVersion+"; encoder "+deps.FFmpegVersion, 256)
	default:
		return ""
	}
}

func newRenderID() string {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return fmt.Sprintf("render-%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(raw[:])
}

// DefaultRenderBitrateKbps matches the browser host's default Opus bitrate.
const DefaultRenderBitrateKbps = 128

func normalizeRenderBitrate(bitrate int) int {
	if bitrate <= 0 {
		return DefaultRenderBitrateKbps
	}
	if bitrate < 16 {
		return 16
	}
	if bitrate > 512 {
		return 512
	}
	return bitrate
}

// RenderTrack renders one track to a cached Opus/WebM entry: decode PCM
// through the family's producer, encode through FFmpeg, split into init
// plus ~1s clusters, validate the manifest, and publish atomically. Cache
// hits return the stored manifest without touching a decoder. The returned
// manifest carries an empty generation; senders bind it per delivery.
func RenderTrack(ctx context.Context, ffmpeg FFmpegSettings, deps Dependencies, cache *Cache, req RenderRequest) (Manifest, RenderKey, error) {
	var empty Manifest
	if cache == nil {
		return empty, RenderKey{}, fmt.Errorf("media: render cache is required")
	}
	if req.TrackID == "" || req.SourceRevision == "" || req.AbsPath == "" {
		return empty, RenderKey{}, fmt.Errorf("media: incomplete render request")
	}
	family, err := DecoderFor(req.Kind, req.Extension)
	if err != nil {
		return empty, RenderKey{}, err
	}
	version := decoderVersion(deps, family)
	if version == "" {
		return empty, RenderKey{}, &ErrDecoderUnavailable{Decoder: family}
	}
	bitrate := normalizeRenderBitrate(req.BitrateKbps)
	key := RenderKey{
		SourceRevision: req.SourceRevision,
		Subsong:        req.Subsong,
		DecoderFamily:  family,
		DecoderVersion: version,
		BitrateKbps:    bitrate,
	}
	if _, ok := cache.Lookup(key); ok {
		stored, err := cache.StoredManifest(key.String())
		if err != nil {
			return empty, RenderKey{}, err
		}
		return stored, key, nil
	}
	var producer PCMProducer
	switch family {
	case DecoderFFmpeg:
		producer = FFmpegProducer{Settings: ffmpeg}
	case DecoderOpenMPT:
		producer = OpenMPTProducer{}
	case DecoderHively:
		producer = HivelyProducer{}
	default:
		return empty, RenderKey{}, &ErrDecoderUnavailable{Decoder: family}
	}
	renderCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	pr, pw := io.Pipe()
	prodErr := make(chan error, 1)
	go func() {
		err := producer.ProducePCM(renderCtx, req.AbsPath, req.Subsong, pw)
		_ = pw.CloseWithError(err)
		prodErr <- err
	}()
	webm, encErr := EncodeOpusWebM(renderCtx, ffmpeg, pr, bitrate, displayName(req.AbsPath))
	if encErr != nil {
		// An encoder that exits before consuming stdin otherwise leaves a
		// native producer blocked forever in Write while this goroutine waits
		// for prodErr.
		cancel()
		_ = pr.CloseWithError(encErr)
	}
	pErr := <-prodErr
	if pErr != nil {
		return empty, RenderKey{}, pErr
	}
	if encErr != nil {
		return empty, RenderKey{}, encErr
	}
	split, err := SplitWebM(webm, bitrate)
	if err != nil {
		return empty, RenderKey{}, err
	}
	payloads := make([][]byte, len(split.Clusters))
	for i, c := range split.Clusters {
		payloads[i] = c.Payload
	}
	manifest := split.ManifestFor("", newRenderID(), req.TrackID, req.SourceRevision)
	if err := manifest.CheckUnbound(); err != nil {
		return empty, RenderKey{}, err
	}
	if err := cache.Publish(key, manifest, split.Init, payloads); err != nil {
		return empty, RenderKey{}, err
	}
	// Another process using the same cache directory may have won the
	// atomic rename with an equivalent rendition carrying a different
	// render ID or cluster layout. Return the manifest that actually owns
	// the published bytes, never the discarded staging manifest.
	stored, err := cache.StoredManifest(key.String())
	if err != nil {
		return empty, RenderKey{}, err
	}
	return stored, key, nil
}
