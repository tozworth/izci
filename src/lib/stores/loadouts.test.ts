import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MODULE_PLAYBACK_SETTINGS } from './module-playback-settings';
import { DEFAULT_LOADOUT_STATE, loadouts, normalizeLoadoutState } from './loadouts';

const playback = {
  playbackRate: 1,
  trueSpeed: false,
  replayGainMode: 'off' as const,
  modules: { ...DEFAULT_MODULE_PLAYBACK_SETTINGS }
};

afterEach(() => loadouts.reset());

describe('loadout persistence normalization', () => {
  it('defaults automatic loading on and rejects malformed or empty loadouts', () => {
    expect(normalizeLoadoutState(null)).toEqual(DEFAULT_LOADOUT_STATE);
    expect(normalizeLoadoutState({ loadouts: [{ id: 'bad', name: '', target: {}, settings: {} }] })).toEqual({
      automaticEnabled: true,
      loadouts: []
    });
  });

  it('moves loadouts by stable ID and clamps the destination', () => {
    const settings = { playback };
    const first = loadouts.create('First', { type: 'preset' }, settings)!;
    const second = loadouts.create('Second', { type: 'preset' }, settings)!;
    const third = loadouts.create('Third', { type: 'preset' }, settings)!;

    loadouts.move(third.id, 0);
    expect(loadouts.getSnapshot().loadouts.map((loadout) => loadout.id)).toEqual([
      third.id,
      first.id,
      second.id
    ]);

    loadouts.move(third.id, 99);
    expect(loadouts.getSnapshot().loadouts.map((loadout) => loadout.id)).toEqual([
      first.id,
      second.id,
      third.id
    ]);
  });

  it('normalizes captured settings at their owning store boundaries', () => {
    const state = normalizeLoadoutState({
      automaticEnabled: false,
      loadouts: [{
        id: 'one',
        name: 'XM',
        target: { type: 'type', recognizedType: 'XM' },
        settings: {
          playback: {
            playbackRate: 99,
            trueSpeed: true,
            replayGainMode: 'wat',
            modules: { repeatCount: -99, interpolationFilter: 7 }
          },
          raf: { presetName: '  Clean  ', enabled: false },
        },
        createdAt: 10,
        updatedAt: 20
      }]
    });

    expect(state.automaticEnabled).toBe(false);
    expect(state.loadouts[0].target).toEqual({ type: 'type', recognizedType: 'xm' });
    expect(state.loadouts[0].settings.playback).toEqual({
      playbackRate: 2,
      trueSpeed: true,
      replayGainMode: 'track',
      modules: {
        ...DEFAULT_MODULE_PLAYBACK_SETTINGS,
        repeatCount: -1,
        interpolationFilter: 1
      }
    });
    expect(state.loadouts[0].settings.raf).toEqual({ presetName: 'Clean', enabled: false });
  });

  it('persists only predefined colors and supports renaming and clearing colors', () => {
    const settings = { playback };
    const created = loadouts.create('Original', { type: 'preset' }, settings)!;

    expect(loadouts.rename(created.id, '  Renamed  ')?.name).toBe('Renamed');
    expect(loadouts.setColor(created.id, 'white')?.color).toBe('white');
    expect(loadouts.setColor(created.id)?.color).toBeUndefined();
    expect(normalizeLoadoutState({
      loadouts: [{ ...created, color: 'chartreuse' }]
    }).loadouts[0].color).toBeUndefined();
  });

  it('preserves a legacy file loadout name as its source when renaming', () => {
    const settings = { playback };
    const created = loadouts.create('Track.flac', { type: 'file', fileKey: 'track.flac:1:2' }, settings)!;

    expect(loadouts.rename(created.id, 'Headphones')?.target).toEqual({
      type: 'file',
      fileKey: 'track.flac:1:2',
      fileName: 'Track.flac'
    });
  });

  it('retains a custom icon and color through normalization, rename, settings updates, and reorder', () => {
    const created = loadouts.create('Headphones', { type: 'file', fileKey: 'track:1' }, { playback })!;
    loadouts.setColor(created.id, 'cyan');
    loadouts.setIcon(created.id, 'headphones');
    loadouts.rename(created.id, 'Listening');
    loadouts.updateSettings(created.id, { playback: { ...playback, playbackRate: 1.5 } });
    loadouts.move(created.id, 0);

    const state = normalizeLoadoutState(JSON.parse(JSON.stringify(loadouts.getSnapshot())));
    expect(state.loadouts[0]).toMatchObject({
      name: 'Listening', icon: 'headphones', color: 'cyan',
      target: { type: 'file', fileKey: 'track:1' },
      settings: { playback: { playbackRate: 1.5 } }
    });
    expect(normalizeLoadoutState({ loadouts: [{ ...created, icon: 'unknown_symbol' }] }).loadouts[0].icon).toBeUndefined();
    expect(loadouts.setIcon(created.id, 'unknown_symbol' as never)).toBeNull();
    expect(loadouts.getSnapshot().loadouts[0].icon).toBe('headphones');
    expect(loadouts.setIcon(created.id)?.icon).toBeUndefined();
    expect(loadouts.getSnapshot().loadouts[0].color).toBe('cyan');
  });
});
