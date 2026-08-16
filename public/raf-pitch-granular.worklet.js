// Realtime granular pitch shifter for the Raf rack (classic engine).
//
// Shifts pitch by a fixed linear rate (resample) inside overlap-added grains
// while preserving duration. Grain starts advance in lockstep with the input
// clock and the read pointer lags the write pointer by READ_LAG, so upward
// shifts never outrun the arriving input. A fixed-hop granular read is not
// phase-continuous by itself (adjacent grains read input positions one
// synthesis hop apart, which is not an integer number of periods for most
// signals), so each new grain runs a bounded WSOLA-style search that aligns
// its head with the previous grain's tail, minimizing crossfade cancellation.
// The tradeoff is a fixed latency of about READ_LAG samples plus one grain of
// fade-in, and a small residual "chorus" at extreme shifts.
//
// The grain size is a k-rate parameter (1024 / 2048 / 4096): larger grains
// smear transients less but add latency and widen the WSOLA search space; the
// alignment window bounds how far a new grain's head may move to match the
// previous grain's tail.

const MAX_FACTOR = 2;
const MIN_FACTOR = 0.5;
const OUTPUT_SCALE = 0.5; // Hann windows sum to 2 at 75% overlap
const MATCH_LENGTH = 256; // overlap samples used for alignment
const MATCH_EPSILON = 1e-4; // ties within this mismatch are resolved by proximity

class RafPitchGranularProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitch', defaultValue: 1, minValue: MIN_FACTOR, maxValue: MAX_FACTOR, automationRate: 'k-rate' },
      { name: 'grainSize', defaultValue: 2048, minValue: 1024, maxValue: 4096, automationRate: 'k-rate' },
      { name: 'alignmentWindow', defaultValue: 256, minValue: 64, maxValue: 1024, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.config = this.createConfig(2048);
    this.channels = [];
    this.frameIndex = 0;
    this.nextGrainStart = 0;
  }

  createConfig(grainSize) {
    const hop = grainSize / 4; // 75% grain overlap
    const readLag = grainSize * MAX_FACTOR;
    const delayLength = grainSize * (MAX_FACTOR + 2); // power of two for masking
    const window = new Float32Array(grainSize);
    for (let index = 0; index < grainSize; index += 1) {
      window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / grainSize);
    }
    return {
      grainSize,
      hop,
      readLag,
      delayLength,
      delayMask: delayLength - 1,
      // Keeps the newest read (readStart + grainSize * MAX_FACTOR) behind the
      // write pointer at the grain's end, so the alignment can never outrun
      // the arriving input.
      alignMax: readLag - grainSize,
      window
    };
  }

  applyConfig(grainSize) {
    if (grainSize === this.config.grainSize) return;
    this.config = this.createConfig(grainSize);
    for (const state of this.channels) {
      state.delay = new Float32Array(this.config.delayLength);
      state.grains = [];
    }
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const frameCount = output[0]?.length ?? 0;
    if (frameCount === 0) return true;

    const grainSizeParam = parameters.grainSize?.[0] ?? 2048;
    const exponent = clamp(Math.round(Math.log2(grainSizeParam)), 10, 12);
    this.applyConfig(2 ** exponent);
    const alignmentWindow = clamp(Math.round(parameters.alignmentWindow?.[0] ?? 256), 64, 1024);
    const config = this.config;

    const channelCount = Math.max(input.length, output.length);
    while (this.channels.length < channelCount) {
      this.channels.push({ delay: new Float32Array(config.delayLength), grains: [] });
    }

    const factor = clamp(parameters.pitch?.[0] ?? 1, MIN_FACTOR, MAX_FACTOR);
    while (this.nextGrainStart < this.frameIndex + frameCount) {
      this.scheduleGrain(this.nextGrainStart, factor, alignmentWindow);
      this.nextGrainStart += config.hop;
    }

    for (let frame = 0; frame < frameCount; frame += 1) {
      const frameIndex = this.frameIndex;
      this.frameIndex += 1;

      for (let channel = 0; channel < channelCount; channel += 1) {
        const state = this.channels[channel];
        state.delay[frameIndex & config.delayMask] = input[channel]?.[frame] ?? 0;

        let accumulator = 0;
        for (const grain of state.grains) {
          const offset = frameIndex - grain.gStart;
          if (offset < 0 || offset >= config.grainSize) continue;
          const readPosition = grain.readStart + offset * factor;
          accumulator += config.window[offset] * interpolate(state.delay, readPosition, config.delayMask);
        }

        output[channel][frame] = accumulator * OUTPUT_SCALE;
      }
    }

    return true;
  }

  scheduleGrain(gStart, factor, alignmentWindow) {
    const config = this.config;
    for (const state of this.channels) {
      state.grains = state.grains.filter((grain) => grain.gStart + config.grainSize > gStart);

      const previous = state.grains[state.grains.length - 1];
      let align = 0;
      if (previous) {
        const previousAlign = previous.readStart - (previous.gStart - config.readLag);
        align = findAlignment(state.delay, previous, previousAlign, gStart, factor, config, alignmentWindow);
      }
      state.grains.push({ gStart, readStart: gStart - config.readLag + align });
    }
  }
}

function findAlignment(delay, previous, previousAlign, gStart, factor, config, alignmentWindow) {
  const template = new Float32Array(MATCH_LENGTH);
  for (let index = 0; index < MATCH_LENGTH; index += 1) {
    template[index] = interpolate(delay, previous.readStart + (config.hop + index) * factor, config.delayMask);
  }

  const minimum = Math.max(0, previousAlign - alignmentWindow);
  const maximum = Math.min(config.alignMax, previousAlign + alignmentWindow);
  let bestAlign = previousAlign;
  let bestMismatch = Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let align = minimum; align <= maximum; align += 1) {
    let mismatch = 0;
    for (let index = 0; index < MATCH_LENGTH; index += 1) {
      const difference = interpolate(delay, gStart - config.readLag + align + index * factor, config.delayMask) - template[index];
      mismatch += difference * difference;
    }
    const distance = Math.abs(align - previousAlign);
    if (mismatch < bestMismatch - MATCH_EPSILON
      || (Math.abs(mismatch - bestMismatch) <= MATCH_EPSILON && distance < bestDistance)) {
      bestAlign = align;
      bestMismatch = mismatch;
      bestDistance = distance;
    }
  }

  return bestAlign;
}

function interpolate(delay, position, delayMask) {
  const base = Math.floor(position);
  const fraction = position - base;
  const lower = delay[base & delayMask];
  const upper = delay[(base + 1) & delayMask];
  return lower + (upper - lower) * fraction;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

registerProcessor('raf-pitch-granular', RafPitchGranularProcessor);
