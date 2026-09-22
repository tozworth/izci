package media

import (
	"context"
	_ "embed"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"sync"

	"github.com/tetratelabs/wazero"
	"github.com/tetratelabs/wazero/api"
	"github.com/tetratelabs/wazero/imports/wasi_snapshot_preview1"
)

//go:embed hively-replay.wasm
var hivelyWasm []byte

// The HivelyTracker replayer is built into the server because no suitable
// system package exists. This is the same replay core the browser uses
// (public/vendor/hively-replay.wasm, BSD 3-clause Pete Gordon — see
// hively-license.txt), executed in-process through wazero (pure Go, no
// cgo) behind the same PCM-source interface as FFmpeg and libopenmpt.
// HivelyVersion (the built-in replayer version, part of render-cache keys)
// lives in deps.go alongside the dependency probe.

const (
	hivelyFramesPerSecond = 50
	hivelyChunkFrames     = 16384
)

var hivelyRuntime struct {
	sync.Once
	runtime  wazero.Runtime
	compiled wazero.CompiledModule
	err      error
}

func loadHively(ctx context.Context) (wazero.Runtime, wazero.CompiledModule, error) {
	hivelyRuntime.Once.Do(func() {
		// Compilation is process-global. The first render's cancellation must
		// not permanently poison this sync.Once for every later request.
		initCtx := context.WithoutCancel(ctx)
		r := wazero.NewRuntime(initCtx)
		if _, err := wasi_snapshot_preview1.Instantiate(initCtx, r); err != nil {
			hivelyRuntime.err = err
			return
		}
		if _, err := r.NewHostModuleBuilder("env").
			NewFunctionBuilder().
			WithFunc(func(_ uint32) {}).
			Export("emscripten_notify_memory_growth").
			Instantiate(initCtx); err != nil {
			hivelyRuntime.err = err
			_ = r.Close(initCtx)
			return
		}
		compiled, err := r.CompileModule(initCtx, hivelyWasm)
		if err != nil {
			hivelyRuntime.err = err
			_ = r.Close(initCtx)
			return
		}
		hivelyRuntime.runtime = r
		hivelyRuntime.compiled = compiled
	})
	return hivelyRuntime.runtime, hivelyRuntime.compiled, hivelyRuntime.err
}

// hivelyInstance is one song render. Instances are single-use and
// single-goroutine, mirroring the browser worklet lifecycle
// (init → load → decode frames → unload).
type hivelyInstance struct {
	mod    api.Module
	memory api.Memory
	malloc api.Function
	free   api.Function
}

func (h hivelyInstance) call(ctx context.Context, name string, params ...uint64) (uint64, error) {
	fn := h.mod.ExportedFunction(name)
	if fn == nil {
		return 0, fmt.Errorf("media: hively missing export %s", name)
	}
	res, err := fn.Call(ctx, params...)
	if err != nil {
		return 0, fmt.Errorf("media: hively %s: %w", name, err)
	}
	if len(res) == 0 {
		return 0, nil
	}
	return res[0], nil
}

func newHivelyInstance(ctx context.Context) (*hivelyInstance, error) {
	r, compiled, err := loadHively(ctx)
	if err != nil {
		return nil, err
	}
	mod, err := r.InstantiateModule(ctx, compiled, wazero.NewModuleConfig())
	if err != nil {
		return nil, fmt.Errorf("media: hively instantiate: %w", err)
	}
	h := &hivelyInstance{mod: mod, memory: mod.Memory()}
	if h.memory == nil {
		_ = mod.Close(ctx)
		return nil, fmt.Errorf("media: hively has no memory")
	}
	for _, name := range []string{"malloc", "free"} {
		fn := mod.ExportedFunction(name)
		if fn == nil {
			_ = mod.Close(ctx)
			return nil, fmt.Errorf("media: hively missing export %s", name)
		}
		if name == "malloc" {
			h.malloc = fn
		} else {
			h.free = fn
		}
	}
	if _, err := h.call(ctx, "_initialize"); err != nil {
		_ = mod.Close(ctx)
		return nil, err
	}
	if _, err := h.call(ctx, "ahx_init"); err != nil {
		_ = mod.Close(ctx)
		return nil, err
	}
	return h, nil
}

