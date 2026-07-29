import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AHX AudioWorklet', () => {
  function loadProcessor() {
    let Processor: (new () => {
      exports: ({
        memory: { buffer: ArrayBuffer };
        ahx_set_interpolation?: (filter: number) => void;
        [key: string]: unknown;
      } | null);
      handleMessage: (message: unknown) => Promise<void>;
      port: { messages: unknown[] };
      publishPatternData: () => void;
      publishPatternProgress: (force?: boolean) => void;
      readString: (pointer: number) => string;
    }) | undefined;
    class MockAudioWorkletProcessor {
      port = {
        messages: [] as unknown[],
        onmessage: null,
        postMessage: (message: unknown) => { this.port.messages.push(message); }
      };
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

  it('publishes compact pattern data and deduplicated playback positions', () => {
    const Processor = loadProcessor();
    const player = new Processor();
    const memory = new Uint8Array(16);
    memory.set([0x4c, 0x65, 0x61, 0x64, 0], 1);
    player.exports = {
      memory: { buffer: memory.buffer },
      ahx_channel_count: () => 1,
      ahx_order_count: () => 1,
      ahx_track_count: () => 1,
      ahx_track_length: () => 1,
      ahx_instrument_count: () => 1,
      ahx_position_track: () => 0,
      ahx_position_transpose: () => -12,
      ahx_step_note: () => 25,
      ahx_step_instrument: () => 1,
      ahx_step_effect: () => 0xf,
      ahx_step_effect_param: () => 3,
      ahx_instrument_name: () => 1,
      ahx_subsong_count: () => 2,
      ahx_current_order: () => 4,
      ahx_current_row: () => 12
    };

    player.publishPatternData();
    player.publishPatternProgress();
    player.publishPatternProgress();

    expect(player.port.messages).toHaveLength(2);
    expect(player.port.messages[0]).toMatchObject({
      type: 'pattern-data',
      data: {
        channelCount: 1,
        instrumentNames: ['Lead'],
        positionCount: 1,
        positionTracks: new Uint8Array([0]),
        positionTransposes: new Int8Array([-12]),
        steps: new Uint8Array([25, 1, 0xf, 3]),
        subsongCount: 2,
        trackCount: 1,
        trackLength: 1
      }
    });
    expect(player.port.messages[1]).toEqual({ type: 'pattern-progress', order: 4, row: 12 });
  });
});
