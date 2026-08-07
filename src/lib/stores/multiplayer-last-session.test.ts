import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearMultiplayerLastSession,
  multiplayerLastSession,
  rememberMultiplayerLastSession
} from './multiplayer-last-session';

describe('multiplayer last session', () => {
  beforeEach(() => multiplayerLastSession.set(null));

  it('remembers a client session and converges on the fullest identity', () => {
    rememberMultiplayerLastSession('client', { inviteCode: 'abcdef12', hostName: 'Desk' });
    expect(multiplayerLastSession.getSnapshot()).toMatchObject({
      mode: 'client',
      inviteCode: 'abcdef12',
      hostId: null,
      hostName: 'Desk'
    });

    rememberMultiplayerLastSession('client', { hostId: 'host_123', hostName: 'Desk' });
    expect(multiplayerLastSession.getSnapshot()).toMatchObject({
      mode: 'client',
      inviteCode: 'abcdef12',
      hostId: 'host_123',
      hostName: 'Desk'
    });
  });

  it('remembers hosting without carrying a client identity over', () => {
    rememberMultiplayerLastSession('client', { inviteCode: 'abcdef12', hostId: 'host_123' });
    rememberMultiplayerLastSession('hosting', { hostName: 'Server' });
    expect(multiplayerLastSession.getSnapshot()).toMatchObject({
      mode: 'hosting',
      inviteCode: null,
      hostId: null,
      hostName: 'Server'
    });
  });

  it('clears the recorded session', () => {
    rememberMultiplayerLastSession('client', { inviteCode: 'abcdef12' });
    clearMultiplayerLastSession();
    expect(multiplayerLastSession.getSnapshot()).toBeNull();
  });

  it('rejects malformed persisted records', () => {
    multiplayerLastSession.set({
      mode: 'client',
      inviteCode: null,
      hostId: null,
      hostName: 'Lost'
    });
    expect(multiplayerLastSession.getSnapshot()).toBeNull();

    multiplayerLastSession.set({
      mode: 'spectator',
      inviteCode: 'abcdef12',
      hostId: null,
      hostName: 'Bad'
    });
    expect(multiplayerLastSession.getSnapshot()).toBeNull();

    multiplayerLastSession.set({
      mode: 'client',
      inviteCode: 'not-a-code',
      hostId: '../bad',
      hostName: 'Bad'
    });
    expect(multiplayerLastSession.getSnapshot()).toBeNull();
  });

  it('normalizes dirty values from storage', () => {
    multiplayerLastSession.set({
      mode: 'client',
      inviteCode: 'abcdef12',
      hostId: 'host_123',
      hostName: '  Desk  \u0000',
      savedAt: 'not-a-number'
    });
    expect(multiplayerLastSession.getSnapshot()).toEqual({
      mode: 'client',
      inviteCode: 'abcdef12',
      hostId: 'host_123',
      hostName: 'Desk',
      savedAt: expect.any(Number)
    });
  });
});
