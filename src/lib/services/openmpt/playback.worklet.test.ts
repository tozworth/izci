import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OpenMptEvent } from './protocol';
import { DEFAULT_OPENMPT_SETTINGS } from './protocol';
import { realOpenMpt, toneModule } from './test-fixtures';

const initialize = vi.hoisted(() => vi.fn());
vi.mock('./runtime', () => ({ initializeOpenMpt: initialize }));

let Processor: typeof import('./playback.worklet').OpenMptProcessor;
beforeAll(async () => {
  initialize.mockResolvedValue(await realOpenMpt());
  vi.stubGlobal('sampleRate', 48_000);
  vi.stubGlobal('AudioWorkletProcessor', class {
    port = { onmessage: null, postMessage: vi.fn(), close: vi.fn() };
  });
  vi.stubGlobal('registerProcessor', vi.fn());
  Processor = (await import('./playback.worklet')).OpenMptProcessor;
});
afterAll(() => vi.unstubAllGlobals());

async function create() {
  const processor = new Processor();
  await Promise.resolve();
  const post = vi.mocked(processor.port.postMessage);
  expect(post).toHaveBeenCalledWith({ type: 'ready' });
  processor.command({ type: 'load', id: 1, buffer: toneModule(), subsong: 0, settings: DEFAULT_OPENMPT_SETTINGS });
  return { processor, post };
}

describe('custom playback worklet with real WASM', () => {
  it('loads paused, resumes and seeks without leaking paused audio', async () => {
    const { processor } = await create();
    const render = () => {
      const channels = [new Float32Array(128), new Float32Array(128)];
      processor.process([], [channels]);
      return channels.reduce((energy, channel) => energy + channel.reduce((sum, value) => sum + value * value, 0), 0);
    };
    try {
      expect(render()).toBe(0);
      processor.command({ type: 'play' });
      let energy = 0;
      for (let frame = 0; frame < 50; frame++) energy += render();
      expect(energy).toBeGreaterThan(0.1);
      processor.command({ type: 'pause' });
      processor.command({ type: 'seek', seconds: 2 });
      expect(render()).toBe(0);
      processor.command({ type: 'play' });
      expect(render()).toBeGreaterThan(0);
    } finally { processor.command({ type: 'dispose' }); }
    expect(processor.process([], [[]])).toBe(false);
  });

  it('emits ended once, can restart, and limits progress delivery', async () => {
    const { processor, post } = await create();
    const events = () => post.mock.calls.map(([event]) => event as OpenMptEvent);
    try {
      processor.command({ type: 'play' });
      for (let frame = 0; frame < 4000; frame++) processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
      expect(events().filter((event) => event.type === 'ended')).toHaveLength(1);
      expect(events().filter((event) => event.type === 'progress').length).toBeLessThan(400);
      processor.command({ type: 'play' });
      const channels = [new Float32Array(128), new Float32Array(128)];
      processor.process([], [channels]);
      expect(channels[0].some((value) => value !== 0)).toBe(true);
    } finally { processor.command({ type: 'dispose' }); }
  });
});