func (h *hivelyInstance) close(ctx context.Context) {
	closeCtx := context.WithoutCancel(ctx)
	_, _ = h.call(closeCtx, "ahx_unload")
	_ = h.mod.Close(closeCtx)
}

// HivelyProducer renders AHX/HVL through the built-in replayer.
type HivelyProducer struct{}

func (HivelyProducer) Family() DecoderFamily { return DecoderHively }

func (HivelyProducer) Version() string { return HivelyVersion }

// ProducePCM renders one Hively song to interleaved stereo 48 kHz float
// PCM: one finite pass (repeat off), requested subsong clamped like the
// browser worklet (out-of-range renders subsong 0).
func (HivelyProducer) ProducePCM(ctx context.Context, absPath string, subsong int, w io.Writer) error {
	data, err := readBounded(absPath, maxModuleBytes)
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return fmt.Errorf("media: hively module is empty")
	}
	h, err := newHivelyInstance(ctx)
	if err != nil {
		return err
	}
	defer h.close(ctx)
	input, err := h.call(ctx, "malloc", uint64(len(data)))
	if err != nil {
		return err
	}
	if input > uint64(^uint32(0)) {
		_, _ = h.call(ctx, "free", input)
		return fmt.Errorf("media: hively allocation out of range")
	}
	if !h.memory.Write(uint32(input), data) {
		_, _ = h.call(ctx, "free", input)
		return fmt.Errorf("media: hively memory write failed")
	}
	loaded, err := h.call(ctx, "ahx_load", input, uint64(len(data)), RenderSampleRate, RenderChannels)
	_, _ = h.call(ctx, "free", input)
	if err != nil {
		return err
	}
	if loaded == 0 {
		return fmt.Errorf("media: HivelyTracker could not decode this module")
	}
	if _, err := h.call(ctx, "ahx_set_interpolation", 1); err != nil {
		return err
	}
	if subsong > 0 {
		if ok, err := h.call(ctx, "ahx_select_subsong", uint64(subsong)); err != nil || ok == 0 {
			subsong = 0
		}
	}
	left := make([]float32, hivelyChunkFrames)
	right := make([]float32, hivelyChunkFrames)
	frames := 0
	chunked := make([]byte, hivelyChunkFrames*2*4)
	chunkFrames := 0
	flush := func() error {
		if chunkFrames == 0 {
			return nil
		}
		for i := 0; i < chunkFrames; i++ {
			binary.LittleEndian.PutUint32(chunked[i*8:], math.Float32bits(left[i]))
			binary.LittleEndian.PutUint32(chunked[i*8+4:], math.Float32bits(right[i]))
		}
		if _, err := w.Write(chunked[:chunkFrames*8]); err != nil {
			return err
		}
		frames += chunkFrames
		chunkFrames = 0
		return nil
	}
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		more, err := h.call(ctx, "ahx_decode_frame")
		if err != nil {
			return err
		}
		if more == 0 {
			break
		}
		nSamples, err := h.call(ctx, "ahx_frame_samples")
		if err != nil {
			return err
		}
		mixPtr, err := h.call(ctx, "ahx_mix_buffer")
		if err != nil {
			return err
		}
		if nSamples == 0 || nSamples > hivelyChunkFrames || mixPtr > uint64(^uint32(0)) {
			return fmt.Errorf("media: hively returned invalid frame bounds")
		}
		n := int(nSamples)
		raw, ok := h.memory.Read(uint32(mixPtr), uint32(n*2*2))
		if !ok {
			return fmt.Errorf("media: hively mix buffer out of range")
		}
		for i := 0; i < n; i++ {
			left[chunkFrames] = float32(int16(binary.LittleEndian.Uint16(raw[i*4:]))) / 32768
			right[chunkFrames] = float32(int16(binary.LittleEndian.Uint16(raw[i*4+2:]))) / 32768
			chunkFrames++
			if chunkFrames == hivelyChunkFrames {
				if err := flush(); err != nil {
					return err
				}
			}
		}
		if ended, err := h.call(ctx, "ahx_ended"); err != nil {
			return err
		} else if ended != 0 {
			break
		}
	}
	if err := flush(); err != nil {
		return err
	}
	if frames == 0 {
		return fmt.Errorf("media: hively module produced no audio")
	}
	return nil
}
