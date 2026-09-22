package media

import (
	"context"
	"testing"
	"time"
)

// TestHivelyLifecycle proves the embedded replayer boots, rejects garbage,
// and tears down cleanly across repeated instances. No hand-crafted AHX
// vectors exist; positive AHX/HVL coverage requires real song files, so
// this pins the harness contract the song path depends on.
func TestHivelyLifecycle(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if p := (HivelyProducer{}); p.Family() != DecoderHively {
		t.Fatalf("family=%q", p.Family())
	}
	if v := (HivelyProducer{}).Version(); v == "" {
		t.Fatal("hively version empty")
	}
	for i := 0; i < 3; i++ {
		h, err := newHivelyInstance(ctx)
		if err != nil {
			t.Fatalf("instance %d: %v", i, err)
		}
		// Garbage must not load.
		malloc := h.mod.ExportedFunction("malloc")
		res, err := malloc.Call(ctx, 64)
		if err != nil {
			h.close(ctx)
			t.Fatalf("malloc: %v", err)
		}
		ptr := res[0]
		h.memory.Write(uint32(ptr), []byte("this is not a hively song, just sixty-four bytes of text!!"))
		loaded, err := h.call(ctx, "ahx_load", ptr, 64, RenderSampleRate, RenderChannels)
		if _, ferr := h.call(ctx, "free", ptr); ferr != nil {
			h.close(ctx)
			t.Fatalf("free: %v", ferr)
		}
		if err != nil {
			h.close(ctx)
			t.Fatalf("ahx_load call: %v", err)
		}
		if loaded != 0 {
			h.close(ctx)
			t.Fatal("garbage loaded as a song")
		}
		h.close(ctx)
	}
}

// TestHivelyRouting proves AHX/HVL extensions route to the built-in
// replayer rather than FFmpeg or libopenmpt.
func TestHivelyRouting(t *testing.T) {
	for _, ext := range []string{"ahx", "hvl"} {
		fam, err := DecoderFor("module", ext)
		if err != nil {
			t.Fatalf("%s: %v", ext, err)
		}
		if fam != DecoderHively {
			t.Fatalf("%s routed to %q", ext, fam)
		}
	}
}
