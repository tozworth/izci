import { describe, expect, it } from 'vitest';
import { DEFAULT_LOADOUT_STATE, normalizeLoadoutState } from './loadouts';

describe('loadout persistence normalization', () => {
  it('defaults automatic loading on and rejects malformed or empty loadouts', () => {
    expect(normalizeLoadoutState(null)).toEqual(DEFAULT_LOADOUT_STATE);
    expect(normalizeLoadoutState({ loadouts: [{ id: 'bad', name: '', target: {}, settings: {} }] })).toEqual({
      automaticEnabled: true,
      loadouts: []
    });
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
    expect(state.loadouts[0].settings.modules).toMatchObject({
      repeatCount: -1,
      interpolationFilter: 1
    });
  });
});
