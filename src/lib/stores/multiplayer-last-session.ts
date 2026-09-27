import { createPersistentStore } from './persistent-store';

const MULTIPLAYER_LAST_SESSION_STORAGE_KEY = 'izci.multiplayer-last-session';
const MULTIPLAYER_LAST_SESSION_CHANNEL = 'izci-multiplayer-last-session';

export interface MultiplayerLastSession {
  mode: 'client' | 'hosting';
  hostName: string | null;
  transport: 'server';
  serverEndpoint: string | null;
  serverRoomId: string | null;
  savedAt: number;
}

function normalizeMultiplayerLastSession(value: unknown): MultiplayerLastSession | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<MultiplayerLastSession>;
  if (candidate.mode !== 'client' && candidate.mode !== 'hosting') return null;
  const hostName = typeof candidate.hostName === 'string'
    ? candidate.hostName.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 48) || null
    : null;
  if (candidate.transport !== 'server') return null;
  const transport = 'server';
  const serverEndpoint = typeof candidate.serverEndpoint === 'string'
    && candidate.serverEndpoint.trim()
    ? candidate.serverEndpoint.trim().slice(0, 512)
    : null;
  const serverRoomId = typeof candidate.serverRoomId === 'string'
    && /^[0-9a-f]{32}$/.test(candidate.serverRoomId)
    ? candidate.serverRoomId
    : null;
  if (candidate.mode === 'client' && (!serverEndpoint || !serverRoomId)) {
    return null;
  }
  return {
    mode: candidate.mode,
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

if (typeof window !== 'undefined') {
  try {
    multiplayerLastSession.set(multiplayerLastSession.getSnapshot());
  } catch {
    // Session state remains usable when storage is unavailable.
  }
}

export function rememberMultiplayerLastSession(
  mode: 'client' | 'hosting',
  options: {
    hostName?: string | null;
    transport?: 'server';
    serverEndpoint?: string | null;
    serverRoomId?: string | null;
  } = {}
): void {
  const previous = multiplayerLastSession.getSnapshot();
  const transport = options.transport ?? previous?.transport ?? 'server';
  multiplayerLastSession.set({
    mode,
    hostName: options.hostName ?? previous?.hostName ?? null,
    transport,
    serverEndpoint: options.serverEndpoint ?? previous?.serverEndpoint ?? null,
    serverRoomId: options.serverRoomId ?? previous?.serverRoomId ?? null,
    savedAt: Date.now()
  });
}

export function clearMultiplayerLastSession(): void {
  multiplayerLastSession.set(null);
}
