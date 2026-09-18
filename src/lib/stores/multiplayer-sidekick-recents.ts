import { createPersistentStore } from './persistent-store';
import { SIDEKICK_ROOM_ID_PATTERN } from '$lib/services/multiplayer-sidekick-invite';

const SIDEKICK_SERVERS_STORAGE_KEY = 'izci.multiplayer-sidekick-servers';
const SIDEKICK_SERVERS_CHANNEL = 'izci-multiplayer-sidekick-servers';
const SIDEKICK_RECENTS_STORAGE_KEY = 'izci.multiplayer-sidekick-recents';
const SIDEKICK_RECENTS_CHANNEL = 'izci-multiplayer-sidekick-recents';
const SIDEKICK_STORE_LIMIT = 8;
const SIDEKICK_LABEL_MAX = 120;

/**
 * Sidekick-specific recents, stored separately from RTDB UIDs/invite codes.
 * Operator keys live in their own opt-in store and login bearers are never
 * persisted; remembered host rooms may keep their owner/invitation secrets
 * when Remember was chosen.
 */
export interface SidekickServerEntry {
  endpoint: string;
  label: string;
  lastUsed: number;
}

export interface SidekickRecentEntry {
  endpoint: string;
  roomId: string;
  displayName: string;
  lastUsed: number;
  /** Present only when Remember was chosen. */
  invitationSecret: string | null;
  /** Host rooms only, and only when Remember was chosen. */
  ownerSecret: string | null;
}

function cleanLabel(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, SIDEKICK_LABEL_MAX)
    : '';
}

function cleanEndpoint(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 512);
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password || url.hash || url.search) return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function cleanSecret(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : null;
}

function cleanTimestamp(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : Date.now();
}

function normalizeServers(value: unknown): SidekickServerEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: SidekickServerEntry[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const endpoint = cleanEndpoint((candidate as Partial<SidekickServerEntry>).endpoint);
    if (!endpoint || seen.has(endpoint)) continue;
    seen.add(endpoint);
    entries.push({
      endpoint,
      label: cleanLabel((candidate as Partial<SidekickServerEntry>).label),
      lastUsed: cleanTimestamp((candidate as Partial<SidekickServerEntry>).lastUsed)
    });
    if (entries.length === SIDEKICK_STORE_LIMIT) break;
  }
  return entries.sort((a, b) => b.lastUsed - a.lastUsed);
}

function normalizeRecents(value: unknown): SidekickRecentEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const entries: SidekickRecentEntry[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Partial<SidekickRecentEntry>;
    const endpoint = cleanEndpoint(record.endpoint);
    if (!endpoint || typeof record.roomId !== 'string' || !SIDEKICK_ROOM_ID_PATTERN.test(record.roomId)) {
      continue;
    }
    const key = `${endpoint}::${record.roomId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const displayName = cleanLabel(record.displayName);
    if (!displayName) continue;
    entries.push({
      endpoint,
      roomId: record.roomId,
      displayName,
      lastUsed: cleanTimestamp(record.lastUsed),
      invitationSecret: cleanSecret(record.invitationSecret),
      ownerSecret: cleanSecret(record.ownerSecret)
    });
    if (entries.length === SIDEKICK_STORE_LIMIT) break;
  }
  return entries.sort((a, b) => b.lastUsed - a.lastUsed);
}

export const sidekickServers = createPersistentStore({
  storageKey: SIDEKICK_SERVERS_STORAGE_KEY,
  channelName: SIDEKICK_SERVERS_CHANNEL,
  defaultValue: [] as SidekickServerEntry[],
  normalize: normalizeServers
});

export const sidekickRecents = createPersistentStore({
  storageKey: SIDEKICK_RECENTS_STORAGE_KEY,
  channelName: SIDEKICK_RECENTS_CHANNEL,
  defaultValue: [] as SidekickRecentEntry[],
  normalize: normalizeRecents
});

export function rememberSidekickServer(endpoint: string, label = ''): void {
  const clean = cleanEndpoint(endpoint);
  if (!clean) return;
  sidekickServers.update((current) => {
    const previous = current.find((entry) => entry.endpoint === clean);
    return normalizeServers([
      { endpoint: clean, label: cleanLabel(label) || previous?.label || '', lastUsed: Date.now() },
      ...current.filter((entry) => entry.endpoint !== clean)
    ]);
  });
}

/** Forget a server and every recent tied to its endpoint. */
export function forgetSidekickServer(endpoint: string): void {
  const clean = cleanEndpoint(endpoint);
  if (!clean) return;
  sidekickServers.update((current) => current.filter((entry) => entry.endpoint !== clean));
  sidekickRecents.update((current) => current.filter((entry) => entry.endpoint !== clean));
}

export function rememberSidekickRecent(
  entry: Omit<SidekickRecentEntry, 'lastUsed'> & { lastUsed?: number },
  options: { rememberInvitation?: boolean } = {}
): void {
  const endpoint = cleanEndpoint(entry.endpoint);
  if (!endpoint) return;
  if (typeof entry.roomId !== 'string' || !SIDEKICK_ROOM_ID_PATTERN.test(entry.roomId)) return;
  const displayName = cleanLabel(entry.displayName);
  if (!displayName) return;
  const remember = options.rememberInvitation === true;
  const next: SidekickRecentEntry = {
    endpoint,
    roomId: entry.roomId,
    displayName,
    lastUsed: cleanTimestamp(entry.lastUsed ?? Date.now()),
    invitationSecret: remember ? cleanSecret(entry.invitationSecret) : null,
    ownerSecret: remember ? cleanSecret(entry.ownerSecret) : null
  };
  sidekickRecents.update((current) => normalizeRecents([
    next,
    ...current.filter(
      (candidate) => !(candidate.endpoint === endpoint && candidate.roomId === entry.roomId)
    )
  ]));
}

/** Forget a single invitation (the whole recent entry, secrets included). */
export function forgetSidekickInvitation(endpoint: string, roomId: string): void {
  const clean = cleanEndpoint(endpoint);
  if (!clean) return;
  sidekickRecents.update((current) => current.filter(
    (entry) => !(entry.endpoint === clean && entry.roomId === roomId)
  ));
}
