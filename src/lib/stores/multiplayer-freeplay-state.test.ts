import { beforeEach, describe, expect, it } from 'vitest';
import {
  multiplayerFreeplayState,
  rememberMultiplayerFreeplayState
} from './multiplayer-freeplay-state';

describe('multiplayer freeplay state', () => {
  beforeEach(() => multiplayerFreeplayState.set(null));

  it('remembers the queue, flags and current track keyed by host', () => {
    rememberMultiplayerFreeplayState({
      hostId: 'host_123',
      queue: ['a', 'b', 'c'],
      shuffleEnabled: true,
      repeatMode: 'all',
      currentTrackId: 'b'
    });

    expect(multiplayerFreeplayState.getSnapshot()).toMatchObject({
      hostId: 'host_123',
      queue: ['a', 'b', 'c'],
      shuffleEnabled: true,
      repeatMode: 'all',
      currentTrackId: 'b'
    });
  });

  it('rejects records with a malformed host id', () => {
    multiplayerFreeplayState.set({
      hostId: '../host',
      queue: ['a'],
      shuffleEnabled: true,
      repeatMode: 'all'
    });

    expect(multiplayerFreeplayState.getSnapshot()).toBeNull();
  });

  it('normalizes the queue, flags and current track', () => {
    multiplayerFreeplayState.set({
      hostId: 'host_123',
      queue: ['b', 'a', 'b', '', 42, 'c'],
      shuffleEnabled: 'yes',
      repeatMode: 'weird',
      currentTrackId: 42
    });

    expect(multiplayerFreeplayState.getSnapshot()).toEqual({
      hostId: 'host_123',
      queue: ['b', 'a', 'c'],
      shuffleEnabled: false,
      repeatMode: 'off',
      currentTrackId: null,
      savedAt: expect.any(Number)
    });
  });

  it('drops an out-of-range current track id', () => {
    multiplayerFreeplayState.set({
      hostId: 'host_123',
      queue: [],
      shuffleEnabled: false,
      repeatMode: 'off',
      currentTrackId: 'x'.repeat(201)
    });

    expect(multiplayerFreeplayState.getSnapshot()?.currentTrackId).toBeNull();
  });

  it('overwrites the previous host record', () => {
    rememberMultiplayerFreeplayState({
      hostId: 'host_a',
      queue: ['x'],
      shuffleEnabled: false,
      repeatMode: 'off',
      currentTrackId: 'x'
    });
    rememberMultiplayerFreeplayState({
      hostId: 'host_b',
      queue: ['y'],
      shuffleEnabled: true,
      repeatMode: 'one',
      currentTrackId: 'y'
    });

    expect(multiplayerFreeplayState.getSnapshot()).toMatchObject({
      hostId: 'host_b',
      queue: ['y'],
      shuffleEnabled: true,
      repeatMode: 'one',
      currentTrackId: 'y'
    });
  });
});
