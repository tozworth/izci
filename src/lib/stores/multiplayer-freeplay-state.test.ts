import { beforeEach, describe, expect, it } from 'vitest';
import {
  multiplayerFreeplayState,
  rememberMultiplayerFreeplayState
} from './multiplayer-freeplay-state';

describe('multiplayer freeplay state', () => {
  beforeEach(() => multiplayerFreeplayState.set(null));

  it('persists only the intentional per-pair client resume state', () => {
    rememberMultiplayerFreeplayState({
      hostId: 'host_123',
      queue: ['a', 'b'],
      shuffleEnabled: true,
      repeatMode: 'all',
      currentTrackId: 'b'
    });
    expect(multiplayerFreeplayState.getSnapshot()).toMatchObject({
      hostId: 'host_123', queue: ['a', 'b'], shuffleEnabled: true, repeatMode: 'all', currentTrackId: 'b'
    });
  });

  it('bounds and deduplicates dirty queue data', () => {
    multiplayerFreeplayState.set({
      hostId: 'host_123',
      queue: ['b', 'a', 'b', '', 42],
      shuffleEnabled: 'yes',
      repeatMode: 'weird',
      currentTrackId: 42
    });
    expect(multiplayerFreeplayState.getSnapshot()).toMatchObject({
      queue: ['b', 'a'], shuffleEnabled: false, repeatMode: 'off', currentTrackId: null
    });
  });
});
