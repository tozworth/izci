import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface HivelyCore {
  memory: WebAssembly.Memory;
  _initialize(): void;
  ahx_init(): void;
  malloc(length: number): number;
  free(pointer: number): void;
  ahx_load(pointer: number, length: number, rate: number, stereo: number): number;
  ahx_unload(): void;
  ahx_set_interpolation(taps: number): void;
  ahx_set_ramping(milliseconds: number): void;
  ahx_set_channel_mute(channel: number, muted: number): void;
  ahx_set_playback_factors(tempo: number, pitch: number): void;
  ahx_decode_frame(): number;
  ahx_mix_buffer(): number;
  ahx_frame_samples(): number;
  ahx_current_frame(): number;
  ahx_current_order(): number;
  ahx_current_row(): number;
  ahx_seek_frame(frame: number): void;
  ahx_select_subsong(subsong: number): number;
}

// Synthetic one-voice AHX/HVL tunes: triangle instrument plus a tempo command
// on the sounding channel, so muting must preserve tracker effects and timing.
function toneModule(format: 'ahx' | 'hvl'): Uint8Array {
  const hvl = format === 'hvl';
  const headerLength = hvl ? 16 : 14;
  const rowLength = hvl ? 5 : 3;
  const instrumentOffset = headerLength + 8 + 8 * rowLength;
  const namesOffset = instrumentOffset + 22 + (hvl ? 5 : 4);
  const bytes = new Uint8Array(namesOffset + 32);
  bytes.set(new TextEncoder().encode(hvl ? 'HVL' : 'THX'));
  bytes[3] = 1;
  new DataView(bytes.buffer).setUint16(4, namesOffset);
  bytes[6] = 0x80; // Omit blank track 0.
  bytes[7] = 1; // One position.
  bytes[10] = 8; // Eight rows.
  bytes[11] = 1; // One populated track.
  bytes[12] = 1; // One instrument.
  if (hvl) bytes[14] = 100; // Mix gain percentage.
  bytes[headerLength] = 1; // Channel 1 uses track 1; others use blank track 0.
  const trackOffset = headerLength + 8;
  bytes.set(hvl ? [25, 1, 0xf0, 3, 0] : [25 << 2, 0x1f, 3], trackOffset);
  bytes[instrumentOffset] = 64;
  bytes[instrumentOffset + 1] = 5; // Wavelength 128.
  bytes[instrumentOffset + 2] = 1;
  bytes[instrumentOffset + 3] = 64;
  bytes[instrumentOffset + 5] = 64;
  bytes[instrumentOffset + 6] = 255;
  bytes[instrumentOffset + 12] = 1;
  bytes[instrumentOffset + 19] = 63;
  bytes[instrumentOffset + 20] = 1;
  bytes[instrumentOffset + 21] = 1;
  bytes.set(hvl ? [0, 1, 1, 0, 0] : [0, 0x81, 0, 0], instrumentOffset + 22);
  bytes.set(new TextEncoder().encode('Channel test\0Triangle\0'), namesOffset);
  return bytes;
}

function waveSwitchModule(format: 'ahx' | 'hvl'): Uint8Array {
  const hvl = format === 'hvl';
  const original = toneModule(format);
  const instrumentLength = 22 + (hvl ? 5 : 4);
  const namesOffset = new DataView(original.buffer).getUint16(4);
  const instrumentOffset = namesOffset - instrumentLength;
  const bytes = new Uint8Array(original.length + instrumentLength);
  bytes.set(original.subarray(0, namesOffset));
  bytes.set(original.subarray(instrumentOffset, namesOffset), namesOffset);
  bytes.set(original.subarray(namesOffset), namesOffset + instrumentLength);
  new DataView(bytes.buffer).setUint16(4, namesOffset + instrumentLength);
  bytes[12] = 2;
  // Instrument 2 uses sawtooth instead of triangle, at the same gain and pitch.
  bytes.set(hvl ? [0, 2, 1, 0, 0] : [1, 1, 0, 0], namesOffset + 22);
  bytes.set(hvl ? [25, 2, 0, 0, 0] : [25 << 2, 0x20, 0], (hvl ? 16 : 14) + 8 + (hvl ? 5 : 3));
  return bytes;
}

