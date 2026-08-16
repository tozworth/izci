import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPitchNode, disposePitchNode, semitoneToFactor, updatePitchNode } from './pitch';
import { FakeContext } from './test-audio-context';

const SAMPLE_RATE = 48_000;
const READ_LAG = 2048 * 2; // GRAIN_SIZE * MAX_FACTOR in the worklet

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

function loadPitchProcessor(): new () => MockProcessor {
  let Processor: (new () => MockProcessor) | undefined;
  const loadWorklet = new Function(
    'AudioWorkletProcessor',
    'registerProcessor',
    'sampleRate',
    readFileSync('public/raf-pitch.worklet.js').toString()
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
  return Math.sqrt(real * real + imag * imag);
}

describe('Raf pitch worklet', () => {
  it('is a transparent delayed passthrough at unity pitch', () => {
    const Processor = loadPitchProcessor();
    const processor = new Processor();
    const input = sine(1, 440);

    const output = runProcessor(processor, input, 1);

    expect(output.length).toBe(input.length);
    for (let index = 0; index < 40_000; index += 1) {
      expect(Math.abs(output[READ_LAG + index] - input[index])).toBeLessThan(1e-4);
    }
  });

  it('shifts an octave up while preserving duration', () => {
    const Processor = loadPitchProcessor();
    const processor = new Processor();
    const input = sine(1, 440);

    const output = runProcessor(processor, input, 2);
    const segment = output.slice(READ_LAG + 2_048, READ_LAG + 2_048 + 16_384);
    const magnitudeAtOctave = goertzelMagnitude(segment, 880);
    const magnitudeAtSource = goertzelMagnitude(segment, 440);

    expect(output.length).toBe(input.length);
    expect(magnitudeAtOctave).toBeGreaterThan(magnitudeAtSource * 3);
    expect(magnitudeAtOctave / segment.length).toBeGreaterThan(0.05);
  });

  it('shifts an octave down while preserving duration', () => {
    const Processor = loadPitchProcessor();
    const processor = new Processor();
    const input = sine(1, 880);

    const output = runProcessor(processor, input, 0.5);
    const segment = output.slice(READ_LAG + 2_048, READ_LAG + 2_048 + 16_384);
    const magnitudeAtSubOctave = goertzelMagnitude(segment, 440);
    const magnitudeAtSource = goertzelMagnitude(segment, 880);

    expect(output.length).toBe(input.length);
    expect(magnitudeAtSubOctave).toBeGreaterThan(magnitudeAtSource * 3);
    expect(magnitudeAtSubOctave / segment.length).toBeGreaterThan(0.05);
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
    const settings = { id: 'pitch', type: 'pitch' as const, enabled: true, semitones: 0 };
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
