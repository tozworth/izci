import { beforeEach, describe, expect, it } from 'vitest';
import {
  multiplayerRecents,
  rememberMultiplayerHost
} from './multiplayer-recents';

describe('multiplayer recents', () => {
  beforeEach(() => multiplayerRecents.set([]));

  it('keeps the five most recent unique hosts', () => {
    for (let index = 0; index < 6; index += 1) {
      rememberMultiplayerHost(`Scout ${index}`, `abcd000${index}`);
    }

    expect(multiplayerRecents.getSnapshot()).toEqual([
      { name: 'Scout 5', inviteCode: 'abcd0005' },
      { name: 'Scout 4', inviteCode: 'abcd0004' },
      { name: 'Scout 3', inviteCode: 'abcd0003' },
      { name: 'Scout 2', inviteCode: 'abcd0002' },
      { name: 'Scout 1', inviteCode: 'abcd0001' }
    ]);

    rememberMultiplayerHost('Renamed', 'abcd0003');
    expect(multiplayerRecents.getSnapshot()[0]).toEqual({
      name: 'Renamed',
      inviteCode: 'abcd0003'
    });
    expect(multiplayerRecents.getSnapshot()).toHaveLength(5);
  });
});
