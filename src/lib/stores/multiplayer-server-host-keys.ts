import { createPersistentStore } from './persistent-store';
import { normalizeServerInviteEndpoint } from '$lib/services/multiplayer-server-invite';

const SERVER_HOST_KEYS_STORAGE_KEY = 'izci.multiplayer-server-host-keys';
const SERVER_HOST_KEYS_CHANNEL = 'izci-multiplayer-server-host-keys';
const SERVER_HOST_KEY_LIMIT = 8;
const HOST_KEY_PATTERN = /^[0-9a-f]{64}$/i;

export interface ServerHostKeyEntry {
  endpoint: string;
  hostKey: string;
  lastUsed: number;
}

function cleanEndpoint(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return normalizeServerInviteEndpoint(value);
  } catch {
    return null;
  }
}

function cleanHostKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  return HOST_KEY_PATTERN.test(key) ? key.toLowerCase() : null;
}

function normalizeHostKeys(value: unknown): ServerHostKeyEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: ServerHostKeyEntry[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Partial<ServerHostKeyEntry>;
    const endpoint = cleanEndpoint(record.endpoint);
    const hostKey = cleanHostKey(record.hostKey);
    if (!endpoint || !hostKey || seen.has(endpoint)) continue;
    seen.add(endpoint);
    entries.push({
      endpoint,
      hostKey,
      lastUsed: typeof record.lastUsed === 'number' && Number.isFinite(record.lastUsed)
        ? record.lastUsed
        : Date.now()
    });
    if (entries.length === SERVER_HOST_KEY_LIMIT) break;
  }
  return entries.sort((a, b) => b.lastUsed - a.lastUsed);
}

/**
 * Device-local remembered operator keys. They are deliberately separate from
 * server recents, invitations, login bearers, and the portable backup.
 */
export const serverHostKeys = createPersistentStore({
  storageKey: SERVER_HOST_KEYS_STORAGE_KEY,
  channelName: SERVER_HOST_KEYS_CHANNEL,
  defaultValue: [] as ServerHostKeyEntry[],
  normalize: normalizeHostKeys
});

export function getRememberedServerHostKey(endpoint: string): string | null {
  const clean = cleanEndpoint(endpoint);
  if (!clean) return null;
  return serverHostKeys.getSnapshot().find((entry) => entry.endpoint === clean)?.hostKey ?? null;
}

export function rememberServerHostKey(endpoint: string, hostKey: string): void {
  const clean = cleanEndpoint(endpoint);
  const key = cleanHostKey(hostKey);
  if (!clean || !key) return;
  serverHostKeys.update((current) => normalizeHostKeys([
    { endpoint: clean, hostKey: key, lastUsed: Date.now() },
    ...current.filter((entry) => entry.endpoint !== clean)
  ]));
}

export function forgetServerHostKey(endpoint: string): void {
  const clean = cleanEndpoint(endpoint);
  if (!clean) return;
  serverHostKeys.update((current) => current.filter((entry) => entry.endpoint !== clean));
}
