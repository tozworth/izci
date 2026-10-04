import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { measureHivelyPatternStarts, type HivelyTimingCore } from './hively-pattern-timing';

describe('Hively pattern timing', () => {
  it('follows playback order, including repeated positions and variable lengths', () => {
    const orders = [2, 2, 2, 5, 5, 1, 1, 5];
    let frame = -1;
    expect(measureHivelyPatternStarts({
      ahx_duration_frames: () => orders.length,
      ahx_decode_frame: () => ++frame < orders.length ? 1 : 0,
      ahx_current_order: () => orders[frame]
    })).toEqual([0, 0.06, 0.1, 0.14]);
  });

  it.each(['ahx', 'hvl'])('reads actual %s boundaries in a separate decoder', async (format) => {
    const result = await WebAssembly.instantiate(readFileSync('public/vendor/hively-replay.wasm'), {
      env: { emscripten_notify_memory_growth() {} },
      wasi_snapshot_preview1: { fd_write() { return 0; } }
    });
    const core = result.instance.exports as unknown as HivelyTimingCore & {
      memory: WebAssembly.Memory;
      _initialize(): void;
      malloc(size: number): number;
      free(pointer: number): void;
      ahx_load(pointer: number, length: number, rate: number, stereo: number): number;
      ahx_unload(): void;
      ahx_seek_frame(frame: number): void;
      ahx_current_row(): number;
    };
    core._initialize();
    const headerLength = format === 'hvl' ? 16 : 14;
    const namesOffset = headerLength + 24;
    const module = new Uint8Array(namesOffset + 5);
    module.set(new TextEncoder().encode(format === 'hvl' ? 'HVL' : 'THX'));
    module[3] = 1;
    new DataView(module.buffer).setUint16(4, namesOffset);
    module[6] = 0x80;
    module[7] = 3;
    module[10] = 1;
    module.set(new TextEncoder().encode('Seek\0'), namesOffset);
    const input = core.malloc(module.byteLength);
    try {
      new Uint8Array(core.memory.buffer, input, module.byteLength).set(module);
      expect(core.ahx_load(input, module.byteLength, 8000, 2)).toBe(1);
      const starts = measureHivelyPatternStarts(core);
      expect(starts).toEqual([0, 0.12, 0.24]);
      for (const [order, seconds] of starts.entries()) {
        core.ahx_seek_frame(Math.round(seconds * 50));
        expect(core.ahx_current_order()).toBe(order);
        expect(core.ahx_current_row()).toBe(0);
      }
    } finally { core.free(input); core.ahx_unload(); }
  });
});
