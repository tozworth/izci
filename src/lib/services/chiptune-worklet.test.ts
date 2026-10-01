import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

interface WorkletPlayer {
  meta: () => void;
  initializeChannelMute: () => void;
  play(buffer: ArrayBuffer): void;
  stop(): void;
  modulePtr: number;
  handleMessage_(message: { data: { cmd: string; val?: unknown } }): void;
  process(inputs: unknown[], outputs: Float32Array[][]): boolean;
}

interface MockOpenMpt {
  HEAPU8: { set: ReturnType<typeof vi.fn> };
  _free: ReturnType<typeof vi.fn>;
  _malloc: ReturnType<typeof vi.fn>;
  _openmpt_module_ext_create_from_memory: ReturnType<typeof vi.fn>;
  _openmpt_module_ext_get_module: ReturnType<typeof vi.fn>;
  _openmpt_module_ext_destroy: ReturnType<typeof vi.fn>;
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
    _openmpt_module_ext_create_from_memory: vi.fn(() => modulePointer),
    _openmpt_module_ext_get_module: vi.fn(() => modulePointer + 1),
    _openmpt_module_ext_destroy: vi.fn(),
    _openmpt_module_set_render_param: vi.fn(),
    _openmpt_module_set_repeat_count: vi.fn()
  };
}

function loadPlayer(core: unknown, stubInterface = true): WorkletPlayer {
  let Processor: (new () => WorkletPlayer) | undefined;
  class MockAudioWorkletProcessor {
    port = {
      onmessage: null,
      postMessage: vi.fn()
    };
  }

  const source = readFileSync('src/lib/vendor/chiptune3/chiptune3.worklet.js', 'utf8');
  const processorSource = source.slice(source.indexOf('function asciiToStack'));
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
  if (stubInterface) player.initializeChannelMute = vi.fn();
  return player;
}

describe('Chiptune3 AudioWorklet allocation ownership', () => {
  it('frees module input and render buffers exactly once on stop and replay', () => {
    const core = createCore(900);
    const player = loadPlayer(core);

    player.play(new Uint8Array([1, 2, 3]).buffer);
    expect(core._malloc).toHaveBeenCalledTimes(3);

    player.stop();
    expect(core._openmpt_module_ext_destroy).toHaveBeenCalledExactlyOnceWith(900);
    expect(core._free.mock.calls.map(([pointer]) => pointer)).toEqual([200, 300, 100]);

    player.stop();
    expect(core._free).toHaveBeenCalledTimes(3);

    player.play(new Uint8Array([4, 5, 6]).buffer);
    player.stop();
    expect(core._openmpt_module_ext_destroy).toHaveBeenCalledTimes(2);
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
    expect(core._openmpt_module_ext_destroy).not.toHaveBeenCalled();
    expect(core._free).toHaveBeenCalledExactlyOnceWith(100);
  });
});

describe('Chiptune3 channel audio', () => {
  function toneModule(): ArrayBuffer {
    const bytes = new Uint8Array(1084 + 1024 + 1024);
    const view = new DataView(bytes.buffer);
    view.setUint16(42, 512); // Sample 1: 1024 bytes, looped sine wave.
    bytes[45] = 64;
    view.setUint16(48, 512);
    bytes[950] = 1;
    bytes.set(new TextEncoder().encode('M.K.'), 1080);
    bytes.set([1, 172, 0x10, 0], 1084); // C-3, sample 1, channel 1 only.
    for (let index = 0; index < 1024; index++) {
      bytes[2108 + index] = Math.round(Math.sin(index * Math.PI / 16) * 96) & 0xff;
    }
    return bytes.buffer;
  }

  it('mutes real OpenMPT audio and restores it after seeking and restarting', async () => {
    const runtimePath = new URL('../vendor/chiptune3/libopenmpt.worklet.js', import.meta.url).href;
    const { default: initialize } = await import(/* @vite-ignore */ runtimePath);
    const core = await initialize();
    const player = loadPlayer(core, false);
    const buffer = toneModule();
    const renderEnergy = () => {
      let energy = 0;
      for (let chunk = 0; chunk < 32; chunk++) {
        const output = [new Float32Array(128), new Float32Array(128)];
        player.process([], [output]);
        if (chunk > 3) for (const channel of output) for (const sample of channel) energy += sample * sample;
      }
      return energy;
    };
    try {
      player.play(buffer);
      expect(renderEnergy()).toBeGreaterThan(0.1);
      player.handleMessage_({ data: { cmd: 'setChannelMutes', val: [true, false, false, false] } });
      renderEnergy(); // libopenmpt updates the mixer on its next tick, then ramps down.
      expect(renderEnergy()).toBeLessThan(1e-10);
      player.handleMessage_({ data: { cmd: 'setPos', val: 0 } });
      expect(renderEnergy()).toBeLessThan(1e-10);
      player.handleMessage_({ data: { cmd: 'setChannelMutes', val: [] } });
      expect(renderEnergy()).toBeGreaterThan(0.1);
      player.stop();
      player.play(buffer);
      expect(renderEnergy()).toBeGreaterThan(0.1);
    } finally {
      player.stop();
    }
  });
});
