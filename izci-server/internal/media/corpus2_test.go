package media

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testCache(t *testing.T) *Cache {
	t.Helper()
	c, err := OpenCache(filepath.Join(t.TempDir(), "renders"), 64*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func testDeps(t *testing.T) Dependencies {
	t.Helper()
	d := Probe()
	if d.FFmpegVersion == "" || !d.FFmpegOpus || !d.FFmpegWebM {
		t.Skip("ffmpeg opus/webm unavailable")
	}
	return d
}

// TestCorpusStandardMedia renders ordinary audio in every supported
// container through the full pipeline: decode, Opus/WebM encode,
// init/cluster split, and manifest validation.
func TestCorpusStandardMedia(t *testing.T) {
	deps := testDeps(t)
	dir := t.TempDir()
	cases := []struct {
		name string
		ext  string
		gen  func() string
	}{
		{"tone.wav", "wav", func() string { return genTone(t, dir, "tone.wav", append(sineArgs(3), "-ar", "44100")...) }},
		{"tone.mp3", "mp3", func() string { return genTone(t, dir, "tone.mp3", append(sineArgs(3), "-codec:a", "libmp3lame")...) }},
		{"tone.flac", "flac", func() string { return genTone(t, dir, "tone.flac", sineArgs(3)...) }},
		{"tone.ogg", "ogg", func() string { return genTone(t, dir, "tone.ogg", append(sineArgs(3), "-codec:a", "libvorbis")...) }},
		{"tone.opus", "opus", func() string { return genTone(t, dir, "tone.opus", append(sineArgs(3), "-codec:a", "libopus")...) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := tc.gen()
			m, _ := renderFile(t, testCache(t), deps, path, "stream", tc.ext, "rev:"+tc.ext, 0)
			if m.DurationMs < 2000 || m.DurationMs > 5000 {
				t.Fatalf("durationMs=%v, want ~3000", m.DurationMs)
			}
			if len(m.Clusters) < 2 {
				t.Fatalf("want >=2 clusters, got %d", len(m.Clusters))
			}
			if m.BitrateKbps != 96 {
				t.Fatalf("bitrateKbps=%v, want 96", m.BitrateKbps)
			}
		})
	}
}

// TestCorpusVideoSoundtracks renders audio tracks from video containers;
// video streams are discarded, audio retained.
func TestCorpusVideoSoundtracks(t *testing.T) {
	deps := testDeps(t)
	dir := t.TempDir()
	cases := []struct {
		name string
		ext  string
		gen  func() string
	}{
		{"clip.mp4", "mp4", func() string {
			return genTone(t, dir, "clip.mp4",
				"-f", "lavfi", "-i", "testsrc=duration=3:size=64x64:rate=10",
				"-f", "lavfi", "-i", "sine=frequency=440:duration=3",
				"-shortest", "-pix_fmt", "yuv420p")
		}},
		{"clip.webm", "webm", func() string {
			return genTone(t, dir, "clip.webm",
				"-f", "lavfi", "-i", "testsrc=duration=3:size=64x64:rate=10",
				"-f", "lavfi", "-i", "sine=frequency=440:duration=3",
				"-shortest", "-codec:v", "libvpx", "-codec:a", "libopus")
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m, _ := renderFile(t, testCache(t), deps, tc.gen(), "video", tc.ext, "rev:"+tc.ext, 0)
			if m.DurationMs < 2000 || m.DurationMs > 5000 {
				t.Fatalf("durationMs=%v, want ~3000", m.DurationMs)
			}
			if len(m.Clusters) == 0 {
				t.Fatal("no clusters")
			}
		})
	}
}

// TestCorpusModules renders every hand-crafted tracker family through
// system libopenmpt with the canonical profile.
func TestCorpusModules(t *testing.T) {
	requireOpenMPT(t)
	deps := Probe()
	dir := t.TempDir()
	cases := []struct {
		ext  string
		kind string
		data []byte
	}{
		{"mod", "module", minimalMOD(true)},
		{"xm", "module", minimalXM()},
		{"s3m", "module", minimalS3M()},
		{"it", "module", minimalIT()},
	}
	for _, tc := range cases {
		t.Run("tone."+tc.ext, func(t *testing.T) {
			path := writeFile(t, dir, "tone."+tc.ext, tc.data)
			m, _ := renderFile(t, testCache(t), deps, path, tc.kind, tc.ext, "rev:"+tc.ext, 0)
			if len(m.Clusters) == 0 {
				t.Fatal("no clusters")
			}
			if m.DurationMs <= 0 {
				t.Fatal("no duration")
			}
		})
	}
}

// TestCorpusModuleBlip proves the tracker path renders notes, not just
// headers: the MOD blip fixture must produce nonzero PCM and a render.
func TestCorpusModuleBlip(t *testing.T) {
	requireOpenMPT(t)
	ctx, cancel := corpusCtx()
	defer cancel()
	var pcm bytes.Buffer
	if err := (OpenMPTProducer{}).ProducePCM(ctx, writeFile(t, t.TempDir(), "blip.mod", minimalMOD(true)), 0, &pcm); err != nil {
		t.Fatalf("produce: %v", err)
	}
	if !hasNonZeroFloat32LE(pcm.Bytes()) {
		t.Fatal("blip module rendered all silence")
	}
}

// TestCorpusSubsongs covers subsong selection: song 0 renders, and an
// out-of-range request clamps to song 0 instead of failing the render.
func TestCorpusSubsongs(t *testing.T) {
	requireOpenMPT(t)
	deps := Probe()
	dir := t.TempDir()
	path := writeFile(t, dir, "tone.mod", minimalMOD(true))
	cache := testCache(t)
	m0, _ := renderFile(t, cache, deps, path, "module", "mod", "rev:sub", 0)
	mFar, _ := renderFile(t, cache, deps, path, "module", "mod", "rev:sub", 99)
	if len(m0.Clusters) == 0 || len(mFar.Clusters) == 0 {
		t.Fatal("subsong render produced no clusters")
	}
}

// TestCorpusCorruptInputs proves undecodable inputs fail renders cleanly
// — errors, never panics, hangs, or partial cache entries. Best-effort
// inputs (truncated but decodable media) render short instead of failing;
// that case is covered by TestCorpusTruncatedRendersShort.
func TestCorpusCorruptInputs(t *testing.T) {
	deps := testDeps(t)
	dir := t.TempDir()
	// Video with no audio track: the audio-only mapping matches nothing.
	videoOnly := genTone(t, dir, "silent.mp4",
		"-f", "lavfi", "-i", "testsrc=duration=2:size=64x64:rate=10",
		"-pix_fmt", "yuv420p", "-an")
	type corruptCase struct {
		name string
		kind string
		ext  string
		data []byte // nil means use the generated file as-is
	}
	cases := []corruptCase{
		{"video-only.mp4", "video", "mp4", nil},
		{"random.mod", "module", "mod", bytes.Repeat([]byte{0x11, 0x22, 0x33, 0x44}, 4096)},
		{"random.ahx", "module", "ahx", bytes.Repeat([]byte{0x55, 0xAA}, 2048)},
		{"random.hvl", "module", "hvl", bytes.Repeat([]byte{0xA5, 0x5A}, 2048)},
		{"random.mo3", "module", "mo3", bytes.Repeat([]byte{0x77, 0x88, 0x99}, 2048)},
		{"empty.wav", "stream", "wav", []byte{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := videoOnly
			if tc.data != nil {
				path = writeFile(t, dir, tc.name, tc.data)
			}
			ctx, cancel := corpusCtx()
			defer cancel()
			_, _, err := RenderTrack(ctx, FFmpegSettings{}, deps, testCache(t), RenderRequest{
				TrackID: "track-corrupt", AbsPath: path, Kind: tc.kind, Extension: tc.ext,
				SourceRevision: "rev:corrupt", BitrateKbps: 96,
			})
			if err == nil {
				t.Fatalf("corrupt %s rendered without error", tc.name)
			}
			t.Logf("corrupt %s -> %v", tc.name, err)
		})
	}
}

// TestCorpusTruncatedRendersShort proves a truncated-but-decodable file
// renders best-effort (short output) rather than failing or hanging.
func TestCorpusTruncatedRendersShort(t *testing.T) {
	deps := testDeps(t)
	dir := t.TempDir()
	full := genTone(t, dir, "cut.mp3", append(sineArgs(6), "-codec:a", "libmp3lame")...)
	raw, err := os.ReadFile(full)
	if err != nil {
		t.Fatal(err)
	}
	path := writeFile(t, dir, "cut.mp3", raw[:len(raw)/3])
	m, _ := renderFile(t, testCache(t), deps, path, "stream", "mp3", "rev:cut", 0)
	if m.DurationMs <= 0 || m.DurationMs >= 6000 {
		t.Fatalf("truncated durationMs=%v, want short positive", m.DurationMs)
	}
	if len(m.Clusters) == 0 {
		t.Fatal("truncated render has no clusters")
	}
}

// TestCorpusMissingFile proves absent sources fail without leaking the
// absolute path in the error.
func TestCorpusMissingFile(t *testing.T) {
	deps := testDeps(t)
	ctx, cancel := corpusCtx()
	defer cancel()
	abs := filepath.Join(t.TempDir(), "nope.mp3")
	_, _, err := RenderTrack(ctx, FFmpegSettings{}, deps, testCache(t), RenderRequest{
		TrackID: "t", AbsPath: abs, Kind: "stream", Extension: "mp3",
		SourceRevision: "rev:x", BitrateKbps: 96,
	})
	if err == nil {
		t.Fatal("missing file rendered without error")
	}
	if strings.Contains(err.Error(), abs) {
		t.Fatalf("error leaks absolute path: %v", err)
	}
}

// TestEncoderCrash proves a dead encoder binary fails fast with a clean
// error instead of hanging the coordinator.
func TestEncoderCrash(t *testing.T) {
	dir := t.TempDir()
	path := genTone(t, dir, "tone.wav", append(sineArgs(2), "-ar", "44100")...)
	deps := Dependencies{FFmpegVersion: "test", FFmpegOpus: true, FFmpegWebM: true}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_, _, err := RenderTrack(ctx, FFmpegSettings{Binary: "/nonexistent/ffmpeg-izci-test"}, deps, testCache(t), RenderRequest{
		TrackID: "t", AbsPath: path, Kind: "stream", Extension: "wav",
		SourceRevision: "rev:x", BitrateKbps: 96,
	})
	if err == nil {
		t.Fatal("dead encoder binary succeeded")
	}
	t.Logf("encoder crash -> %v", err)
}

// TestHivelyGarbage proves the built-in replayer rejects non-Hively input
// through the full job path (no valid AHX/HVL vectors are craftable by
// hand; the harness lifecycle is covered in hively_test.go).
func TestHivelyGarbage(t *testing.T) {
	deps := Probe()
	dir := t.TempDir()
	for _, ext := range []string{"ahx", "hvl"} {
		path := writeFile(t, dir, "junk."+ext, bytes.Repeat([]byte{0x42}, 1024))
		ctx, cancel := corpusCtx()
		_, _, err := RenderTrack(ctx, FFmpegSettings{}, deps, testCache(t), RenderRequest{
			TrackID: "t", AbsPath: path, Kind: "module", Extension: ext,
			SourceRevision: "rev:x", BitrateKbps: 96,
		})
		cancel()
		if err == nil {
			t.Fatalf("garbage .%s decoded without error", ext)
		}
		if !strings.Contains(err.Error(), "HivelyTracker") {
			t.Fatalf("garbage .%s wrong error: %v", ext, err)
		}
	}
}

// TestDecoderRouting pins every family to its PCM source behind one
// interface; unknown kinds and images are never renderable.
func TestDecoderRouting(t *testing.T) {
	cases := []struct {
		kind, ext string
		want      DecoderFamily
		wantErr   bool
	}{
		{"stream", "mp3", DecoderFFmpeg, false},
		{"stream", "opus", DecoderFFmpeg, false},
		{"video", "mp4", DecoderFFmpeg, false},
		{"video", "mkv", DecoderFFmpeg, false},
		{"module", "mod", DecoderOpenMPT, false},
		{"module", "xm", DecoderOpenMPT, false},
		{"module", "s3m", DecoderOpenMPT, false},
		{"module", "it", DecoderOpenMPT, false},
		{"module", "mo3", DecoderOpenMPT, false},
		{"module", "ahx", DecoderHively, false},
		{"module", "hvl", DecoderHively, false},
		{"image", "jpg", DecoderUnknown, true},
		{"stream", "???", DecoderFFmpeg, false},
		{"bogus", "mp3", DecoderUnknown, true},
	}
	for _, tc := range cases {
		got, err := DecoderFor(tc.kind, tc.ext)
		if tc.wantErr != (err != nil) {
			t.Fatalf("DecoderFor(%q,%q) err=%v", tc.kind, tc.ext, err)
		}
		if !tc.wantErr && got != tc.want {
			t.Fatalf("DecoderFor(%q,%q)=%q want %q", tc.kind, tc.ext, got, tc.want)
		}
	}
}
