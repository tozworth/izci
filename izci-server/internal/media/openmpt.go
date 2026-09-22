package media

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"os"
	"runtime"
	"sync"

	"github.com/ebitengine/purego"
)

// Canonical izci-default module rendering profile (see render.go): 1-tap
// (no interpolation), default stereo separation, normal pitch and tempo,
// requested subsong, repeat count 0 (one finite pass) for cached output.
// Decoder controls stay out of Options during Phase 3.
const (
	openmptParamSeparation    = 2 // OPENMPT_MODULE_RENDER_STEREOSEPARATION_PERCENT
	openmptParamInterpolation = 3 // OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH
	openmptSeparationDefault  = 100
	openmptInterpolationIzci  = 1
	openmptRepeatOnce         = 0
	openmptChunkFrames        = 16384
	// maxModuleBytes bounds one module load. Real modules are kilobytes;
	// anything larger is refused rather than buffered.
	maxModuleBytes = 256 * 1024 * 1024
)

// ErrDecoderUnavailable reports that a system decoder is missing. Callers
// map it to render-unavailable (fallback policy decides source vs none),
// never to a client-visible path leak.
type ErrDecoderUnavailable struct{ Decoder DecoderFamily }

func (e *ErrDecoderUnavailable) Error() string {
	return fmt.Sprintf("media: system decoder unavailable (%s)", string(e.Decoder))
}

type openmptAPI struct {
	getString        func(string) string
	createFromMemory func(*byte, uintptr, uintptr, uintptr, uintptr, uintptr, *int32, **byte) uintptr
	destroy          func(uintptr)
	selectSubsong    func(uintptr, int32) int32
	numSubsongs      func(uintptr) int32
	setRepeatCount   func(uintptr, int32) int32
	setRenderParam   func(uintptr, int32, int32) int32
	getDuration      func(uintptr) float64
	readFloatStereo  func(uintptr, int32, uintptr, *float32, *float32) uintptr
	// libopenmpt 0.7.3 it reports "argument null pointer" even for valid
	// modules (verified against plain C). Profile application is checked
	// through the set_render_param return value instead.
}

var openmptOnce struct {
	sync.Once
	api     *openmptAPI
	version string
	err     error
}

func loadOpenMPT() (*openmptAPI, string, error) {
	openmptOnce.Once.Do(func() {
		for _, name := range []string{"libopenmpt.so.0", "libopenmpt.so"} {
			lib, err := purego.Dlopen(name, purego.RTLD_NOW|purego.RTLD_GLOBAL)
			if err != nil {
				continue
			}
			api := &openmptAPI{}
			purego.RegisterLibFunc(&api.getString, lib, "openmpt_get_string")
			purego.RegisterLibFunc(&api.createFromMemory, lib, "openmpt_module_create_from_memory")
			purego.RegisterLibFunc(&api.destroy, lib, "openmpt_module_destroy")
			purego.RegisterLibFunc(&api.selectSubsong, lib, "openmpt_module_select_subsong")
			purego.RegisterLibFunc(&api.numSubsongs, lib, "openmpt_module_get_num_subsongs")
			purego.RegisterLibFunc(&api.setRepeatCount, lib, "openmpt_module_set_repeat_count")
			purego.RegisterLibFunc(&api.setRenderParam, lib, "openmpt_module_set_render_param")
			purego.RegisterLibFunc(&api.getDuration, lib, "openmpt_module_get_duration_seconds")
			purego.RegisterLibFunc(&api.readFloatStereo, lib, "openmpt_module_read_float_stereo")
			version := api.getString("library_version")
			if version == "" {
				version = "libopenmpt (version unknown)"
			}
			openmptOnce.api = api
			openmptOnce.version = version
			return
		}
		openmptOnce.err = &ErrDecoderUnavailable{Decoder: DecoderOpenMPT}
	})
	return openmptOnce.api, openmptOnce.version, openmptOnce.err
}

