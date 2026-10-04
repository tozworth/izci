import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OpenMptCore } from './abi';
import type { ModuleDecodeRequest, ModuleDecodeResponse } from './protocol';
import { realOpenMpt, toneModule } from './test-fixtures';

const initialize = vi.hoisted(() => vi.fn());
vi.mock('./runtime', () => ({ initializeOpenMpt: initialize }));

const worker = {
  onmessage: null as ((event: { data: ModuleDecodeRequest }) => void) | null,
  postMessage: vi.fn<(message: ModuleDecodeResponse) => void>()
};
let core: OpenMptCore;
beforeAll(async () => {
  core = await realOpenMpt();
  initialize.mockResolvedValue(core);
  vi.stubGlobal('self', worker);
  // Worker scope deliberately has no AudioContext.
  vi.stubGlobal('AudioContext', undefined);
  await import('./decoder.worker');
});
afterAll(() => vi.unstubAllGlobals());

async function flush() { for (let index = 0; index < 24; index++) await Promise.resolve(); }

describe('background decoding with real WASM', () => {
  it('validates and parses a batch without rendering audio or formatting grids', async () => {
    const render = vi.spyOn(core, '_openmpt_module_read_float_stereo');
    const format = vi.spyOn(core, '_openmpt_module_format_pattern_row_channel');
    const destroy = vi.spyOn(core, '_openmpt_module_ext_destroy');
    worker.onmessage?.({ data: { id: 1, buffer: toneModule(), mode: 'verify', subsong: 0 } });
    worker.onmessage?.({ data: { id: 2, buffer: new ArrayBuffer(8), mode: 'verify', subsong: 0 } });
    worker.onmessage?.({ data: { id: 3, buffer: toneModule(true), mode: 'metadata', subsong: 1 } });
    await flush();
    expect(worker.postMessage.mock.calls.map(([response]) => response)).toEqual([
      { id: 1, accepted: true },
      { id: 2, error: expect.stringContaining('failed to decode') },
      { id: 3, accepted: true, inspection: expect.objectContaining({ subsong: 1, metadata: expect.objectContaining({ channels: 4, subsongs: 2 }) }) }
    ]);
    expect(render).not.toHaveBeenCalled();
    expect(format).not.toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(2);
    vi.restoreAllMocks();
  });
});
