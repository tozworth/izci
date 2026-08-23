import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

interface WorkletPlayer {
  meta: () => void;
  play(buffer: ArrayBuffer): void;
  stop(): void;
}

interface MockOpenMpt {
  HEAPU8: { set: ReturnType<typeof vi.fn> };
  _free: ReturnType<typeof vi.fn>;
  _malloc: ReturnType<typeof vi.fn>;
  _openmpt_module_create_from_memory: ReturnType<typeof vi.fn>;
  _openmpt_module_destroy: ReturnType<typeof vi.fn>;
  _openmpt_module_set_render_param: ReturnType<typeof vi.fn>;
  _openmpt_module_set_repeat_count: ReturnType<typeof vi.fn>;
}

function createCore(modulePointer: number): MockOpenMpt {
  let nextAllocation = 100;
  return {
    HEAPU8: { set: vi.fn() },
    _free: vi.fn(),
    _malloc: vi.fn(() => {
      const pointer = nextAllocation;
      nextAllocation += 100;
      return pointer;
    }),
    _openmpt_module_create_from_memory: vi.fn(() => modulePointer),
    _openmpt_module_destroy: vi.fn(),
    _openmpt_module_set_render_param: vi.fn(),
    _openmpt_module_set_repeat_count: vi.fn()
  };
}

function loadPlayer(core: MockOpenMpt): WorkletPlayer {
  let Processor: (new () => WorkletPlayer) | undefined;
  class MockAudioWorkletProcessor {
    port = {
      onmessage: null,
      postMessage: vi.fn()
    };
  }

  const source = readFileSync('src/lib/vendor/chiptune3/chiptune3.worklet.js', 'utf8');
  const processorSource = source.slice(source.indexOf('class MPT'));
  const loadWorklet = new Function(
    'AudioWorkletProcessor',
    'registerProcessor',
    'sampleRate',
    'libopenmpt',
    'OPENMPT_MODULE_RENDER_STEREOSEPARATION_PERCENT',
    'OPENMPT_MODULE_RENDER_INTERPOLATIONFILTER_LENGTH',
    processorSource
  );
  loadWorklet(
    MockAudioWorkletProcessor,
    (_name: string, value: typeof Processor) => { Processor = value; },
    48_000,
    core,
    2,
    3
  );

  expect(Processor).toBeDefined();
  const player = new (Processor as NonNullable<typeof Processor>)();
  player.meta = vi.fn();
  return player;
}

describe('Chiptune3 AudioWorklet allocation ownership', () => {
  it('frees module input and render buffers exactly once on stop and replay', () => {
    const core = createCore(900);
    const player = loadPlayer(core);

    player.play(new Uint8Array([1, 2, 3]).buffer);
    expect(core._malloc).toHaveBeenCalledTimes(3);

    player.stop();
    expect(core._openmpt_module_destroy).toHaveBeenCalledOnce();
    expect(core._free.mock.calls.map(([pointer]) => pointer)).toEqual([200, 300, 100]);

    player.stop();
    expect(core._free).toHaveBeenCalledTimes(3);

    player.play(new Uint8Array([4, 5, 6]).buffer);
    player.stop();
    expect(core._openmpt_module_destroy).toHaveBeenCalledTimes(2);
    expect(core._free.mock.calls.map(([pointer]) => pointer)).toEqual([
      200, 300, 100,
      500, 600, 400
    ]);
  });

  it('frees the module input when OpenMPT rejects the file', () => {
    const core = createCore(0);
    const player = loadPlayer(core);

    player.play(new Uint8Array([1]).buffer);

    expect(core._malloc).toHaveBeenCalledOnce();
    expect(core._openmpt_module_destroy).not.toHaveBeenCalled();
    expect(core._free).toHaveBeenCalledExactlyOnceWith(100);
  });
});
