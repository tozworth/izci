import { createPersistentStore } from './persistent-store';

export const MULTIPLAYER_LAST_SESSION_STORAGE_KEY = 'izci.multiplayer-last-session';
export const MULTIPLAYER_LAST_SESSION_CHANNEL = 'izci-multiplayer-last-session';

export interface MultiplayerLastSession {
  mode: 'client' | 'hosting';
  inviteCode: string | null;
  hostId: string | null;
  hostName: string | null;
  savedAt: number;
}

function normalizeLastSession(value: unknown): MultiplayerLastSession | null {
  if (!value || typeof value !== 'object') return null;
  const { mode, inviteCode, hostId, hostName, savedAt } = value as Partial<MultiplayerLastSession>;
  if (mode !== 'client' && mode !== 'hosting') return null;
  const cleanInviteCode = typeof inviteCode === 'string'
    ? /^[a-z0-9]{8}$/.test(inviteCode) ? inviteCode : null
    : null;
  const cleanHostId = typeof hostId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(hostId)
    ? hostId
    : null;
  const cleanName = typeof hostName === 'string'
    ? hostName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 48)
    : null;
  const cleanSavedAt = typeof savedAt === 'number' && Number.isFinite(savedAt) ? savedAt : Date.now();
  if (mode === 'client' && !cleanInviteCode && !cleanHostId) return null;
  return {
    mode,
    inviteCode: cleanInviteCode,
    hostId: cleanHostId,
    hostName: cleanName,
    savedAt: cleanSavedAt
  };
}

export const multiplayerLastSession = createPersistentStore({
  storageKey: MULTIPLAYER_LAST_SESSION_STORAGE_KEY,
  channelName: MULTIPLAYER_LAST_SESSION_CHANNEL,
  defaultValue: null as MultiplayerLastSession | null,
  normalize: normalizeLastSession
});

export interface RememberLastSessionOptions {
  inviteCode?: string | null;
  hostId?: string | null;
  hostName?: string | null;
}

/**
 * Records the most recent multiplayer session so a later launch can restore it
 * (see the "Restore last session" option). Idempotent: callers re-record as
 * the client learns the host id/name; the record converges on the fullest
 * known identity.
 */
export function rememberMultiplayerLastSession(
  mode: 'client' | 'hosting',
  options: RememberLastSessionOptions = {}
): void {
  const previous = multiplayerLastSession.getSnapshot();
  multiplayerLastSession.set({
    mode,
    // Hosting is restored by re-hosting; a client identity never carries over
    // into a hosting record.
    inviteCode: mode === 'client' ? (options.inviteCode ?? previous?.inviteCode ?? null) : null,
    hostId: mode === 'client' ? (options.hostId ?? previous?.hostId ?? null) : null,
    hostName: options.hostName ?? previous?.hostName ?? null,
    savedAt: Date.now()
  });
}

/**
 * Drops the recorded session. Called on explicit Leave/Stop hosting/Kick so a
 * later launch does not restore a session the user deliberately ended.
 */
export function clearMultiplayerLastSession(): void {
  multiplayerLastSession.set(null);
}
