import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AHX AudioWorklet', () => {
  it('decodes tune titles without TextDecoder in the worklet global', () => {
    let Processor: (new () => { exports: { memory: { buffer: ArrayBuffer } }; readString: (pointer: number) => string }) | undefined;
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
    const player = new (Processor as NonNullable<typeof Processor>)();
    const bytes = new Uint8Array([0, 0x53, 0x69, 0x44, 0x56, 0x69, 0x42, 0x45, 0x53, 0x21, 0]);
    player.exports = { memory: { buffer: bytes.buffer } };
    expect(player.readString(1)).toBe('SiDViBES!');
  });
});
