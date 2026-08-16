import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPitchNode, disposePitchNode, semitoneToFactor, updatePitchNode } from './pitch';
import { FakeContext } from './test-audio-context';
import type { RafPitchSettings } from '$lib/types';

const SAMPLE_RATE = 48_000;
const ANALYSIS_WINDOW = 2048; // FFT size in the phase-vocoder worklet
const HOP = ANALYSIS_WINDOW / 4;
// Skip the stream fade-in and the first frames' phase-lock transient.
const SEGMENT_START = ANALYSIS_WINDOW + 4096;
const SEGMENT_LENGTH = 16_384;

interface MockProcessor {
  process: (inputs: Float32Array[][], outputs: Float32Array[][], parameters: { pitch: Float32Array }) => boolean;
}

class MockAudioWorkletProcessor {
  port = {
    messages: [] as unknown[],
    onmessage: null,
    postMessage: (message: unknown) => { this.port.messages.push(message); }
  };
}

function loadPitchProcessor(path = 'public/raf-pitch.worklet.js'): new () => MockProcessor {
  let Processor: (new () => MockProcessor) | undefined;
  const loadWorklet = new Function(
    'AudioWorkletProcessor',
    'registerProcessor',
    'sampleRate',
    readFileSync(path).toString()
  );
  loadWorklet(
    MockAudioWorkletProcessor,
    (_name: string, value: typeof Processor) => { Processor = value; },
    SAMPLE_RATE
  );
  expect(Processor).toBeDefined();
  return Processor as NonNullable<typeof Processor>;
}

function runProcessor(processor: MockProcessor, input: Float32Array, factor: number): Float32Array {
  const output = new Float32Array(input.length);
  for (let offset = 0; offset < input.length; offset += 128) {
    const block = input.subarray(offset, offset + 128);
    const inBlock = [new Float32Array(128)];
    inBlock[0].set(block);
    const outBlock = [new Float32Array(128)];
    const parameters = { pitch: new Float32Array(128).fill(factor) };
    processor.process([inBlock], [outBlock], parameters);
    output.set(outBlock[0].subarray(0, block.length), offset);
  }
  return output;
}

function sine(seconds: number, frequency: number, amplitude = 0.8): Float32Array {
  const samples = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = amplitude * Math.sin(2 * Math.PI * frequency * index / SAMPLE_RATE);
  }
  return samples;
}

function goertzelMagnitude(samples: Float32Array, frequency: number): number {
  const normalized = 2 * Math.PI * frequency / SAMPLE_RATE;
  const coefficient = 2 * Math.cos(normalized);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let index = 0; index < samples.length; index += 1) {
    s0 = samples[index] + coefficient * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const real = s1 - s2 * Math.cos(normalized);
  const imag = s2 * Math.sin(normalized);
  return Math.hypot(real, imag);
}

// Average magnitude across a spread of frequencies, excluding the band around
// a target bin, so a shift that smears into broadband noise fails loudly.
function noiseFloor(samples: Float32Array, excludeLow: number, excludeHigh: number): number {
  let sum = 0;
  let count = 0;
  for (let frequency = 200; frequency <= 2000; frequency += 20) {
    if (frequency >= excludeLow && frequency <= excludeHigh) continue;
    sum += goertzelMagnitude(samples, frequency);
    count += 1;
  }
  return count === 0 ? 0 : sum / count;
}

