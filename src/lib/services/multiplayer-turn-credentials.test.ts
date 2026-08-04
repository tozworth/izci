import { describe, expect, it } from 'vitest';
import {
  createMultiplayerTurnCredentialRequest,
  createMultiplayerTurnCredentialResponse,
  createMultiplayerTurnIceSettings,
  isMultiplayerTurnCredentialRequest,
  isMultiplayerTurnCredentialResponse
} from './multiplayer-turn-credentials';

const issuer = {
  multiplayerTurnUrl: 'turn:toz.net.tr:3478',
  multiplayerTurnSecret: 'shared-secret',
  multiplayerTurnCredentialHours: 12,
  multiplayerForceTurn: true
};

describe('multiplayer TURN credentials', () => {
  it('mints coturn REST credentials with an expiring username', async () => {
    const now = 1_800_000_000_000;
    const credentials = await createMultiplayerTurnIceSettings(issuer, 'client-123', now);

    expect(credentials).toMatchObject({
      multiplayerTurnUrl: 'turn:toz.net.tr:3478',
      multiplayerTurnUsername: `${Math.floor(now / 1_000) + 43_200}:client-123`,
      multiplayerForceTurn: true,
      expiresAt: now + 43_200_000
    });
    expect(credentials.multiplayerTurnCredential).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it('encrypts credentials for the requesting client only', async () => {
    const pending = await createMultiplayerTurnCredentialRequest();
    const response = await createMultiplayerTurnCredentialResponse(
      pending.request,
      issuer,
      'client-123'
    );

    expect(isMultiplayerTurnCredentialRequest(pending.request)).toBe(true);
    expect(isMultiplayerTurnCredentialResponse(response)).toBe(true);
    await expect(pending.decrypt(response)).resolves.toMatchObject({
      multiplayerTurnUrl: 'turn:toz.net.tr:3478',
      multiplayerForceTurn: true
    });

    const other = await createMultiplayerTurnCredentialRequest();
    await expect(other.decrypt({ ...response, requestId: other.request.requestId })).rejects.toThrow();
  });
});
