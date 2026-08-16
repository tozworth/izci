// Realtime granular pitch shifter for the Raf rack.
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

const GRAIN_SIZE = 2048;
const SYNTHESIS_HOP = GRAIN_SIZE / 4; // 75% grain overlap
const MAX_FACTOR = 2;
const MIN_FACTOR = 0.5;
const READ_LAG = GRAIN_SIZE * MAX_FACTOR;
const DELAY_LENGTH = GRAIN_SIZE * (MAX_FACTOR + 2); // power of two for masking
const DELAY_MASK = DELAY_LENGTH - 1;
const OUTPUT_SCALE = 0.5; // Hann windows sum to 2 at 75% overlap
const ALIGN_MAX = READ_LAG - GRAIN_SIZE / 2; // keeps the newest read behind the write pointer
const ALIGN_WINDOW = 256; // bounded search range per grain
const MATCH_LENGTH = 256; // overlap samples used for alignment
const MATCH_EPSILON = 1e-4; // ties within this mismatch are resolved by proximity

class RafPitchProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'pitch', defaultValue: 1, minValue: MIN_FACTOR, maxValue: MAX_FACTOR, automationRate: 'k-rate' }
    ];
  }

  constructor() {
    super();
    this.window = new Float32Array(GRAIN_SIZE);
    for (let index = 0; index < GRAIN_SIZE; index += 1) {
      this.window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / GRAIN_SIZE);
    }
    this.channels = [];
    this.frameIndex = 0;
    this.nextGrainStart = 0;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    const frameCount = output[0]?.length ?? 0;
    if (frameCount === 0) return true;

    const channelCount = Math.max(input.length, output.length);
    while (this.channels.length < channelCount) {
      this.channels.push({ delay: new Float32Array(DELAY_LENGTH), grains: [] });
    }

    const factor = clamp(parameters.pitch?.[0] ?? 1, MIN_FACTOR, MAX_FACTOR);
    while (this.nextGrainStart < this.frameIndex + frameCount) {
      this.scheduleGrain(this.nextGrainStart, factor);
      this.nextGrainStart += SYNTHESIS_HOP;
    }

    for (let frame = 0; frame < frameCount; frame += 1) {
      const frameIndex = this.frameIndex;
      this.frameIndex += 1;

      for (let channel = 0; channel < channelCount; channel += 1) {
        const state = this.channels[channel];
        state.delay[frameIndex & DELAY_MASK] = input[channel]?.[frame] ?? 0;

        let accumulator = 0;
        for (const grain of state.grains) {
          const offset = frameIndex - grain.gStart;
          if (offset < 0 || offset >= GRAIN_SIZE) continue;
          const readPosition = grain.readStart + offset * factor;
          accumulator += this.window[offset] * interpolate(state.delay, readPosition);
        }

        output[channel][frame] = accumulator * OUTPUT_SCALE;
      }
    }

    return true;
  }

  scheduleGrain(gStart, factor) {
    for (const state of this.channels) {
      state.grains = state.grains.filter((grain) => grain.gStart + GRAIN_SIZE > gStart);

      const previous = state.grains[state.grains.length - 1];
      let align = 0;
      if (previous) {
        const previousAlign = previous.readStart - (previous.gStart - READ_LAG);
        align = findAlignment(state.delay, previous, previousAlign, gStart, factor);
      }
      state.grains.push({ gStart, readStart: gStart - READ_LAG + align });
    }
  }
}

function findAlignment(delay, previous, previousAlign, gStart, factor) {
  const template = new Float32Array(MATCH_LENGTH);
  for (let index = 0; index < MATCH_LENGTH; index += 1) {
    template[index] = interpolate(delay, previous.readStart + (SYNTHESIS_HOP + index) * factor);
  }

  const minimum = Math.max(0, previousAlign - ALIGN_WINDOW);
  const maximum = Math.min(ALIGN_MAX, previousAlign + ALIGN_WINDOW);
  let bestAlign = previousAlign;
  let bestMismatch = Number.POSITIVE_INFINITY;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let align = minimum; align <= maximum; align += 1) {
    let mismatch = 0;
    for (let index = 0; index < MATCH_LENGTH; index += 1) {
      const difference = interpolate(delay, gStart - READ_LAG + align + index * factor) - template[index];
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

function interpolate(delay, position) {
  const base = Math.floor(position);
  const fraction = position - base;
  const lower = delay[base & DELAY_MASK];
  const upper = delay[(base + 1) & DELAY_MASK];
  return lower + (upper - lower) * fraction;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

registerProcessor('raf-pitch', RafPitchProcessor);
