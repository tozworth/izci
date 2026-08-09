import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearMultiplayerLastSession,
  multiplayerLastSession,
  rememberMultiplayerLastSession
} from './multiplayer-last-session';

describe('multiplayer last session', () => {
  beforeEach(() => multiplayerLastSession.set(null));

  it('converges on the fullest client identity', () => {
    rememberMultiplayerLastSession('client', { inviteCode: 'abcdef12', hostName: 'Desk' });
    rememberMultiplayerLastSession('client', { hostId: 'host_123' });
    expect(multiplayerLastSession.getSnapshot()).toMatchObject({
      mode: 'client', inviteCode: 'abcdef12', hostId: 'host_123', hostName: 'Desk'
    });
  });

  it('stores invitecodeless hosting and clears on an explicit end', () => {
    rememberMultiplayerLastSession('hosting', { hostName: 'Server' });
    expect(multiplayerLastSession.getSnapshot()).toMatchObject({
      mode: 'hosting', inviteCode: null, hostId: null, hostName: 'Server'
    });
    clearMultiplayerLastSession();
    expect(multiplayerLastSession.getSnapshot()).toBeNull();
  });

  it('rejects a client record without a usable host identity', () => {
    multiplayerLastSession.set({ mode: 'client', inviteCode: null, hostId: null, hostName: 'Lost' });
    expect(multiplayerLastSession.getSnapshot()).toBeNull();
  });
});
