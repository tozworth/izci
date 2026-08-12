import { describe, expect, it } from 'vitest';
import { MULTIPLAYER_PROTOCOL_VERSION } from './multiplayer-protocol';
import { isIncompatibleProtocolHello } from './multiplayer-utils';

describe('isIncompatibleProtocolHello', () => {
  it('rejects a hello at the current protocol version', () => {
    expect(isIncompatibleProtocolHello({
      kind: 'hello',
      version: MULTIPLAYER_PROTOCOL_VERSION
    })).toBe(false);
  });

  it('detects a hello from an older protocol version', () => {
    expect(isIncompatibleProtocolHello({
      kind: 'hello',
      version: MULTIPLAYER_PROTOCOL_VERSION - 1
    })).toBe(true);
  });

  it('detects a hello from a newer protocol version', () => {
    expect(isIncompatibleProtocolHello({
      kind: 'hello',
      version: MULTIPLAYER_PROTOCOL_VERSION + 1
    })).toBe(true);
  });

  it('rejects non-hello messages even with a version', () => {
    expect(isIncompatibleProtocolHello({
      kind: 'state',
      version: MULTIPLAYER_PROTOCOL_VERSION - 1
    })).toBe(false);
  });

  it('rejects malformed or non-object frames', () => {
    expect(isIncompatibleProtocolHello(null)).toBe(false);
    expect(isIncompatibleProtocolHello('hello')).toBe(false);
    expect(isIncompatibleProtocolHello({ kind: 'hello' })).toBe(false);
    expect(isIncompatibleProtocolHello({ kind: 'hello', version: '18' })).toBe(false);
  });
});
