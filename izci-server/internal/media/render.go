package media

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"math"
	"strings"
)

// Canonical buffered-Opus rendering profile. Matches the browser host's
// buffered-render contract: stereo 48 kHz Opus in WebM with approximately
// one-second clusters, video discarded. Module decoding uses izci defaults
// only (1-tap/no interpolation, default stereo separation, normal pitch and
// tempo, requested subsong, finite repeat count); decoder controls are
// intentionally not exposed in Options during Phase 3.
const (
	RenderSampleRate   = 48000
	RenderChannels     = 2
	RenderClusterMs    = 1000
	RenderProfileRev   = 1
	RenderCodec        = "opus"
	RenderContainer    = "webm"
	MaxRenderClusters  = 200000
	MaxRenderTotal     = 8 * 1024 * 1024 * 1024
	MaxClusterBytes    = 16 * 1024 * 1024
	MaxFragmentBytes   = 16 * 1024
	RenderQueueHigh    = 512 * 1024
	RenderQueueLow     = 128 * 1024
	InitClusterIndex   = 0xffffffff
	RenderFrameMarker  = 0x52
	RenderFrameHeadLen = 19
)

// DecoderFamily names the PCM source behind a render. It is part of the
// cache key so the same file rendered through different engines never
// collides.
type DecoderFamily string

const (
	DecoderFFmpeg  DecoderFamily = "ffmpeg"
	DecoderOpenMPT DecoderFamily = "libopenmpt"
	DecoderHively  DecoderFamily = "hively"
	DecoderUnknown DecoderFamily = "unknown"
)

// DecoderFor routes one track to its PCM source by kind and extension.
// Images are never renderable. Module extensions ahx/hvl decode through the
// built-in Hively replayer; every other module decodes through system
// libopenmpt; ordinary audio and video soundtracks decode through FFmpeg.
func DecoderFor(kind, extension string) (DecoderFamily, error) {
	ext := strings.ToLower(extension)
	switch kind {
	case "image":
		return DecoderUnknown, fmt.Errorf("media: images are not renderable")
	case "module":
		switch ext {
		case "ahx", "hvl":
			return DecoderHively, nil
		default:
			return DecoderOpenMPT, nil
		}
	case "stream", "video":
		return DecoderFFmpeg, nil
	default:
		return DecoderUnknown, fmt.Errorf("media: unknown kind %q", kind)
	}
}

// RenderKey identifies one cached rendition. Source revision, subsong,
// decoder family/version, rendering-profile revision, and bitrate are all
// key material; anything else (generation, renderId, trackId) is
// per-delivery metadata and must not affect the key.
type RenderKey struct {
	SourceRevision string
	Subsong        int
	DecoderFamily  DecoderFamily
	DecoderVersion string
	BitrateKbps    int
}

// String renders the canonical key. Empty decoder version means the decoder
// is unavailable; callers must refuse to render rather than cache under a
// versionless key.
func (k RenderKey) String() string {
	return strings.Join([]string{
		k.SourceRevision,
		fmt.Sprintf("subsong:%d", k.Subsong),
		string(k.DecoderFamily),
		k.DecoderVersion,
		fmt.Sprintf("profile:%d", RenderProfileRev),
		fmt.Sprintf("opus:%d", k.BitrateKbps),
		fmt.Sprintf("%dHzx%d", RenderSampleRate, RenderChannels),
	}, "|")
}

// DirName hashes the canonical key for filesystem use. Raw revisions may
// contain path separators; the hash never does.
func (k RenderKey) DirName() string {
	sum := sha256.Sum256([]byte(k.String()))
	return hex.EncodeToString(sum[:])
}

// PCMProducer renders one track to stereo 48 kHz float PCM. FFmpeg,
// libopenmpt, and Hively all sit behind this interface; the encoder only
// ever sees PCM. Version reports the decoder family version for cache
// keys; "" means the decoder is unavailable and production must fail with
// *ErrDecoderUnavailable rather than render.
type PCMProducer interface {
	Family() DecoderFamily
	Version() string
	ProducePCM(ctx context.Context, absPath string, subsong int, w io.Writer) error
}

// ManifestCluster is one entry of the wire manifest cluster table.
type ManifestCluster struct {
	Index     int     `json:"index"`
	TimeMs    float64 `json:"timeMs"`
	SizeBytes int64   `json:"sizeBytes"`
}

