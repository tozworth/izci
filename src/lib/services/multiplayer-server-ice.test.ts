import { describe, expect, it } from 'vitest';
import { createServerRtcConfiguration } from './multiplayer-ice';

describe('server RTC configuration', () => {
  it('defaults to an empty server list', () => {
    const config = createServerRtcConfiguration([]);
    expect(config.iceServers).toEqual([]);
    expect(config.iceTransportPolicy).toBe('all');
  });

  it('maps STUN and credentialed TURN entries', () => {
    const config = createServerRtcConfiguration([
      { urls: ['stun:stun.example.test:3478'] },
      { urls: ['turn:turn.example.test:3478'], username: 'exp:opaque', credential: 'cred' }
    ]);
    expect(config.iceServers).toHaveLength(2);
    const turn = config.iceServers?.[1];
    expect(turn?.username).toBe('exp:opaque');
    expect(turn?.credential).toBe('cred');
  });

  it('keeps bare TURN without credentials and drops junk entries', () => {
    const config = createServerRtcConfiguration([
      { urls: [] },
      { urls: [''] },
      { urls: ['turn:turn.example.test:3478'] }
    ]);
    expect(config.iceServers).toHaveLength(1);
    expect(config.iceServers?.[0]).toEqual({ urls: 'turn:turn.example.test:3478' });
  });

  it('relays in relay-only mode and errors usefully without a relay', () => {
    const relayed = createServerRtcConfiguration(
      [{ urls: ['turn:turn.example.test:3478'], username: 'u', credential: 'c' }],
      { forceRelay: true }
    );
    expect(relayed.iceTransportPolicy).toBe('relay');
    expect(() => createServerRtcConfiguration(
      [{ urls: ['stun:stun.example.test:3478'] }],
      { forceRelay: true }
    )).toThrow(/TURN relay/);
    expect(() => createServerRtcConfiguration([], { forceRelay: true })).toThrow(/TURN relay/);
  });
});
