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
