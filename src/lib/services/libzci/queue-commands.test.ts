import { describe, expect, it } from 'vitest';
import {
  buildAppendCommand,
  buildCheckpointCommand,
  buildClearUpNextCommand,
  buildMuteCommand,
  buildMoveCommand,
  buildNextCommand,
  buildPlayCommand,
  buildPreviousCommand,
  buildRemoveCommand,
  buildSettingsCommand,
  buildUpNextCommand,
  buildVolumeCommand,
  coreQueueSettingsForInput,
  coreRepeatForMode,
  makeQueueRequestId,
  serializeQueueCommand,
  sourceKindForTrack,
  sourceReferenceForTrack,
  validateQueueRequestId,
  validateSourceReference
} from './queue-commands';
import type { TrackItem } from '$lib/types';

function track(overrides: Partial<TrackItem> = {}): TrackItem {
  return {
    id: 'track-1',
    name: 'one.mp3',
    extension: 'mp3',
    kind: 'stream',
    size: 1,
    lastModified: 1,
    ...overrides
  };
}

describe('core queue command boundary', () => {
  it('classifies Svelte tracks without persisting handles', () => {
    expect(sourceKindForTrack(track())).toBe('ephemeral');
    expect(sourceKindForTrack(track({ fileHandle: {} as FileSystemFileHandle }))).toBe('browser_handle');
    expect(sourceKindForTrack(track({ nativeFile: { uri: 'file:///music/one.mp3' } }))).toBe('native_path');
  });

  it('builds stable source references with bounded text', () => {
    const reference = sourceReferenceForTrack(track({ id: 'abc', name: 'one.mp3', path: '/music/one.mp3' }));
    expect(reference).toEqual({
      key: 'svelte/abc',
      kind: 'ephemeral',
      locator: 'svelte/abc',
      display_path: '/music/one.mp3'
    });
    expect(() => validateSourceReference({ ...reference, key: '' })).toThrow();
    expect(() =>
      validateSourceReference({ ...reference, display_path: 'x'.repeat(8193) })
    ).toThrow();
  });

  it('uses native URIs as locators for native tracks', () => {
    const reference = sourceReferenceForTrack(
      track({ id: 'n1', name: 'a.mp3', nativeFile: { uri: 'file:///music/a.mp3' } })
    );
    expect(reference.kind).toBe('native_path');
    expect(reference.locator).toBe('file:///music/a.mp3');
  });

  it('pins the append wire shape with a shared staging prefix', () => {
    const command = buildAppendCommand([track({ id: 'a' }), track({ id: 'b' })], 'req-1');
    expect(command).toEqual({
      kind: 'append',
      sources: [
        { key: 'req-1/0', kind: 'ephemeral', locator: 'req-1/0', display_path: 'one.mp3' },
        { key: 'req-1/1', kind: 'ephemeral', locator: 'req-1/1', display_path: 'one.mp3' }
      ]
    });
    expect(JSON.parse(serializeQueueCommand(command))).toEqual(command);
    expect(() => buildAppendCommand([])).toThrow();
  });

  it('pins 1:1 navigation commands to the Rust snake_case envelope', () => {
    expect(buildPlayCommand(3)).toEqual({ kind: 'play', id: 3 });
    expect(buildRemoveCommand(3)).toEqual({ kind: 'remove', id: 3 });
    expect(buildUpNextCommand(3)).toEqual({ kind: 'up_next', id: 3 });
    expect(buildMoveCommand(3, 0)).toEqual({ kind: 'move', id: 3, index: 0 });
    expect(buildNextCommand(true)).toEqual({ kind: 'next', ended: true });
    expect(buildPreviousCommand(1.5)).toEqual({ kind: 'previous', position_seconds: 1.5 });
    expect(buildClearUpNextCommand()).toEqual({ kind: 'clear_up_next' });
    expect(buildCheckpointCommand(2.5, null)).toEqual({
      kind: 'checkpoint',
      position_seconds: 2.5,
      subsong: null
    });
    expect(buildVolumeCommand(0.5)).toEqual({ kind: 'volume', volume: 0.5 });
    expect(buildMuteCommand(true)).toEqual({ kind: 'mute', mute: true });

    expect(() => buildPlayCommand(0)).toThrow();
    expect(() => buildMoveCommand(1, -1)).toThrow();
    expect(() => buildPreviousCommand(Number.NaN)).toThrow();
    expect(() => buildVolumeCommand(2)).toThrow();
  });

  it('maps Svelte settings to the core settings row', () => {
    const settings = coreQueueSettingsForInput({
      shuffle: true,
      repeatMode: 'all',
      previousRestartSeconds: 3,
      volume: 0.8,
      mute: false,
      replayGainMode: 'track',
      replayGainPreampDb: 0,
      playCountEnabled: true,
      playCountThresholdSeconds: 15
    });
    expect(settings).toEqual({
      shuffle: true,
      repeat: 'all',
      previous_restart_seconds: 3,
      volume: 0.8,
      mute: false,
      replay_gain: {
        mode: 'track',
        fallback: true,
        preamp_db: 0,
        missing_gain_db: 0,
        r128_target_lufs: -18,
        prevent_clipping: true
      },
      play_counts: { enabled: true, threshold_seconds: 15 }
    });
    expect(coreRepeatForMode('one')).toBe('one');
    expect(() => coreRepeatForMode('bogus' as never)).toThrow();
    expect(buildSettingsCommand(settings)).toEqual({ kind: 'settings', settings });
  });

  it('issues bounded durable request ids', () => {
    const id = makeQueueRequestId('append');
    expect(id.endsWith('/append')).toBe(true);
    validateQueueRequestId(id);
    expect(() => validateQueueRequestId('')).toThrow();
    expect(() => validateQueueRequestId('x'.repeat(257))).toThrow();
  });
});
