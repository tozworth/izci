import { describe, expect, it } from 'vitest';
import { createMultiplayerRtcConfiguration } from './multiplayer-ice';

describe('multiplayer ICE configuration', () => {
  it('uses public STUN without TURN by default', () => {
    expect(createMultiplayerRtcConfiguration({
      multiplayerTurnUrl: '',
      multiplayerTurnUsername: '',
      multiplayerTurnCredential: '',
      multiplayerForceTurn: true
    })).toEqual({
      iceServers: [
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.l.google.com:19302' }
      ],
      iceTransportPolicy: 'all'
    });
  });

  it('adds authenticated TURN and can require relay candidates', () => {
    expect(createMultiplayerRtcConfiguration({
      multiplayerTurnUrl: 'turn:relay.example.test:3478',
      multiplayerTurnUsername: 'izci',
      multiplayerTurnCredential: 'secret',
      multiplayerForceTurn: true
    })).toEqual({
      iceServers: [
        { urls: 'stun:stun.cloudflare.com:3478' },
        { urls: 'stun:stun.l.google.com:19302' },
        {
          urls: [
            'turn:relay.example.test:3478',
            'turn:relay.example.test:3478?transport=tcp'
          ],
          username: 'izci',
          credential: 'secret'
        }
      ],
      iceTransportPolicy: 'relay'
    });
  });
});
