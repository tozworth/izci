import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { OpenMptCore } from './openmpt/abi';
import { realOpenMpt, toneModule } from './openmpt/test-fixtures';
import { OpenMptModule } from './openmpt/module';
import { DEFAULT_OPENMPT_SETTINGS } from './openmpt/protocol';

const initialize = vi.hoisted(() => vi.fn());
vi.mock('./openmpt/runtime', () => ({ initializeOpenMpt: initialize }));
import { renderModulePcm, streamModulePcm } from './module-render-core';

let core: OpenMptCore;
beforeAll(async () => { core = await realOpenMpt(); initialize.mockResolvedValue(core); });

describe('Editor and Multiplayer module rendering', () => {
  const request = { type: 'render' as const, extension: 'mod', hivelyWasmUrl: '', sampleRate: 48_000 };
  it('uses the selected subsong and the same PCM as the playback bindings', async () => {
    const buffer = toneModule(true);
    const reference = new OpenMptModule(core, buffer, 1);
    const left: number[] = [];
    try {
      reference.configure(DEFAULT_OPENMPT_SETTINGS);
      while (reference.read(48_000, 16_384, (chunk) => { for (const sample of chunk) left.push(sample); })) { /* collect */ }
    } finally { reference.dispose(); }
    const result = await renderModulePcm({ ...request, module: buffer, subsong: 1 });
    expect(result[0]).toEqual(new Float32Array(left));
    expect(result[0].length).toBeGreaterThan(0);
  });

  it('streams owned chunks and releases the module when a consumer cancels', async () => {
    const destroy = vi.spyOn(core, '_openmpt_module_ext_destroy');
    const chunks: Float32Array[] = [];
    await expect(streamModulePcm({ ...request, module: toneModule() }, ({ left }) => {
      chunks.push(left);
      if (chunks.length === 2) throw new Error('consumer canceled');
    })).rejects.toThrow('consumer canceled');
    expect(destroy).toHaveBeenCalledOnce();
    expect(chunks[0].buffer).not.toBe(core.HEAPF32.buffer);
    expect(chunks[0].buffer).not.toBe(chunks[1].buffer);
    destroy.mockRestore();
  });
});
