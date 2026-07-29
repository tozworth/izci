import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AHX AudioWorklet', () => {
  function loadProcessor() {
    let Processor: (new () => {
      exports: {
        memory: { buffer: ArrayBuffer };
        ahx_set_interpolation?: (filter: number) => void;
      } | null;
      handleMessage: (message: unknown) => Promise<void>;
      readString: (pointer: number) => string;
    }) | undefined;
    class MockAudioWorkletProcessor {
      port = { onmessage: null, postMessage: () => undefined };
    }

    const loadWorklet = new Function(
      'AudioWorkletProcessor',
      'registerProcessor',
      'sampleRate',
      'TextDecoder',
      readFileSync('public/vendor/ahx-worklet.js').toString()
    );
    loadWorklet(
      MockAudioWorkletProcessor,
      (_name: string, value: typeof Processor) => { Processor = value; },
      48_000,
      undefined
    );

    expect(Processor).toBeDefined();
    return Processor as NonNullable<typeof Processor>;
  }

  it('decodes tune titles without TextDecoder in the worklet global', () => {
    const Processor = loadProcessor();
    const player = new (Processor as NonNullable<typeof Processor>)();
    const bytes = new Uint8Array([0, 0x53, 0x69, 0x44, 0x56, 0x69, 0x42, 0x45, 0x53, 0x21, 0]);
    player.exports = { memory: { buffer: bytes.buffer } };
    expect(player.readString(1)).toBe('SiDViBES!');
  });

  it('applies interpolation changes while playing', async () => {
    const Processor = loadProcessor();
    const player = new Processor();
    const filters: number[] = [];
    player.exports = {
      memory: { buffer: new ArrayBuffer(0) },
      ahx_set_interpolation: (filter) => filters.push(filter)
    };

    await player.handleMessage({ type: 'interpolation', filter: 8 });

    expect(filters).toEqual([8]);
  });
});
