import { describe, expect, it } from 'vitest';
import { createSidekickRtcConfiguration } from './multiplayer-ice';

describe('sidekick RTC configuration', () => {
  it('defaults to an empty server list', () => {
    const config = createSidekickRtcConfiguration([]);
    expect(config.iceServers).toEqual([]);
    expect(config.iceTransportPolicy).toBe('all');
  });

  it('maps STUN and credentialed TURN entries', () => {
    const config = createSidekickRtcConfiguration([
      { urls: ['stun:stun.example.test:3478'] },
      { urls: ['turn:turn.example.test:3478'], username: 'exp:opaque', credential: 'cred' }
    ]);
    expect(config.iceServers).toHaveLength(2);
    const turn = config.iceServers?.[1];
    expect(turn?.username).toBe('exp:opaque');
    expect(turn?.credential).toBe('cred');
  });

  it('keeps bare TURN without credentials and drops junk entries', () => {
    const config = createSidekickRtcConfiguration([
      { urls: [] },
      { urls: [''] },
      { urls: ['turn:turn.example.test:3478'] }
    ]);
    expect(config.iceServers).toHaveLength(1);
    expect(config.iceServers?.[0]).toEqual({ urls: 'turn:turn.example.test:3478' });
  });

  it('relays in relay-only mode and errors usefully without a relay', () => {
    const relayed = createSidekickRtcConfiguration(
      [{ urls: ['turn:turn.example.test:3478'], username: 'u', credential: 'c' }],
      { forceRelay: true }
    );
    expect(relayed.iceTransportPolicy).toBe('relay');
    expect(() => createSidekickRtcConfiguration(
      [{ urls: ['stun:stun.example.test:3478'] }],
      { forceRelay: true }
    )).toThrow(/TURN relay/);
    expect(() => createSidekickRtcConfiguration([], { forceRelay: true })).toThrow(/TURN relay/);
  });
});
