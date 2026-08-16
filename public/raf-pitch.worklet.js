// Realtime phase-vocoder pitch shifter for the Raf rack.
//
// Frequency-domain pitch shifting via per-bin phase tracking and
// peak-grouped oscillator resynthesis. Each analysis frame is windowed and
// FFT'd; every bin's per-hop phase advance is unwrapped to recover its true
// frequency. Spectral peaks are then resynthesized as oscillators running at
// the pitch-scaled true frequency, so the output is phase-coherent by
// construction: the artifact profile is transient "phasiness" at large shifts
// instead of the hop-rate "chorus" of the granular engine.
//
// The synthesis is an oscillator bank rather than an ISTFT because a plain
// bin-grid ISTFT cannot represent shifts larger than about half a bin per
// hop (the accumulated phase folds at the hop rate); grouping each peak's
// bins into a single oscillator keeps the per-frame cost proportional to the
// number of spectral peaks instead of the number of bins.
//
// - Window: Hann, default N = 2048 (~43 ms @ 48 kHz), hop R = N / 4 (75%
//   overlap). The synthesis frames are constant-amplitude oscillators, so the
//   OLA sum of the Hann synthesis window is 2 and the output scale is 1 / N.
// - The window size is a k-rate parameter (1024 / 2048 / 4096): smaller
//   windows lower the latency (~21 / 43 / 85 ms) at the cost of frequency
//   resolution.
// - Peaks below `peakFloorDb` relative to the frame peak are dropped, and at
//   most `maxPeaks` peaks are resynthesized, bounding the oscillator cost.

const MIN_FACTOR = 0.5;
const MAX_FACTOR = 2;
const MIN_WINDOW_SIZE = 1024;
const MAX_WINDOW_SIZE = 4096;

class RafPitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitch', defaultValue: 1, minValue: MIN_FACTOR, maxValue: MAX_FACTOR, automationRate: 'k-rate' },
      { name: 'windowSize', defaultValue: 2048, minValue: MIN_WINDOW_SIZE, maxValue: MAX_WINDOW_SIZE, automationRate: 'k-rate' },
      { name: 'maxPeaks', defaultValue: 64, minValue: 16, maxValue: 128, automationRate: 'k-rate' },
      { name: 'peakFloorDb', defaultValue: -60, minValue: -80, maxValue: -40, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.config = this.createConfig(2048);
    this.maxPeaks = 64;
    this.peakFloor = 1e-3; // -60 dB
    this.channels = [];
    this.frameIndex = 0; // absolute position of the next input sample
    this.nextFrame = 0; // next analysis frame whose window is being filled
    this.phaseInitialized = false;
  }

  createConfig(size) {
    const hop = size / 4; // 75% overlap
    const half = size / 2;
    const ringLength = size * 2; // power of two for masking
    const window = new Float32Array(size);
    for (let index = 0; index < size; index += 1) {
      window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / size);
    }
    const expected = new Float32Array(half + 1);
    for (let bin = 0; bin <= half; bin += 1) {
      expected[bin] = (2 * Math.PI * bin * hop) / size;
    }
    return { size, hop, half, ringLength, ringMask: ringLength - 1, window, expected };
  }

  applyConfig(size) {
    if (size === this.config.size) return;
    this.config = this.createConfig(size);
    this.phaseInitialized = false;
    for (const channel of this.channels) {
      const { size: fftSize, half, ringLength } = this.config;
      channel.input = new Float32Array(ringLength);
      channel.re = new Float32Array(fftSize);
      channel.im = new Float32Array(fftSize);
      channel.lastPhase = new Float64Array(half + 1);
      channel.unwrapped = new Float64Array(half + 1);
      channel.phase0 = new Float64Array(half + 1);
      channel.mags = new Float32Array(half + 1);
      channel.trueFreq = new Float64Array(half + 1);
      channel.regionMag = new Float64Array(half + 1);
      channel.accum = new Float32Array(ringLength);
      channel.oscillators.length = 0;
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const frameCount = output[0]?.length ?? 0;
    if (frameCount === 0) return true;

    // Configurable knobs: window size (power of two in [1024, 4096]),
    // oscillator cap and peak floor, plus the pitch factor.
    const sizeParam = parameters.windowSize?.[0] ?? 2048;
    const exponent = clamp(Math.round(Math.log2(sizeParam)), 10, 12);
    this.applyConfig(2 ** exponent);
    this.maxPeaks = clamp(Math.round(parameters.maxPeaks?.[0] ?? 64), 16, 128);
    this.peakFloor = 10 ** (clamp(parameters.peakFloorDb?.[0] ?? -60, -80, -40) / 20);

    const config = this.config;
    const { size: fftSize, half, ringMask } = config;

    const channelCount = Math.max(input.length, output.length);
    while (this.channels.length < channelCount) {
      this.channels.push({
        input: new Float32Array(config.ringLength),
        re: new Float32Array(fftSize),
        im: new Float32Array(fftSize),
        lastPhase: new Float64Array(half + 1),
        unwrapped: new Float64Array(half + 1),
        phase0: new Float64Array(half + 1),
        mags: new Float32Array(half + 1),
        trueFreq: new Float64Array(half + 1),
        regionMag: new Float64Array(half + 1),
        oscillators: [],
        accum: new Float32Array(config.ringLength)
      });
    }

    const factor = clamp(parameters.pitch?.[0] ?? 1, MIN_FACTOR, MAX_FACTOR);

    // Stage 1: buffer the incoming block in the per-channel input rings.
    for (let frame = 0; frame < frameCount; frame += 1) {
      const position = this.frameIndex & ringMask;
      for (let channel = 0; channel < channelCount; channel += 1) {
        this.channels[channel].input[position] = input[channel]?.[frame] ?? 0;
      }
      this.frameIndex += 1;
    }

    // Stage 2: analyze every frame whose window is now complete.
    while (this.nextFrame * config.hop + fftSize <= this.frameIndex) {
      this.processFrame(this.nextFrame, factor);
      this.nextFrame += 1;
    }

    // Stage 3: emit the output block, one analysis window behind the input.
    // The accumulator is a ring, so positions N apart share a slot; each slot
    // must be cleared when it is read, or later frames' contributions to the
    // aliased position would leak into this one.
    const outputStart = this.frameIndex - fftSize;
    for (let frame = 0; frame < frameCount; frame += 1) {
      const position = outputStart + frame;
      if (position < 0) continue; // silence before the stream begins
      const slot = position & ringMask;
      for (let channel = 0; channel < channelCount; channel += 1) {
        if (channel < output.length) {
          output[channel][frame] = this.channels[channel].accum[slot];
          this.channels[channel].accum[slot] = 0;
        }
      }
    }

    return true;
  }

  processFrame(frame, factor) {
    const config = this.config;
    const { size: fftSize, hop, half, ringMask, window, expected } = config;
    const windowStart = frame * hop;
    for (const state of this.channels) {
      for (let index = 0; index < fftSize; index += 1) {
        state.re[index] = window[index] * state.input[(windowStart + index) & ringMask];
        state.im[index] = 0;
      }

      fft(state.re, state.im, false);

      // Analysis: magnitude, unwrapped phase and true frequency per bin.
      let peak = 0;
      const initializePhase = !this.phaseInitialized;
      for (let bin = 0; bin <= half; bin += 1) {
        const real = state.re[bin];
        const imag = state.im[bin];
        const magnitude = Math.sqrt(real * real + imag * imag);
        const phase = Math.atan2(imag, real);
        let delta = phase - state.lastPhase[bin] - expected[bin];
        delta -= 2 * Math.PI * Math.round(delta / (2 * Math.PI)); // principal argument
        state.lastPhase[bin] = phase;
        if (initializePhase) {
          state.phase0[bin] = phase;
          state.unwrapped[bin] = phase;
        } else {
          state.unwrapped[bin] += expected[bin] + delta;
        }
        state.trueFreq[bin] = (expected[bin] + delta) / hop;
        state.mags[bin] = magnitude;
        if (magnitude > peak) peak = magnitude;
      }
      this.phaseInitialized = true;

      // Find spectral peaks (local maxima above the floor), strongest first.
      const floor = peak * this.peakFloor;
      if (floor > 0) {
        const peaks = [];
        for (let bin = 2; bin < half - 1; bin += 1) {
          if (state.mags[bin] >= floor && state.mags[bin] >= state.mags[bin - 1] && state.mags[bin] >= state.mags[bin + 1]) {
            peaks.push(bin);
          }
        }
        peaks.sort((a, b) => state.mags[b] - state.mags[a]);
        if (peaks.length > this.maxPeaks) peaks.length = this.maxPeaks;

        // Assign every significant bin to its nearest peak and sum magnitudes.
        const regionMag = state.regionMag;
        regionMag.fill(0);
        for (let bin = 1; bin < half; bin += 1) {
          if (state.mags[bin] < floor) continue;
          let nearest = -1;
          let bestDistance = 1e9;
          for (const candidate of peaks) {
            const distance = Math.abs(bin - candidate);
            if (distance < bestDistance) {
              bestDistance = distance;
              nearest = candidate;
            }
          }
          if (nearest >= 0) regionMag[nearest] += state.mags[bin];
        }

        // Synthesis: one oscillator per peak at the pitch-scaled true frequency,
        // with the phase propagated from the first frame. The oscillators use a
        // rotation recurrence instead of a per-sample Math.cos.
        const oscillators = state.oscillators;
        oscillators.length = 0;
        for (const bin of peaks) {
          const magnitude = regionMag[bin];
          if (magnitude < floor * 0.5) continue;
          const phase = factor * (state.unwrapped[bin] - state.phase0[bin]) + state.phase0[bin];
          const step = factor * state.trueFreq[bin];
          oscillators.push({ magnitude, c: Math.cos(phase), s: Math.sin(phase), stepC: Math.cos(step), stepS: Math.sin(step) });
        }
        for (let index = 0; index < fftSize; index += 1) {
          let accumulator = 0;
          for (const oscillator of oscillators) {
            accumulator += oscillator.magnitude * oscillator.c;
            const nextC = oscillator.c * oscillator.stepC - oscillator.s * oscillator.stepS;
            oscillator.s = oscillator.c * oscillator.stepS + oscillator.s * oscillator.stepC;
            oscillator.c = nextC;
          }
          state.accum[(windowStart + index) & ringMask] += accumulator * window[index] / fftSize;
        }
      }
    }
  }
}

