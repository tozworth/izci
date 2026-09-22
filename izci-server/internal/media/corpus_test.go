package media

import (
	"bytes"
	"context"
	"encoding/binary"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

// Corpus fixtures for Phase 3: standard media, every supported module
// family, subsongs, AHX/HVL, video soundtracks, corrupt inputs, and
// encoder crashes. Hand-crafted tracker modules are validated against
// system libopenmpt here; ffmpeg-generated fixtures cover the rest.
// Tests skip when their decoder is unavailable rather than failing.

func corpusCtx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 2*time.Minute)
}

func requireFFmpeg(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg unavailable")
	}
}

func requireOpenMPT(t *testing.T) {
	t.Helper()
	if OpenMPTVersion() == "" {
		t.Skip("system libopenmpt unavailable")
	}
}

// genTone renders a sine tone with ffmpeg lavfi into dir.
func genTone(t *testing.T, dir, name string, args ...string) string {
	t.Helper()
	requireFFmpeg(t)
	out := filepath.Join(dir, name)
	cmd := exec.Command("ffmpeg", append([]string{"-hide_banner", "-loglevel", "error", "-y"}, append(args, out)...)...)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("ffmpeg fixture %s: %v\n%s", name, err, out)
	}
	return out
}

func sineArgs(dur int) []string {
	return []string{"-f", "lavfi", "-i", "sine=frequency=440:duration=" + itoa(dur)}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [8]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

// minimalMOD builds a 1-pattern ProTracker module with one audible blip
// (C-3, sample 1, row 0) so tests can assert nonzero PCM.
func minimalMOD(blip bool) []byte {
	var b bytes.Buffer
	b.Write(bytes.Repeat([]byte{0}, 20)) // name
	for s := 0; s < 31; s++ {
		hdr := make([]byte, 30)
		if blip && s == 0 {
			copy(hdr[0:4], []byte("blip"))
			binary.BigEndian.PutUint16(hdr[22:24], 100) // length words
			hdr[24] = 0                                 // finetune
			hdr[25] = 64                                // volume
		}
		b.Write(hdr)
	}
	b.Write([]byte{1, 0})                 // songlen=1, restart
	b.Write(bytes.Repeat([]byte{0}, 128)) // orders
	b.WriteString("M.K.")                 // magic
	pattern := bytes.Repeat([]byte{0}, 64*4*4)
	if blip {
		// C-2 period 428 (0x1AC), sample 1, no effect.
		pattern[0], pattern[1], pattern[2], pattern[3] = 0x01, 0xAC, 0x10, 0x00
	}
	b.Write(pattern)
	if blip {
		data := make([]byte, 200)
		for i := range data {
			if i%2 == 0 {
				data[i] = 0x40
			}
		}
		b.Write(data)
	}
	return b.Bytes()
}

// minimalXM builds a 1-pattern silent FastTracker II module.
func minimalXM() []byte {
	var b bytes.Buffer
	b.WriteString("Extended Module: ")
	b.Write(bytes.Repeat([]byte("izci-test-xm"), 1)[:12])
	b.Write(bytes.Repeat([]byte{0}, 8))
	b.WriteByte(0x1A)
	b.Write(bytes.Repeat([]byte("izci-test"), 1)[:9])
	b.Write(bytes.Repeat([]byte{0}, 11))
	binary.Write(&b, binary.LittleEndian, uint16(0x0104))
	binary.Write(&b, binary.LittleEndian, uint32(274))
	binary.Write(&b, binary.LittleEndian, uint16(1)) // songlen
	binary.Write(&b, binary.LittleEndian, uint16(0)) // restart
	binary.Write(&b, binary.LittleEndian, uint16(2)) // channels
	binary.Write(&b, binary.LittleEndian, uint16(1)) // patterns
	binary.Write(&b, binary.LittleEndian, uint16(1)) // instruments
	binary.Write(&b, binary.LittleEndian, uint16(1)) // flags linear
	binary.Write(&b, binary.LittleEndian, uint16(6)) // tempo
	binary.Write(&b, binary.LittleEndian, uint16(125))
	b.Write(bytes.Repeat([]byte{0}, 256)) // orders
	binary.Write(&b, binary.LittleEndian, uint32(9))
	b.WriteByte(0)
	binary.Write(&b, binary.LittleEndian, uint16(64))
	binary.Write(&b, binary.LittleEndian, uint16(0)) // empty pattern
	binary.Write(&b, binary.LittleEndian, uint32(29))
	b.Write([]byte("empty"))
	b.Write(bytes.Repeat([]byte{0}, 17))
	b.WriteByte(0)
	binary.Write(&b, binary.LittleEndian, uint16(0)) // 0 samples
	return b.Bytes()
}

// minimalS3M builds a 4-order ScreamTracker module with empty patterns.
// Single-order S3M ends immediately under libopenmpt; four orders render
// a healthy duration.
func minimalS3M() []byte {
	var b bytes.Buffer
	b.Write(bytes.Repeat([]byte("izci-test-s3m"), 1)[:12])
	b.Write(bytes.Repeat([]byte{0}, 16))
	b.WriteByte(0x1A)
	b.WriteByte(0x10)
	b.Write(bytes.Repeat([]byte{0}, 2))
	binary.Write(&b, binary.LittleEndian, uint16(4)) // ordnum
	binary.Write(&b, binary.LittleEndian, uint16(0)) // insnum
	binary.Write(&b, binary.LittleEndian, uint16(1)) // patnum
	binary.Write(&b, binary.LittleEndian, uint16(0)) // flags
	binary.Write(&b, binary.LittleEndian, uint16(0x1300))
	binary.Write(&b, binary.LittleEndian, uint16(1)) // signed
	b.WriteString("SCRM")
	b.Write([]byte{64, 6, 125, 128, 8, 252})
	b.Write(bytes.Repeat([]byte{0}, 8))
	binary.Write(&b, binary.LittleEndian, uint32(0)) // special
	b.Write([]byte{0, 1})
	b.Write(bytes.Repeat([]byte{0xFF}, 30))
	b.Write([]byte{0, 0, 0, 0}) // 4 orders -> pattern 0
	for b.Len()%2 != 0 {
		b.WriteByte(0)
	}
	patOff := (b.Len() + 2 + 15) / 16 * 16
	binary.Write(&b, binary.LittleEndian, uint16(patOff/16))
	for b.Len() < patOff {
		b.WriteByte(0)
	}
	binary.Write(&b, binary.LittleEndian, uint16(126))
	b.Write(bytes.Repeat([]byte{0}, 126))
	return b.Bytes()
}

// minimalIT builds a 1-order Impulse Tracker module with an empty pattern.
func minimalIT() []byte {
	var b bytes.Buffer
	b.WriteString("IMPM")
	b.Write(bytes.Repeat([]byte("izci-test-it"), 1)[:12])
	b.Write(bytes.Repeat([]byte{0}, 14))
	b.Write(bytes.Repeat([]byte{0}, 2))
	binary.Write(&b, binary.LittleEndian, uint16(1)) // ordnum
	binary.Write(&b, binary.LittleEndian, uint16(0)) // insnum
	binary.Write(&b, binary.LittleEndian, uint16(0)) // smpnum
	binary.Write(&b, binary.LittleEndian, uint16(1)) // patnum
	binary.Write(&b, binary.LittleEndian, uint16(0x0214))
	binary.Write(&b, binary.LittleEndian, uint16(0x0200))
	binary.Write(&b, binary.LittleEndian, uint16(1)) // flags stereo
	binary.Write(&b, binary.LittleEndian, uint16(0)) // special
	b.Write([]byte{128, 100, 6, 125, 128, 0})
	binary.Write(&b, binary.LittleEndian, uint16(0)) // msglen
	binary.Write(&b, binary.LittleEndian, uint32(0)) // msgrow
	b.Write(bytes.Repeat([]byte{0}, 4))
	b.Write(bytes.Repeat([]byte{32}, 64)) // chnl_pan
	b.Write(bytes.Repeat([]byte{64}, 64)) // chnl_vol
	if b.Len() != 192 {
		panic("it header size")
	}
	b.Write([]byte{0}) // 1 order -> pattern 0
	patOff := 208
	binary.Write(&b, binary.LittleEndian, uint32(patOff))
	for b.Len() < patOff {
		b.WriteByte(0)
	}
	binary.Write(&b, binary.LittleEndian, uint16(64)) // length
	binary.Write(&b, binary.LittleEndian, uint16(64)) // rows
	b.Write(bytes.Repeat([]byte{0}, 64))              // empty rows
	return b.Bytes()
}

func writeFile(t *testing.T, dir, name string, data []byte) string {
	t.Helper()
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func hasNonZeroFloat32LE(pcm []byte) bool {
	for i := 0; i+4 <= len(pcm); i += 4 {
		if binary.LittleEndian.Uint32(pcm[i:]) != 0 {
			return true
		}
	}
	return false
}

func renderFile(t *testing.T, cache *Cache, deps Dependencies, path, kind, ext, rev string, subsong int) (Manifest, RenderKey) {
	t.Helper()
	ctx, cancel := corpusCtx()
	defer cancel()
	m, key, err := RenderTrack(ctx, FFmpegSettings{}, deps, cache, RenderRequest{
		TrackID: "track-" + ext, AbsPath: path, Kind: kind, Extension: ext,
		Subsong: subsong, SourceRevision: rev, BitrateKbps: 96,
	})
	if err != nil {
		t.Fatalf("render %s: %v", path, err)
	}
	// Wire manifests always carry a generation; the cached render binds
	// it per delivery, so validate the bound shape here.
	m.GenerationID = "test-gen"
	if err := m.Check(); err != nil {
		t.Fatalf("manifest check %s: %v", path, err)
	}
	return m, key
}