// Manifest is the wire render.manifest body (see
// docs/izci-server-protocol.md §4.4). GenerationID is bound per delivery;
// the cached render stores the manifest with an empty generation that the
// sender fills in.
type Manifest struct {
	GenerationID      string            `json:"generationId"`
	RenderID          string            `json:"renderId"`
	TrackID           string            `json:"trackId"`
	SourceRevision    string            `json:"sourceRevision"`
	Codec             string            `json:"codec"`
	Container         string            `json:"container"`
	DurationMs        float64           `json:"durationMs"`
	BitrateKbps       float64           `json:"bitrateKbps"`
	ClusterDurationMs float64           `json:"clusterDurationMs"`
	Clusters          []ManifestCluster `json:"clusters"`
	InitSizeBytes     int64             `json:"initSizeBytes"`
	TotalBytes        int64             `json:"totalBytes"`
}

// Check validates protocol bounds on a manifest the server is about to
// publish. It mirrors the shared fixtures (valid-* accepted, invalid-*
// rejected) without importing browser internals.
func (m Manifest) Check() error {
	if err := m.CheckUnbound(); err != nil {
		return err
	}
	if len(m.GenerationID) == 0 || len(m.GenerationID) > 80 {
		return fmt.Errorf("media: manifest generationId out of bounds")
	}
	return nil
}

// CheckUnbound validates everything except the per-delivery generation,
// for manifests fresh out of the render job (bound at send time).
func (m Manifest) CheckUnbound() error {
	if len(m.RenderID) == 0 || len(m.RenderID) > 80 {
		return fmt.Errorf("media: manifest renderId out of bounds")
	}
	if len(m.TrackID) == 0 || len(m.TrackID) > 200 {
		return fmt.Errorf("media: manifest trackId out of bounds")
	}
	if len(m.SourceRevision) == 0 || len(m.SourceRevision) > 120 {
		return fmt.Errorf("media: manifest sourceRevision out of bounds")
	}
	if m.Codec != RenderCodec || m.Container != RenderContainer {
		return fmt.Errorf("media: manifest must be opus/webm, got %s/%s", m.Codec, m.Container)
	}
	if !finiteNonnegative(m.DurationMs) || !finitePositive(m.BitrateKbps) || !finitePositive(m.ClusterDurationMs) {
		return fmt.Errorf("media: manifest has non-finite timing/bitrate")
	}
	if len(m.Clusters) == 0 || len(m.Clusters) > MaxRenderClusters {
		return fmt.Errorf("media: manifest has %d clusters", len(m.Clusters))
	}
	var total int64 = m.InitSizeBytes
	prev := -1.0
	for i, c := range m.Clusters {
		if c.Index != i {
			return fmt.Errorf("media: manifest cluster index %d != position %d", c.Index, i)
		}
		if !finiteNonnegative(c.TimeMs) || c.TimeMs < prev {
			return fmt.Errorf("media: manifest cluster timecodes decrease")
		}
		prev = c.TimeMs
		if c.SizeBytes <= 0 || c.SizeBytes > MaxClusterBytes {
			return fmt.Errorf("media: manifest cluster %d size out of bounds", i)
		}
		total += c.SizeBytes
	}
	if m.InitSizeBytes <= 0 {
		return fmt.Errorf("media: manifest init segment is empty")
	}
	if m.TotalBytes != total {
		return fmt.Errorf("media: manifest total %d != init+clusters %d", m.TotalBytes, total)
	}
	if m.TotalBytes > MaxRenderTotal {
		return fmt.Errorf("media: manifest total exceeds 8 GiB")
	}
	return nil
}

func finiteNonnegative(v float64) bool { return v >= 0 && !math.IsInf(v, 0) && !math.IsNaN(v) }
func finitePositive(v float64) bool    { return v > 0 && !math.IsInf(v, 0) && !math.IsNaN(v) }

// Cluster is one split WebM cluster with its byte payload.
type Cluster struct {
	Index   int
	TimeMs  float64
	Payload []byte
}

// Split is a WebM stream divided into init segment plus clusters.
type Split struct {
	Init        []byte
	Clusters    []Cluster
	DurationMs  float64
	ClusterMs   float64
	BitrateKbps int
}

// ManifestFor binds a split to one delivery generation and track.
func (s Split) ManifestFor(generationID, renderID, trackID, sourceRevision string) Manifest {
	clusters := make([]ManifestCluster, len(s.Clusters))
	var total int64
	for i, c := range s.Clusters {
		clusters[i] = ManifestCluster{Index: c.Index, TimeMs: c.TimeMs, SizeBytes: int64(len(c.Payload))}
		total += int64(len(c.Payload))
	}
	return Manifest{
		GenerationID:      generationID,
		RenderID:          renderID,
		TrackID:           trackID,
		SourceRevision:    sourceRevision,
		Codec:             RenderCodec,
		Container:         RenderContainer,
		DurationMs:        s.DurationMs,
		BitrateKbps:       float64(s.BitrateKbps),
		ClusterDurationMs: s.ClusterMs,
		Clusters:          clusters,
		InitSizeBytes:     int64(len(s.Init)),
		TotalBytes:        int64(len(s.Init)) + total,
	}
}