async function createCore(): Promise<HivelyCore> {
  const { instance } = await WebAssembly.instantiate(readFileSync('public/vendor/hively-replay.wasm'), {
    env: { emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: { fd_write() { return 0; } }
  });
  const core = instance.exports as unknown as HivelyCore;
  core._initialize();
  core.ahx_init();
  return core;
}

function load(core: HivelyCore, bytes: Uint8Array, sampleRate = 48_000): void {
  const pointer = core.malloc(bytes.length);
  new Uint8Array(core.memory.buffer, pointer, bytes.length).set(bytes);
  const accepted = core.ahx_load(pointer, bytes.length, sampleRate, 2);
  core.free(pointer);
  expect(accepted).toBe(1);
}

function render(core: HivelyCore, frames = 3): number[] {
  const samples: number[] = [];
  for (let frame = 0; frame < frames; frame++) {
    expect(core.ahx_decode_frame()).toBe(1);
    samples.push(...new Int16Array(core.memory.buffer, core.ahx_mix_buffer(), core.ahx_frame_samples() * 2));
  }
  return samples;
}

describe.each(['ahx', 'hvl'] as const)('%s channel rendering', (format) => {
  if (format === 'hvl') it.each([1, 2, 4, 8])('preserves settled %i-tap ring modulation while ramping', async (taps) => {
    const core = await createCore();
    const bytes = toneModule(format);
    const namesOffset = new DataView(bytes.buffer).getUint16(4);
    // Ring-modulate the carrier with a triangle at a different relative pitch.
    bytes[namesOffset - 5] = 7;
    bytes[namesOffset - 2] = 0x91;
    try {
      load(core, bytes);
      core.ahx_set_interpolation(taps);
      const original = render(core, 6);
      core.ahx_seek_frame(0);
      core.ahx_set_ramping(5);
      const smooth = render(core, 6);
      expect(smooth.some((sample) => sample !== 0)).toBe(true);
      // The original 1-tap mixer rounds panning before mix gain; the custom
      // mixer keeps that intermediate precision. Allow one PCM quantization step.
      expect(Math.max(...smooth.slice(960 * 2).map((sample, index) => Math.abs(sample - original[960 * 2 + index]))))
        .toBeLessThanOrEqual(1);
    } finally { core.ahx_unload(); }
  });

  it.each([1, 2, 4, 8])('de-clicks in-place waveform replacement with %i taps', async (taps) => {
    const core = await createCore();
    try {
      load(core, waveSwitchModule(format));
      core.ahx_set_interpolation(taps);
      const abrupt = render(core, 6);
      core.ahx_seek_frame(0);
      core.ahx_set_ramping(5);
      const smooth = render(core, 6);
      const boundary = 3 * 960 * 2;
      const jump = Math.abs(abrupt[boundary] - abrupt[boundary - 2]);
      expect(jump).toBeGreaterThan(100);
      expect(Math.abs(smooth[boundary] - smooth[boundary - 2])).toBeLessThan(jump / 4);
      expect(smooth.slice(boundary + 240 * 2)).toEqual(abrupt.slice(boundary + 240 * 2));
      // Seeking into a finished ramp must reproduce uninterrupted output.
      core.ahx_seek_frame(4);
      expect(render(core, 2)).toEqual(smooth.slice(4 * 960 * 2));
    } finally { core.ahx_unload(); }
  });

  it.each([1, 2, 4, 8])('smooths %i-tap pan jumps at the requested output-sample duration', async (taps) => {
    const core = await createCore();
    const bytes = toneModule(format);
    const row1 = (format === 'hvl' ? 16 : 14) + 8 + (format === 'hvl' ? 5 : 3);
    bytes.set(format === 'hvl' ? [0, 0, 0x70, 0x7f, 0] : [0, 7, 0x7f], row1);
    try {
      load(core, bytes, 44_100);
      core.ahx_set_interpolation(taps);
      const abrupt = render(core, 6);
      core.ahx_seek_frame(0);
      core.ahx_set_ramping(10);
      const smooth = render(core, 6);
      const boundary = 3 * 882 * 2;
      const jump = Math.abs(abrupt[boundary] - abrupt[boundary - 2]);
      expect(jump).toBeGreaterThan(100);
      expect(Math.abs(smooth[boundary] - smooth[boundary - 2])).toBeLessThan(jump / 4);
      expect(smooth.slice(boundary + 441 * 2)).toEqual(abrupt.slice(boundary + 441 * 2));
    } finally { core.ahx_unload(); }
  });

  it.each([1, 2, 4, 8])('ramps abrupt volume cuts with %i taps without changing the settled waveform', async (taps) => {
    const core = await createCore();
    const bytes = toneModule(format);
    const row1 = (format === 'hvl' ? 16 : 14) + 8 + (format === 'hvl' ? 5 : 3);
    bytes.set(format === 'hvl' ? [0, 0, 0xc0, 0, 0] : [0, 0x0c, 0], row1);
    try {
      load(core, bytes);
      core.ahx_set_interpolation(taps);
      const abrupt = render(core, 6);
      core.ahx_seek_frame(0);
      core.ahx_set_ramping(5);
      const smooth = render(core, 6);
      const boundary = 3 * 960 * 2; // F03: three 20 ms ticks before row 1.
      expect(Math.abs(abrupt[boundary] - abrupt[boundary - 2])).toBeGreaterThan(100);
      expect(Math.abs(smooth[boundary] - smooth[boundary - 2]))
        .toBeLessThan(Math.abs(abrupt[boundary] - abrupt[boundary - 2]) / 4);
      expect(smooth.slice(boundary + 240 * 2).every((sample) => sample === 0)).toBe(true);
      expect(smooth.slice(960 * 2, boundary)).toEqual(abrupt.slice(960 * 2, boundary));
      core.ahx_seek_frame(0);
      expect(render(core, 6)).toEqual(smooth);
      expect(core.ahx_select_subsong(0)).toBe(1);
      expect(render(core, 6)).toEqual(smooth);
      core.ahx_set_ramping(0);
      core.ahx_seek_frame(0);
      expect(render(core, 6)).toEqual(abrupt);
    } finally { core.ahx_unload(); }
  });

  it.each([1, 2, 4, 8].flatMap((taps) => [0.25, 1.37, 4].map((tempo) => [taps, tempo])))('keeps %i-tap mute ramps finite across rapid ticks at %fx tempo', async (taps, tempo) => {
    const core = await createCore();
    const bytes = toneModule(format);
    bytes[6] |= 0x60; // 200 Hz replay ticks, shorter than the 40 ms ramp.
    bytes[(format === 'hvl' ? 16 : 14) + 8 + (format === 'hvl' ? 3 : 2)] = 32;
    try {
      load(core, bytes);
      core.ahx_set_interpolation(taps);
      core.ahx_set_playback_factors(tempo, 1);
      core.ahx_set_ramping(40);
      render(core, 10);
      core.ahx_set_channel_mute(0, 1);
      const muted = render(core, 10);
      expect(muted.slice(0, 1920 * 2).some((sample) => sample !== 0)).toBe(true);
      expect(muted.slice(1920 * 2).every((sample) => sample === 0)).toBe(true);
      core.ahx_set_channel_mute(0, 0);
      const unmuted = render(core, 10);
      expect(unmuted.some((sample) => sample !== 0)).toBe(true);
      expect(unmuted.every((sample) => Number.isFinite(sample) && Math.abs(sample) < 32767)).toBe(true);
    } finally { core.ahx_unload(); }
  });

  function risingCrossings(samples: number[]): number {
    let count = 0;
    for (let index = 2; index < samples.length; index += 2) {
      if (samples[index - 2] <= 0 && samples[index] > 0) count++;
    }
    return count;
  }

  it.each([1, 2, 4, 8])('controls tempo and pitch independently with %i-tap interpolation', async (taps) => {
    const core = await createCore();
    const bytes = toneModule(format);
    try {
      load(core, bytes);
      core.ahx_set_interpolation(taps);
      const original = render(core, 12);
      const originalCrossings = risingCrossings(original);
      expect(originalCrossings).toBeGreaterThan(5);

      core.ahx_seek_frame(0);
      core.ahx_set_playback_factors(2, 1);
      const faster = render(core, 12);
      expect(faster.length).toBe(original.length / 2);
      expect(risingCrossings(faster) / originalCrossings).toBeCloseTo(0.5, 1);
      expect(core.ahx_current_frame()).toBe(12);

      core.ahx_seek_frame(0);
      core.ahx_set_playback_factors(1, 2);
      const higher = render(core, 12);
      expect(higher.length).toBe(original.length);
      expect(risingCrossings(higher) / originalCrossings).toBeCloseTo(2, 1);

      core.ahx_set_playback_factors(0.25, 0.25);
      core.ahx_seek_frame(0);
      const slower = render(core, 12);
      expect(slower.length).toBe(original.length * 4);
      expect(risingCrossings(slower) / originalCrossings).toBeCloseTo(1, 1);
      expect(core.ahx_select_subsong(0)).toBe(1);
      expect(render(core, 12)).toEqual(slower);
      core.ahx_seek_frame(6);
      expect(render(core, 6)).toEqual(slower.slice(6 * 3840 * 2));

      // Returning to original tuning on a sustained note must not leave the
      // mixer steps multiplied by the previous pitch setting.
      core.ahx_set_playback_factors(1, 1);
      const restored = render(core, 6);
      expect(restored.length).toBe(original.length / 2);
      expect(risingCrossings(restored) / originalCrossings).toBeCloseTo(0.5, 1);
      core.ahx_seek_frame(0);
      expect(render(core, 12)).toEqual(original);
    } finally {
      core.ahx_unload();
    }
  });

  it('carries fractional tick lengths at 44.1 kHz with the fastest replay multiplier', async () => {
    const core = await createCore();
    const bytes = toneModule(format);
    bytes[6] |= 0x60; // Four replay ticks per frame.
    try {
      load(core, bytes, 44_100);
      core.ahx_set_playback_factors(1.37, 1);
      const samples = render(core, 5);
      expect(Math.abs(samples.length / 2 - 5 * 44_100 / 50 / 1.37)).toBeLessThan(1);
    } finally {
      core.ahx_unload();
    }
  });

  it('bounds invalid factors and resets them when loading another tune', async () => {
    const core = await createCore();
    const bytes = toneModule(format);
    try {
      load(core, bytes);
      core.ahx_set_playback_factors(-1, Number.NaN);
      expect(render(core, 1)).toHaveLength(3840 * 2);
      core.ahx_set_playback_factors(100, Number.POSITIVE_INFINITY);
      expect(render(core, 1)).toHaveLength(240 * 2);
      core.ahx_set_playback_factors(Number.NaN, 1);
      expect(render(core, 1)).toHaveLength(960 * 2);
      core.ahx_set_playback_factors(0.25, 4);
      load(core, bytes);
      expect(render(core, 1)).toHaveLength(960 * 2);
    } finally {
      core.ahx_unload();
    }
  });

  it.each([1, 2, 4, 8])('mutes %i-tap audio without stopping effects or resetting voice state', async (taps) => {
    const core = await createCore();
    const bytes = toneModule(format);
    try {
      load(core, bytes);
      core.ahx_set_interpolation(taps);
      const first = render(core);
      expect(first.some((sample) => sample !== 0)).toBe(true);
      const uninterrupted = render(core);
      const row = core.ahx_current_row();

      load(core, bytes);
      core.ahx_set_channel_mute(0, 1);
      expect(render(core).every((sample) => sample === 0)).toBe(true);
      core.ahx_set_channel_mute(0, 0);
      expect(render(core)).toEqual(uninterrupted);
      expect(core.ahx_current_row()).toBe(row);

      core.ahx_set_channel_mute(0, 1);
      core.ahx_seek_frame(0);
      expect(render(core).every((sample) => sample === 0)).toBe(true);
      expect(core.ahx_select_subsong(0)).toBe(1);
      expect(render(core).every((sample) => sample === 0)).toBe(true);
      core.ahx_set_channel_mute(0, 0);
      core.ahx_seek_frame(0);
      expect(render(core)).toEqual(first);
      core.ahx_set_channel_mute(0, 1);
      load(core, bytes);
      expect(render(core)).toEqual(first);
    } finally {
      core.ahx_unload();
    }
  });
});
