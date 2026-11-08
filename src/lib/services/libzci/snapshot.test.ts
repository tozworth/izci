import { describe, expect, it } from 'vitest';
import type { CoreSnapshot } from './protocol';
import { coreTimeSeconds, mapCoreSnapshot, mapCoreState, mapModulePosition } from './snapshot';

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

  it('maps module provider snapshots to the module backend with subsong facts', () => {
    const snapshot = mapCoreSnapshot(
      core({
        state: 'Playing',
        position_frames: 48000,
        total_frames: 192000,
        provider: { id: 'org.openmpt.libopenmpt', version: 'libopenmpt-0.8.4/m1', name: 'libopenmpt' },
        subsong: 2,
        capabilities: { subsongs: 3, channels: 4 }
      }),
      'module'
    );
    expect(snapshot).toEqual({
      state: 'playing',
      currentTime: 1,
      duration: 4,
      backend: 'module',
      subsong: 2,
      subsongCount: 3,
      error: undefined
    });
    expect(
      mapCoreSnapshot(
        core({
          state: 'Ready',
          provider: { id: 'hivelytracker.replay', version: 'hivelytracker-f393ca7/m1', name: 'HivelyTracker' },
          subsong: 0,
          capabilities: { subsongs: 1, channels: 4 }
        })
      ).backend
    ).toBe('module');
  });

  it('maps live module order/pattern/row observations', () => {
    expect(
      mapModulePosition(
        core({
          module: { selected_subsong: 0, order: 3, pattern: 5, row: 12, first_row: 8, rows: 16, channels: 4, cells: [] }
        })
      )
    ).toEqual({ order: 3, pattern: 5, row: 12 });
    expect(mapModulePosition(core({}))).toBeNull();
  });
});
