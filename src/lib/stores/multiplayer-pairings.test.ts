import { beforeEach, describe, expect, it } from 'vitest';
import {
  forgetMultiplayerPairing,
  multiplayerPairings,
  rememberMultiplayerPairing
} from './multiplayer-pairings';

describe('multiplayer pairings', () => {
  beforeEach(() => multiplayerPairings.set([]));

  it('remembers a host once and updates its name', () => {
    rememberMultiplayerPairing('host_123', 'Living room');
    rememberMultiplayerPairing('host_123', 'Desk');

    expect(multiplayerPairings.getSnapshot()).toEqual([{ hostId: 'host_123', name: 'Desk' }]);
  });

  it('forgets a paired host', () => {
    rememberMultiplayerPairing('host_123', 'Living room');
    forgetMultiplayerPairing('host_123');

    expect(multiplayerPairings.getSnapshot()).toEqual([]);
  });

  it('rejects malformed persisted identities', () => {
    multiplayerPairings.set([
      { hostId: '../host', name: 'Bad' },
      { hostId: 'valid-host', name: '  Good  ' }
    ]);

    expect(multiplayerPairings.getSnapshot()).toEqual([{ hostId: 'valid-host', name: 'Good' }]);
  });
});
