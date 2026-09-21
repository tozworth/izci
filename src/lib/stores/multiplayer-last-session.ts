import { createPersistentStore } from './persistent-store';

const MULTIPLAYER_LAST_SESSION_STORAGE_KEY = 'izci.multiplayer-last-session';
const MULTIPLAYER_LAST_SESSION_CHANNEL = 'izci-multiplayer-last-session';

export interface MultiplayerLastSession {
  mode: 'client' | 'hosting';
  inviteCode: string | null;
  hostId: string | null;
  hostName: string | null;
  /** Explicit signaling transport; defaults to RTDB for legacy records. */
  transport: 'rtdb' | 'server';
  /** Server state stored separately from RTDB UIDs/invite codes. */
  serverEndpoint: string | null;
  serverRoomId: string | null;
  savedAt: number;
}

function normalizeMultiplayerLastSession(value: unknown): MultiplayerLastSession | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<MultiplayerLastSession>;
  if (candidate.mode !== 'client' && candidate.mode !== 'hosting') return null;
  const inviteCode = typeof candidate.inviteCode === 'string' && /^[a-z0-9]{8}$/.test(candidate.inviteCode)
    ? candidate.inviteCode
    : null;
  const hostId = typeof candidate.hostId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(candidate.hostId)
    ? candidate.hostId
    : null;
  const hostName = typeof candidate.hostName === 'string'
    ? candidate.hostName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 48) || null
    : null;
  const transport = candidate.transport === 'server' ? 'server' : 'rtdb';
  const serverEndpoint = typeof candidate.serverEndpoint === 'string'
    && candidate.serverEndpoint.trim()
    ? candidate.serverEndpoint.trim().slice(0, 512)
    : null;
  const serverRoomId = typeof candidate.serverRoomId === 'string'
    && /^[0-9a-f]{32}$/.test(candidate.serverRoomId)
    ? candidate.serverRoomId
    : null;
  if (candidate.mode === 'client' && transport === 'rtdb' && !inviteCode && !hostId) return null;
  if (candidate.mode === 'client' && transport === 'server' && (!serverEndpoint || !serverRoomId)) {
    return null;
  }
  return {
    mode: candidate.mode,
    inviteCode,
    hostId,
    hostName,
    transport,
    serverEndpoint,
    serverRoomId,
    savedAt: typeof candidate.savedAt === 'number' && Number.isFinite(candidate.savedAt)
      ? candidate.savedAt
      : Date.now()
  };
}

export const multiplayerLastSession = createPersistentStore({
  storageKey: MULTIPLAYER_LAST_SESSION_STORAGE_KEY,
  channelName: MULTIPLAYER_LAST_SESSION_CHANNEL,
  defaultValue: null as MultiplayerLastSession | null,
  normalize: normalizeMultiplayerLastSession
});

export function rememberMultiplayerLastSession(
  mode: 'client' | 'hosting',
  options: {
    inviteCode?: string | null;
    hostId?: string | null;
    hostName?: string | null;
    transport?: 'rtdb' | 'server';
    serverEndpoint?: string | null;
    serverRoomId?: string | null;
  } = {}
): void {
  const previous = multiplayerLastSession.getSnapshot();
  const transport = options.transport ?? previous?.transport ?? 'rtdb';
  multiplayerLastSession.set({
    mode,
    inviteCode: mode === 'client' && transport === 'rtdb'
      ? (options.inviteCode ?? previous?.inviteCode ?? null)
      : null,
    hostId: mode === 'client' && transport === 'rtdb'
      ? (options.hostId ?? previous?.hostId ?? null)
      : null,
    hostName: options.hostName ?? previous?.hostName ?? null,
    transport,
    serverEndpoint: transport === 'server'
      ? (options.serverEndpoint ?? previous?.serverEndpoint ?? null)
      : null,
    serverRoomId: transport === 'server'
      ? (options.serverRoomId ?? previous?.serverRoomId ?? null)
      : null,
    savedAt: Date.now()
  });
}

export function clearMultiplayerLastSession(): void {
  multiplayerLastSession.set(null);
}