// OpenMPTVersion reports the system libopenmpt version via dlopen, or ""
// when the library cannot be loaded. It shares the load path with the
// decoder so probing and decoding never disagree.
func OpenMPTVersion() string {
	_, version, err := loadOpenMPT()
	if err != nil {
		return ""
	}
	return version
}

// OpenMPTProducer renders tracker modules through system libopenmpt —
// never through FFmpeg's optional module support, which the server must
// not depend on.
type OpenMPTProducer struct{}

func (OpenMPTProducer) Family() DecoderFamily { return DecoderOpenMPT }

func (OpenMPTProducer) Version() string { return OpenMPTVersion() }

// ProducePCM renders one module to interleaved stereo 48 kHz float PCM.
// Subsong is clamped into the module's song list; out-of-range requests
// render subsong 0 rather than failing the generation.
func (OpenMPTProducer) ProducePCM(ctx context.Context, absPath string, subsong int, w io.Writer) error {
	api, _, err := loadOpenMPT()
	if err != nil {
		return err
	}
	data, err := readBounded(absPath, maxModuleBytes)
	if err != nil {
		return err
	}
	if len(data) == 0 {
		return fmt.Errorf("media: module is empty")
	}
	var code int32
	mod := api.createFromMemory(&data[0], uintptr(len(data)), 0, 0, 0, 0, &code, nil)
	runtime.KeepAlive(data)
	if mod == 0 {
		return fmt.Errorf("media: libopenmpt could not decode this module (code %d)", code)
	}
	defer api.destroy(mod)
	if n := api.numSubsongs(mod); n > 0 {
		s := subsong
		if s < 0 || int32(s) >= n {
			s = 0
		}
		api.selectSubsong(mod, int32(s))
	}
	api.setRepeatCount(mod, openmptRepeatOnce)
	// set_render_param returns 0 on rejection; get_render_param is
	// unusable on libopenmpt 0.7.3 (see the api struct note), so the set
	// return value is the whole profile check.
	if api.setRenderParam(mod, openmptParamSeparation, openmptSeparationDefault) == 0 {
		return fmt.Errorf("media: libopenmpt rejected the canonical render profile")
	}
	if api.setRenderParam(mod, openmptParamInterpolation, openmptInterpolationIzci) == 0 {
		return fmt.Errorf("media: libopenmpt rejected the canonical render profile")
	}
	left := make([]float32, openmptChunkFrames)
	right := make([]float32, openmptChunkFrames)
	interleaved := make([]byte, openmptChunkFrames*2*4)
	var frames int64
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		n := api.readFloatStereo(mod, RenderSampleRate, openmptChunkFrames, &left[0], &right[0])
		if n == 0 {
			break
		}
		for i := uintptr(0); i < n; i++ {
			binary.LittleEndian.PutUint32(interleaved[i*8:], math.Float32bits(left[i]))
			binary.LittleEndian.PutUint32(interleaved[i*8+4:], math.Float32bits(right[i]))
		}
		if _, err := w.Write(interleaved[:n*8]); err != nil {
			return err
		}
		frames += int64(n)
	}
	if frames == 0 {
		return fmt.Errorf("media: module produced no audio")
	}
	return nil
}

func readBounded(absPath string, max int64) ([]byte, error) {
	f, err := os.Open(absPath)
	if err != nil {
		return nil, fmt.Errorf("media: cannot open %s: %s", displayName(absPath), scrubPath(err.Error(), absPath, displayName(absPath)))
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return nil, fmt.Errorf("media: cannot inspect %s", displayName(absPath))
	}
	if fi.IsDir() {
		return nil, fmt.Errorf("media: not a file")
	}
	if fi.Size() > max {
		return nil, fmt.Errorf("media: file exceeds %d bytes", max)
	}
	data, err := io.ReadAll(io.LimitReader(f, max+1))
	if err != nil {
		return nil, fmt.Errorf("media: cannot read %s", displayName(absPath))
	}
	return data, nil
}
