import { describe, expect, it } from 'vitest';
import type { CoreSnapshot } from './protocol';
import { coreTimeSeconds, mapCoreSnapshot, mapCoreState } from './snapshot';

function core(overrides: Partial<CoreSnapshot> = {}): CoreSnapshot {
  return {
    session: 1,
    revision: 1,
    generation: 1,
    state: 'Ready',
    requested: 'Held',
    running: 'Suspended',
    position_frames: 0,
    consumed_frames: 0,
    output_rate: 48000,
    total_frames: 96000,
    sample_rate: 48000,
    provider: null,
    volume: 1,
    mute: false,
    decoding_eof: false,
    pending_operation: false,
    error: null,
    tag: { session: 1, instance: 1, operation: 1, generation: 1 },
    ...overrides
  };
}

describe('libzci playback snapshot mapping', () => {
  it('maps core transport states to the Svelte playback vocabulary', () => {
    expect(mapCoreState('Idle')).toBe('idle');
    expect(mapCoreState('Loading')).toBe('loading');
    expect(mapCoreState('Ready')).toBe('paused');
    expect(mapCoreState('Playing')).toBe('playing');
    expect(mapCoreState('Ended')).toBe('ended');
    expect(mapCoreState('Failed')).toBe('error');
    expect(mapCoreState('OutputSuspended')).toBe('paused');
  });

  it('converts core frames using the provider rate without a UI timer', () => {
    expect(coreTimeSeconds(48000, 48000)).toBe(1);
    expect(coreTimeSeconds(24000, 48000)).toBe(0.5);
    expect(coreTimeSeconds(100, null)).toBeCloseTo(100 / 48000);
    expect(coreTimeSeconds(-10, 48000)).toBe(0);
  });

  it('maps a complete core snapshot to playback state', () => {
    expect(mapCoreSnapshot(core({ state: 'Playing', position_frames: 24000, total_frames: 96000 }))).toEqual({
      state: 'playing',
      currentTime: 0.5,
      duration: 2,
      backend: 'stream',
      error: undefined
    });
    expect(mapCoreSnapshot(core({ state: 'Failed', error: 'decoder failed' })).error).toBe('decoder failed');
  });
});
