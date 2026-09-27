import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearMultiplayerLastSession,
  multiplayerLastSession,
  rememberMultiplayerLastSession
} from './multiplayer-last-session';

describe('multiplayer last session', () => {
  beforeEach(() => multiplayerLastSession.set(null));

  it('converges on the fullest client identity', () => {
    rememberMultiplayerLastSession('client', { serverEndpoint: 'https://server.example', serverRoomId: 'a'.repeat(32), hostName: 'Desk' });
    rememberMultiplayerLastSession('client', { hostName: 'Living room' });
    expect(multiplayerLastSession.getSnapshot()).toMatchObject({
      mode: 'client', transport: 'server', serverEndpoint: 'https://server.example', serverRoomId: 'a'.repeat(32), hostName: 'Living room'
    });
  });

  it('stores invitecodeless hosting and clears on an explicit end', () => {
    rememberMultiplayerLastSession('hosting', { hostName: 'Server' });
    expect(multiplayerLastSession.getSnapshot()).toMatchObject({
      mode: 'hosting', transport: 'server', hostName: 'Server'
    });
    clearMultiplayerLastSession();
    expect(multiplayerLastSession.getSnapshot()).toBeNull();
  });

  it('discards retired signaling records rather than restoring them', () => {
    multiplayerLastSession.set({ mode: 'hosting', transport: 'rtdb', hostName: 'Old' });
    expect(multiplayerLastSession.getSnapshot()).toBeNull();
    multiplayerLastSession.set({ mode: 'client', inviteCode: 'abcdef12', hostId: 'old-host' });
    expect(multiplayerLastSession.getSnapshot()).toBeNull();
  });

  it('rejects a client record without a usable host identity', () => {
    multiplayerLastSession.set({ mode: 'client', transport: 'server', serverEndpoint: null, serverRoomId: null, hostName: 'Lost' });
    expect(multiplayerLastSession.getSnapshot()).toBeNull();
  });
});
