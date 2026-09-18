import { beforeEach, describe, expect, it } from 'vitest';
import {
  forgetSidekickHostKey,
  getRememberedSidekickHostKey,
  rememberSidekickHostKey,
  sidekickHostKeys
} from './multiplayer-sidekick-host-keys';

const KEY = 'a'.repeat(64);

beforeEach(() => {
  sidekickHostKeys.set([]);
});

describe('sidekick host keys', () => {
  it('stores one normalized key per endpoint', () => {
    rememberSidekickHostKey('https://sidekick.example.com/', KEY.toUpperCase());
    expect(getRememberedSidekickHostKey('https://sidekick.example.com')).toBe(KEY);
    expect(sidekickHostKeys.getSnapshot()[0]).toMatchObject({
      endpoint: 'https://sidekick.example.com',
      hostKey: KEY
    });
  });

  it('rejects malformed keys and forgets a server key independently', () => {
    rememberSidekickHostKey('https://sidekick.example.com', 'not-a-server-key');
    expect(sidekickHostKeys.getSnapshot()).toEqual([]);
    rememberSidekickHostKey('https://sidekick.example.com', KEY);
    forgetSidekickHostKey('https://sidekick.example.com/');
    expect(sidekickHostKeys.getSnapshot()).toEqual([]);
  });

  it('drops malformed persisted entries', () => {
    sidekickHostKeys.set([
      { endpoint: 'http://remote.example.com', hostKey: KEY, lastUsed: 1 },
      { endpoint: 'https://valid.example.com', hostKey: 'short', lastUsed: 2 },
      { endpoint: 'https://valid.example.com', hostKey: KEY, lastUsed: 3 }
    ]);
    expect(sidekickHostKeys.getSnapshot()).toEqual([
      { endpoint: 'https://valid.example.com', hostKey: KEY, lastUsed: 3 }
    ]);
  });
});
