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
      playing: boolean;
      process: (inputs: unknown[], outputs: Float32Array[][]) => boolean;
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

  it.each(['ahx', 'hvl'])('recovers %s playback after natural and seeked endings', async (format) => {
    const Processor = loadProcessor();
    const player = new Processor();
    // One blank row, four channels, no instruments: exercise the real replay core.
    const headerLength = format === 'hvl' ? 16 : 14;
    const namesOffset = headerLength + 8;
    const module = new Uint8Array(namesOffset + 5);
    module.set(new TextEncoder().encode(format === 'hvl' ? 'HVL' : 'THX'));
    module[3] = 1;
    new DataView(module.buffer).setUint16(4, namesOffset);
    module[6] = 0x80;
    module[7] = 1;
    module[10] = 1;
    module.set(new TextEncoder().encode('End\0'), namesOffset);
    await player.handleMessage({
      type: 'load', format, module: module.buffer,
      wasm: readFileSync('public/vendor/hively-replay.wasm')
    });
    expect(player.port.messages).not.toContainEqual(expect.objectContaining({ type: 'error' }));
    const output = [[new Float32Array(128), new Float32Array(128)]];
    const render = () => player.process([], output);
    const endedCount = () => player.port.messages.filter((message) =>
      (message as { type: string }).type === 'ended').length;
    const progress = () => player.port.messages.filter((message) =>
      (message as { type: string }).type === 'progress').at(-1) as { currentTime: number; duration: number };

    await player.handleMessage({ type: 'play' });
    for (let block = 0; block < 1000 && player.playing; block++) render();
    expect(player.playing).toBe(false);
    expect(endedCount()).toBe(1);
    render();
    expect(endedCount()).toBe(1);

    await player.handleMessage({ type: 'play' });
    expect(progress().currentTime).toBe(0);
    render();
    expect(player.playing).toBe(true);

    await player.handleMessage({ type: 'seek', seconds: progress().duration });
    render();
    expect(player.playing).toBe(false);
    expect(endedCount()).toBe(2);
    await player.handleMessage({ type: 'play' });
    expect(progress().currentTime).toBe(0);
    render();
    expect(player.playing).toBe(true);

    await player.handleMessage({ type: 'seek', seconds: progress().duration });
    render();
    await player.handleMessage({ type: 'seek', seconds: 0.04 });
    await player.handleMessage({ type: 'play' });
    expect(progress().currentTime).toBe(0.04);
    render();
    await player.handleMessage({ type: 'pause' });
    const pausedTime = progress().currentTime;
    await player.handleMessage({ type: 'play' });
    await player.handleMessage({ type: 'pause' });
    expect(progress().currentTime).toBe(pausedTime);
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

  it('applies channel masks and clears any channels missing from a later mask', async () => {
    const Processor = loadProcessor();
    const player = new Processor();
    const mutes: number[][] = [];
    player.exports = {
      memory: { buffer: new ArrayBuffer(0) },
      ahx_channel_count: () => 4,
      ahx_set_channel_mute: (channel: number, muted: number) => mutes.push([channel, muted])
    };
    await player.handleMessage({ type: 'channel-mutes', muted: [false, true, true, false] });
    expect(mutes).toEqual([[0, 0], [1, 1], [2, 1], [3, 0]]);
    mutes.length = 0;
    await player.handleMessage({ type: 'channel-mutes', muted: [] });
    expect(mutes).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
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
