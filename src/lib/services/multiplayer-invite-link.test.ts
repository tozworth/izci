import { describe, expect, it } from 'vitest';
import {
  consumeInviteLinkHash,
  parseInviteLinkHash
} from './multiplayer-invite-link';

describe('parseInviteLinkHash', () => {
  it('recognizes retired links only', () => {
    expect(parseInviteLinkHash('#join=abcd1234')).toBe('abcd1234');
    expect(parseInviteLinkHash('#party=payload')).toBeNull();
    expect(parseInviteLinkHash('#join=abcdefghijkl')).toBeNull();
  });
});

describe('consumeInviteLinkHash', () => {
  function makeStub(hash: string) {
    let replaced: string | null = null;
    const location = { hash, pathname: '/', search: '' };
    return {
      location,
      history: {
        replaceState(_state: unknown, _title: string, url?: string) {
          replaced = url ?? null;
        }
      },
      getReplaced(): string | null {
        return replaced;
      }
    };
  }

  it('returns the code and strips the hash', () => {
    const stub = makeStub('#join=abcd1234');
    expect(consumeInviteLinkHash(stub.location, stub.history)).toBe('abcd1234');
    expect(stub.getReplaced()).toBe('/');
  });

  it('strips the hash even when no code is present', () => {
    const stub = makeStub('#other');
    expect(consumeInviteLinkHash(stub.location, stub.history)).toBeNull();
    expect(stub.getReplaced()).toBe('/');
  });
});
