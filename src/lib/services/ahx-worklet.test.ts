import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

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
      seek: (seconds: number) => void;
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

  it('keeps pattern-boundary seconds on their exact Hively frame', () => {
    const Processor = loadProcessor();
    const player = new Processor();
    let frame = -1;
    player.exports = {
      memory: { buffer: new ArrayBuffer(8) },
      ahx_duration_frames: () => 100,
      ahx_seek_frame: (target: number) => { frame = target; },
      ahx_current_frame: () => frame,
      ahx_current_order: () => 1,
      ahx_current_row: () => 0,
      ahx_subsong_count: () => 1
    };
    player.seek(0.58);
    expect(frame).toBe(29);
    player.seek(0.579);
    expect(frame).toBe(28);
  });

  it.each([
    ['ahx', 1], ['hvl', 1], ['ahx', 0.25], ['hvl', 0.25], ['ahx', 4], ['hvl', 4]
  ] as const)('recovers %s playback at %ix tempo after natural and seeked endings', async (format, tempoFactor) => {
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
      tempoFactor, pitchFactor: 2,
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
    let blocks = 0;
    for (; blocks < 1000 && player.playing; blocks++) render();
    expect(player.playing).toBe(false);
    expect(blocks).toBe(Math.floor(progress().duration * 48_000 / tempoFactor / 128) + 1);
    expect(progress().currentTime).toBeCloseTo(progress().duration, 10);
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

  it('forwards live tempo and pitch without flushing buffered audio', async () => {
    const player = new (loadProcessor())();
    const setFactors = vi.fn();
    player.exports = {
      memory: { buffer: new ArrayBuffer(0) },
      ahx_set_playback_factors: setFactors
    };
    player.playing = true;
    await player.handleMessage({ type: 'playback-factors', tempoFactor: 0.25, pitchFactor: 4 });
    expect(setFactors).toHaveBeenCalledWith(0.25, 4);
    expect(player.playing).toBe(true);
    expect(player.port.messages).toEqual([]);
  });

  it.each([240, 3840])('keeps song time and wall-clock progress cadence separate for %i-sample frames', async (frameSamples) => {
    const player = new (loadProcessor())();
    let frame = 0;
    player.exports = {
      memory: { buffer: new ArrayBuffer(frameSamples * 4) },
      ahx_decode_frame: () => { frame++; return 1; },
      ahx_frame_samples: () => frameSamples,
      ahx_mix_buffer: () => 0,
      ahx_current_frame: () => frame,
      ahx_ended: () => 0,
      ahx_current_order: () => 0,
      ahx_current_row: () => 0,
      ahx_duration_frames: () => 1000,
      ahx_subsong_count: () => 1
    };
    await player.handleMessage({ type: 'play' });
    const render = () => player.process([], [[new Float32Array(128), new Float32Array(128)]]);
    for (let block = 0; block < 46; block++) render();
    expect(player.port.messages.filter((message) => (message as { type: string }).type === 'progress')).toHaveLength(0);
    render();
    const progress = player.port.messages.filter((message) =>
      (message as { type: string }).type === 'progress') as { currentTime: number; duration: number }[];
    expect(progress).toHaveLength(1);
    expect(progress[0].currentTime).toBeCloseTo(6016 / frameSamples / 50, 10);
    expect(progress[0].duration).toBe(20);
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
