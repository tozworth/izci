package media

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

type fakeChannel struct {
	mu       sync.Mutex
	texts    []string
	binaries [][]byte
	buffered uint64
	closed   bool
	failText bool
}

func (c *fakeChannel) SendText(t string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return context.Canceled
	}
	c.texts = append(c.texts, t)
	return nil
}
func (c *fakeChannel) SendBinary(b []byte) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return context.Canceled
	}
	c.binaries = append(c.binaries, append([]byte(nil), b...))
	return nil
}
func (c *fakeChannel) BufferedAmount() uint64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.buffered
}

func (c *fakeChannel) setBuffered(n uint64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.buffered = n
}

func writeSized(t *testing.T, path string, n int) {
	t.Helper()
	buf := make([]byte, n)
	for i := range buf {
		buf[i] = byte(i % 251)
	}
	if err := os.WriteFile(path, buf, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestTransferFraming(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "song.mp3")
	writeSized(t, p, 40*1024+123) // spans multiple 16KiB chunks
	fi, _ := os.Stat(p)
	ch := &fakeChannel{}
	facts := FileFacts{Size: fi.Size(), MtimeNs: fi.ModTime().UnixNano()}
	id, err := TransferFile(context.Background(), ch, p, facts, "track1", "gen1", "song.mp3", "audio/mpeg", fi.ModTime().UnixMilli())
	if err != nil {
		t.Fatal(err)
	}
	if id == "" {
		t.Fatalf("transferId empty")
	}
	if len(ch.texts) != 2 {
		t.Fatalf("texts = %d, want begin+end", len(ch.texts))
	}
	var begin map[string]any
	if err := json.Unmarshal([]byte(ch.texts[0]), &begin); err != nil {
		t.Fatal(err)
	}
	if begin["kind"] != "file.begin" || begin["transferId"] != id || begin["trackId"] != "track1" || begin["generationId"] != "gen1" {
		t.Fatalf("begin = %v", begin)
	}
	if size, ok := begin["size"].(float64); !ok || int64(size) != fi.Size() {
		t.Fatalf("begin size = %v, want %d", begin["size"], fi.Size())
	}
	var end map[string]any
	if err := json.Unmarshal([]byte(ch.texts[1]), &end); err != nil {
		t.Fatal(err)
	}
	if end["kind"] != "file.end" || end["transferId"] != id {
		t.Fatalf("end = %v", end)
	}
	total := 0
	for _, b := range ch.binaries {
		if len(b) > SourceChunkSize {
			t.Fatalf("chunk %d exceeds 16KiB", len(b))
		}
		total += len(b)
	}
	if int64(total) != fi.Size() {
		t.Fatalf("bytes = %d, want %d", total, fi.Size())
	}
}

func TestTransferNeverLoadsWholeFile(t *testing.T) {
	// 5MiB file must stream in 16KiB slices; success with a tiny heap
	// proves chunking (a whole-file buffer would still pass, but chunk
	// bounds above plus this size guard the contract).
	dir := t.TempDir()
	p := filepath.Join(dir, "big.flac")
	writeSized(t, p, 5*1024*1024)
	fi, _ := os.Stat(p)
	ch := &fakeChannel{}
	facts := FileFacts{Size: fi.Size(), MtimeNs: fi.ModTime().UnixNano()}
	if _, err := TransferFile(context.Background(), ch, p, facts, "t", "g", "big.flac", "audio/flac", 0); err != nil {
		t.Fatal(err)
	}
	for _, b := range ch.binaries {
		if len(b) > SourceChunkSize {
			t.Fatalf("chunk too large")
		}
	}
}

func TestTransferBackpressure(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "song.mp3")
	writeSized(t, p, 64*1024)
	fi, _ := os.Stat(p)
	ch := &fakeChannel{}
	ch.setBuffered(SourceFlushUnder + 1)
	facts := FileFacts{Size: fi.Size(), MtimeNs: fi.ModTime().UnixNano()}
	done := make(chan error, 1)
	go func() {
		_, err := TransferFile(context.Background(), ch, p, facts, "t", "g", "n", "audio/mpeg", 0)
		done <- err
	}()
	select {
	case <-done:
		t.Fatalf("transfer must wait while bufferedAmount is over water")
	case <-time.After(50 * time.Millisecond):
	}
	ch.setBuffered(0)
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("after drain: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatalf("transfer did not resume after drain")
	}
}

func TestTransferCancellation(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "song.mp3")
	writeSized(t, p, 1024*1024)
	fi, _ := os.Stat(p)
	ch := &fakeChannel{}
	ch.setBuffered(SourceFlushUnder + 1) // park the worker
	facts := FileFacts{Size: fi.Size(), MtimeNs: fi.ModTime().UnixNano()}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := TransferFile(ctx, ch, p, facts, "t", "g", "n", "audio/mpeg", 0)
		done <- err
	}()
	time.Sleep(30 * time.Millisecond)
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatalf("cancelled transfer must fail")
		}
	case <-time.After(5 * time.Second):
		t.Fatalf("cancelled transfer did not exit")
	}
}

func TestTransferReplacementCancels(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "song.mp3")
	writeSized(t, p, 256*1024)
	fi, _ := os.Stat(p)
	facts := FileFacts{Size: fi.Size(), MtimeNs: fi.ModTime().UnixNano()}
	// Slow channel so replacement lands mid-transfer.
	ch := &slowReplaceChannel{inner: &fakeChannel{}, t: t, path: p}
	_, err := TransferFile(context.Background(), ch, p, facts, "t", "g", "n", "audio/mpeg", 0)
	if _, ok := err.(*ErrReplaced); !ok {
		t.Fatalf("replacement must abort with ErrReplaced, got %v", err)
	}
}

func TestTransferRejectsStaleCatalogFacts(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "song.mp3")
	writeSized(t, p, 1024)
	fi, _ := os.Stat(p)
	facts := FileFacts{Size: fi.Size(), MtimeNs: fi.ModTime().UnixNano()}
	writeSized(t, p, 2048)
	_, err := TransferFile(context.Background(), &fakeChannel{}, p, facts, "t", "g", "n", "audio/mpeg", 0)
	if _, ok := err.(*ErrReplaced); !ok {
		t.Fatalf("stale catalog facts must abort with ErrReplaced, got %v", err)
	}
}

type slowReplaceChannel struct {
	inner *fakeChannel
	t     *testing.T
	path  string
	sent  int
}

func (c *slowReplaceChannel) SendText(s string) error { return c.inner.SendText(s) }
func (c *slowReplaceChannel) BufferedAmount() uint64  { return 0 }
func (c *slowReplaceChannel) SendBinary(b []byte) error {
	c.sent++
	if c.sent == 2 {
		// Replace the source mid-transfer: different size + mtime.
		time.Sleep(10 * time.Millisecond)
		if err := os.WriteFile(c.path, make([]byte, 300*1024), 0o644); err != nil {
			c.t.Fatal(err)
		}
	}
	return c.inner.SendBinary(b)
}