describe('Raf pitch worklet', () => {
  it('delays the output by one analysis window and preserves duration', () => {
    const Processor = loadPitchProcessor();
    const processor = new Processor();
    const onset = 0.4 * SAMPLE_RATE;
    const input = new Float32Array(SAMPLE_RATE);
    input.set(sine(0.6, 440), onset);

    const output = runProcessor(processor, input, 1);

    expect(output.length).toBe(input.length);
    // Nothing may appear before the first analysis window that touches the
    // onset: the frames covering the tone start at
    // (floor((onset - N) / R) + 1) * R.
    const zeroEnd = (Math.floor((onset - ANALYSIS_WINDOW) / HOP) + 1) * HOP;
    let earlyPeak = 0;
    for (let index = 0; index < zeroEnd; index += 1) {
      earlyPeak = Math.max(earlyPeak, Math.abs(output[index]));
    }
    expect(earlyPeak).toBe(0);
    // The tone is at full amplitude once the analysis windows are fully
    // inside it and the emission has caught up.
    const segment = output.slice(onset + 4096, onset + 4096 + SEGMENT_LENGTH);
    expect(goertzelMagnitude(segment, 440) / segment.length).toBeGreaterThan(0.3);
  });

  it('is a near-transparent delayed passthrough at unity pitch', () => {
    const Processor = loadPitchProcessor();
    const processor = new Processor();
    const input = sine(1, 440);

    const output = runProcessor(processor, input, 1);
    const segment = output.slice(SEGMENT_START, SEGMENT_START + SEGMENT_LENGTH);

    expect(output.length).toBe(input.length);
    // The phase vocoder is near-transparent, not bit-exact: the amplitude is
    // preserved (the oscillator bank reconstructs the window L1 sum, ~4% high)
    // and the steady output must be a clean 440 Hz sine. A regression to
    // hop-rate "chorus" would smear it into broadband noise.
    const magnitudeAt440 = goertzelMagnitude(segment, 440);
    const amplitude = (2 * magnitudeAt440) / segment.length;
    expect(amplitude).toBeGreaterThan(0.7);
    expect(amplitude).toBeLessThan(0.9);
    // Cleanliness: no spurious octave content at unity pitch.
    expect(goertzelMagnitude(segment, 880) / segment.length).toBeLessThan(0.02);
    // Waveform check: a least-squares fit of a single 440 Hz sine must leave
    // almost no residual.
    const omega = 2 * Math.PI * 440 / SAMPLE_RATE;
    let s11 = 0, s12 = 0, s22 = 0, y1 = 0, y2 = 0;
    for (let index = 0; index < segment.length; index += 1) {
      const sinComponent = Math.sin(omega * index);
      const cosComponent = Math.cos(omega * index);
      s11 += sinComponent * sinComponent;
      s12 += sinComponent * cosComponent;
      s22 += cosComponent * cosComponent;
      y1 += segment[index] * sinComponent;
      y2 += segment[index] * cosComponent;
    }
    const determinant = s11 * s22 - s12 * s12;
    const fitSin = (y1 * s22 - y2 * s12) / determinant;
    const fitCos = (y2 * s11 - y1 * s12) / determinant;
    let maxResidual = 0;
    for (let index = 0; index < segment.length; index += 1) {
      const expected = fitSin * Math.sin(omega * index) + fitCos * Math.cos(omega * index);
      maxResidual = Math.max(maxResidual, Math.abs(segment[index] - expected));
    }
    expect(maxResidual).toBeLessThan(0.01);
  });

  it('shifts an octave up while preserving duration and stays clean', () => {
    const Processor = loadPitchProcessor();
    const processor = new Processor();
    const input = sine(1, 440);

    const output = runProcessor(processor, input, 2);
    const segment = output.slice(SEGMENT_START, SEGMENT_START + SEGMENT_LENGTH);
    const magnitudeAtOctave = goertzelMagnitude(segment, 880);
    const magnitudeAtSource = goertzelMagnitude(segment, 440);

    expect(output.length).toBe(input.length);
    expect(magnitudeAtOctave).toBeGreaterThan(magnitudeAtSource * 3);
    expect(magnitudeAtOctave / segment.length).toBeGreaterThan(0.05);
    // The shifted tone must sit in its bin instead of smearing into noise.
    expect(magnitudeAtOctave / noiseFloor(segment, 820, 940)).toBeGreaterThan(20);
  });

  it('shifts an octave down while preserving duration and stays clean', () => {
    const Processor = loadPitchProcessor();
    const processor = new Processor();
    const input = sine(1, 880);

    const output = runProcessor(processor, input, 0.5);
    const segment = output.slice(SEGMENT_START, SEGMENT_START + SEGMENT_LENGTH);
    const magnitudeAtSubOctave = goertzelMagnitude(segment, 440);
    const magnitudeAtSource = goertzelMagnitude(segment, 880);

    expect(output.length).toBe(input.length);
    expect(magnitudeAtSubOctave).toBeGreaterThan(magnitudeAtSource * 3);
    expect(magnitudeAtSubOctave / segment.length).toBeGreaterThan(0.05);
    expect(magnitudeAtSubOctave / noiseFloor(segment, 380, 500)).toBeGreaterThan(20);
  });

  it('respects the configured window size and peak cap', () => {
    const Processor = loadPitchProcessor();
    const processor = new Processor();
    const input = sine(1, 440);
    const output = new Float32Array(input.length);
    for (let offset = 0; offset < input.length; offset += 128) {
      const inBlock = [new Float32Array(128)];
      inBlock[0].set(input.subarray(offset, offset + 128));
      const outBlock = [new Float32Array(128)];
      const parameters = {
        pitch: new Float32Array(128).fill(2),
        windowSize: new Float32Array(128).fill(1024),
        maxPeaks: new Float32Array(128).fill(16),
        peakFloorDb: new Float32Array(128).fill(-60)
      };
      processor.process([inBlock], [outBlock], parameters);
      output.set(outBlock[0].subarray(0, 128), offset);
    }
    // A 1024-sample window halves the latency; skip past its shorter fade-in.
    const segment = output.slice(1024 + 4096, 1024 + 4096 + SEGMENT_LENGTH);
    const magnitudeAtOctave = goertzelMagnitude(segment, 880);
    const magnitudeAtSource = goertzelMagnitude(segment, 440);
    expect(magnitudeAtOctave).toBeGreaterThan(magnitudeAtSource * 3);
    expect(magnitudeAtOctave / segment.length).toBeGreaterThan(0.05);
  });
});