// Iterative radix-2 FFT in place on (re, im). Forward has no normalization;
// inverse divides by the transform size.
function fft(re, im, inverse) {
  const size = re.length;

  // Bit-reversal permutation.
  for (let index = 1, reversed = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; reversed & bit; bit >>= 1) reversed ^= bit;
    reversed ^= bit;
    if (index < reversed) {
      let swap = re[index];
      re[index] = re[reversed];
      re[reversed] = swap;
      swap = im[index];
      im[index] = im[reversed];
      im[reversed] = swap;
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = ((inverse ? 1 : -1) * 2 * Math.PI) / length;
    const stepReal = Math.cos(angle);
    const stepImag = Math.sin(angle);
    const half = length >> 1;
    for (let start = 0; start < size; start += length) {
      let twiddleReal = 1;
      let twiddleImag = 0;
      for (let offset = 0; offset < half; offset += 1) {
        const evenReal = re[start + offset];
        const evenImag = im[start + offset];
        const oddReal = re[start + offset + half] * twiddleReal - im[start + offset + half] * twiddleImag;
        const oddImag = re[start + offset + half] * twiddleImag + im[start + offset + half] * twiddleReal;
        re[start + offset] = evenReal + oddReal;
        im[start + offset] = evenImag + oddImag;
        re[start + offset + half] = evenReal - oddReal;
        im[start + offset + half] = evenImag - oddImag;
        const nextReal = twiddleReal * stepReal - twiddleImag * stepImag;
        twiddleImag = twiddleReal * stepImag + twiddleImag * stepReal;
        twiddleReal = nextReal;
      }
    }
  }

  if (inverse) {
    for (let index = 0; index < size; index += 1) {
      re[index] /= size;
      im[index] /= size;
    }
  }
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

registerProcessor('raf-pitch', RafPitchProcessor);
