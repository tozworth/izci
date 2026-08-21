import { describe, expect, it } from 'vitest';
import {
  buildInviteLink,
  consumeInviteLinkHash,
  parseInviteLinkHash
} from './multiplayer-invite-link';

describe('parseInviteLinkHash', () => {
  it('parses a bare join hash', () => {
    expect(parseInviteLinkHash('#join=abcd1234')).toBe('abcd1234');
  });

  it('parses join inside a larger fragment', () => {
    expect(parseInviteLinkHash('#room=xyz&join=abcd1234')).toBe('abcd1234');
    expect(parseInviteLinkHash('#join=abcd1234&view=queue')).toBe('abcd1234');
  });

  it('rejects malformed codes', () => {
    expect(parseInviteLinkHash('#join=abcd12345')).toBeNull();
    expect(parseInviteLinkHash('#join=ABCD1234')).toBeNull();
    expect(parseInviteLinkHash('#join=abcd')).toBeNull();
    expect(parseInviteLinkHash('#room=abcd1234')).toBeNull();
    expect(parseInviteLinkHash('')).toBeNull();
    expect(parseInviteLinkHash('join=abcd1234')).toBeNull();
  });
});

describe('buildInviteLink', () => {
  it('builds a link on the current origin by default', () => {
    expect(buildInviteLink('abcd1234', 'https://izci.example')).toBe(
      'https://izci.example/#join=abcd1234'
    );
  });

  it('round-trips with the parser and normalizeInviteCode', () => {
    const link = buildInviteLink('abcd1234', 'https://izci.example');
    const hash = link.slice(link.indexOf('#'));
    expect(parseInviteLinkHash(hash)).toBe('abcd1234');
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