describe('Raf pitch granular worklet', () => {
  const GRANULAR_READ_LAG = 4096; // GRAIN_SIZE * MAX_FACTOR at the default grain size

  it('is a transparent delayed passthrough at unity pitch', () => {
    const Processor = loadPitchProcessor('public/raf-pitch-granular.worklet.js');
    const processor = new Processor();
    const input = sine(1, 440);

    const output = runProcessor(processor, input, 1);

    expect(output.length).toBe(input.length);
    for (let index = 0; index < 40_000; index += 1) {
      expect(Math.abs(output[GRANULAR_READ_LAG + index] - input[index])).toBeLessThan(1e-4);
    }
  });

  it('shifts an octave up while preserving duration', () => {
    const Processor = loadPitchProcessor('public/raf-pitch-granular.worklet.js');
    const processor = new Processor();
    const input = sine(1, 440);

    const output = runProcessor(processor, input, 2);
    const segment = output.slice(GRANULAR_READ_LAG + 2_048, GRANULAR_READ_LAG + 2_048 + 16_384);
    const magnitudeAtOctave = goertzelMagnitude(segment, 880);
    const magnitudeAtSource = goertzelMagnitude(segment, 440);

    expect(output.length).toBe(input.length);
    expect(magnitudeAtOctave).toBeGreaterThan(magnitudeAtSource * 3);
    expect(magnitudeAtOctave / segment.length).toBeGreaterThan(0.05);
  });

  it('shifts an octave down while preserving duration', () => {
    const Processor = loadPitchProcessor('public/raf-pitch-granular.worklet.js');
    const processor = new Processor();
    const input = sine(1, 880);

    const output = runProcessor(processor, input, 0.5);
    const segment = output.slice(GRANULAR_READ_LAG + 2_048, GRANULAR_READ_LAG + 2_048 + 16_384);
    const magnitudeAtSubOctave = goertzelMagnitude(segment, 440);
    const magnitudeAtSource = goertzelMagnitude(segment, 880);

    expect(output.length).toBe(input.length);
    expect(magnitudeAtSubOctave).toBeGreaterThan(magnitudeAtSource * 3);
    expect(magnitudeAtSubOctave / segment.length).toBeGreaterThan(0.05);
  });

  it('respects the configured grain size', () => {
    const Processor = loadPitchProcessor('public/raf-pitch-granular.worklet.js');
    const processor = new Processor();
    const input = sine(1, 440);
    const output = new Float32Array(input.length);
    for (let offset = 0; offset < input.length; offset += 128) {
      const inBlock = [new Float32Array(128)];
      inBlock[0].set(input.subarray(offset, offset + 128));
      const outBlock = [new Float32Array(128)];
      const parameters = {
        pitch: new Float32Array(128).fill(2),
        grainSize: new Float32Array(128).fill(1024),
        alignmentWindow: new Float32Array(128).fill(256)
      };
      processor.process([inBlock], [outBlock], parameters);
      output.set(outBlock[0].subarray(0, 128), offset);
    }
    // A 1024-sample grain shifts the read lag to 2048 samples.
    const segment = output.slice(2_048 + 2_048, 2_048 + 2_048 + 16_384);
    const magnitudeAtOctave = goertzelMagnitude(segment, 880);
    const magnitudeAtSource = goertzelMagnitude(segment, 440);
    expect(magnitudeAtOctave).toBeGreaterThan(magnitudeAtSource * 3);
    expect(magnitudeAtOctave / segment.length).toBeGreaterThan(0.05);
  });
});

describe('Pitch node', () => {
  it('maps semitones to resample factors and clamps', () => {
    expect(semitoneToFactor(0)).toBe(1);
    expect(semitoneToFactor(12)).toBeCloseTo(2);
    expect(semitoneToFactor(-12)).toBeCloseTo(0.5);
    expect(semitoneToFactor(99)).toBe(2);
    expect(semitoneToFactor(-99)).toBe(0.5);
  });

  it('falls back to a dry path when the worklet is unavailable', async () => {
    const context = new FakeContext();
    const settings: RafPitchSettings = {
      id: 'pitch',
      type: 'pitch',
      enabled: true,
      dryWet: 100,
      semitones: 0,
      engine: 'phase-vocoder',
      windowSize: 2048,
      maxPeaks: 64,
      peakFloorDb: -60,
      grainSize: 2048,
      alignmentWindow: 256
    };
    const node = createPitchNode(context as unknown as BaseAudioContext, settings);

    await node.ready;

    expect(node.worklet).toBeNull();
    expect(node.pitchParam).toBeNull();
    expect(node.nodes).toHaveLength(2);
    expect((node.input as unknown as { connections: Array<{ destination: unknown }> }).connections[0]?.destination).toBe(node.output);

    updatePitchNode(node, { ...settings, semitones: 5 }, context as unknown as BaseAudioContext, settings);
    disposePitchNode(node);
    expect(node.disposed).toBe(true);
  });
});
