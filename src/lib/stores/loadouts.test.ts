import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LOADOUT_STATE, loadouts, normalizeLoadoutState } from './loadouts';

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
    const settings = { playback: { playbackRate: 1, trueSpeed: false, replayGainMode: 'off' as const } };
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
          playback: { playbackRate: 99, trueSpeed: true, replayGainMode: 'wat' },
          raf: { presetName: '  Clean  ', enabled: false },
          modules: { repeatCount: -99, interpolationFilter: 7 }
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
      replayGainMode: 'track'
    });
    expect(state.loadouts[0].settings.raf).toEqual({ presetName: 'Clean', enabled: false });
    expect(state.loadouts[0].settings.modules).toMatchObject({
      repeatCount: -1,
      interpolationFilter: 1
    });
  });
});
