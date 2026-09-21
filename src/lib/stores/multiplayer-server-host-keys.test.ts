import { beforeEach, describe, expect, it } from 'vitest';
import {
  forgetServerHostKey,
  getRememberedServerHostKey,
  rememberServerHostKey,
  serverHostKeys
} from './multiplayer-server-host-keys';

const KEY = 'a'.repeat(64);

beforeEach(() => {
  serverHostKeys.set([]);
});

describe('server host keys', () => {
  it('stores one normalized key per endpoint', () => {
    rememberServerHostKey('https://server.example.com/', KEY.toUpperCase());
    expect(getRememberedServerHostKey('https://server.example.com')).toBe(KEY);
    expect(serverHostKeys.getSnapshot()[0]).toMatchObject({
      endpoint: 'https://server.example.com',
      hostKey: KEY
    });
  });

  it('rejects malformed keys and forgets a server key independently', () => {
    rememberServerHostKey('https://server.example.com', 'not-a-server-key');
    expect(serverHostKeys.getSnapshot()).toEqual([]);
    rememberServerHostKey('https://server.example.com', KEY);
    forgetServerHostKey('https://server.example.com/');
    expect(serverHostKeys.getSnapshot()).toEqual([]);
  });

  it('drops malformed persisted entries', () => {
    serverHostKeys.set([
      { endpoint: 'http://remote.example.com', hostKey: KEY, lastUsed: 1 },
      { endpoint: 'https://valid.example.com', hostKey: 'short', lastUsed: 2 },
      { endpoint: 'https://valid.example.com', hostKey: KEY, lastUsed: 3 }
    ]);
    expect(serverHostKeys.getSnapshot()).toEqual([
      { endpoint: 'https://valid.example.com', hostKey: KEY, lastUsed: 3 }
    ]);
  });
});
