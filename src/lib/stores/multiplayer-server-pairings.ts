import { createPersistentStore } from './persistent-store';
import { isValidServerIdentity } from '$lib/services/multiplayer-server-identity';

const SERVER_PAIRINGS_STORAGE_KEY = 'izci.multiplayer-server-pairings';
const SERVER_PAIRINGS_CHANNEL = 'izci-multiplayer-server-pairings';
const SERVER_PAIRINGS_LIMIT = 32;
const LABEL_MAX = 120;
const SECRET_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Server pairing record. The per-pair secret is exchanged over RTC when
 * the host chooses Pair and is later used for HMAC reconnect proofs; it
 * never grants server administration and never bypasses invitation
 * admission. Operator keys and login bearers are never stored here.
 */
export interface ServerPairRecord {
  /** Browser-local identity of the paired peer. */
  peerIdentity: string;
  /** Human label for the peer (host/guest name at pair time). */
  label: string;
  /** 32 random bytes as hex, exchanged over RTC at pair time. */
  secret: string;
  /** Last endpoint/room seen for this peer; admission still applies. */
  endpoint: string;
  roomId: string;
  /** Remembered invitation secret when the user chose Remember. */
  invitationSecret: string | null;
  updatedAt: number;
}

function cleanLabel(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, LABEL_MAX)
    : '';
}

function cleanShort(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

function normalizePairings(value: unknown): ServerPairRecord[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const records: ServerPairRecord[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const record = candidate as Partial<ServerPairRecord>;
    if (!isValidServerIdentity(record.peerIdentity) || seen.has(record.peerIdentity)) continue;
    if (typeof record.secret !== 'string' || !SECRET_PATTERN.test(record.secret)) continue;
    const endpoint = cleanShort(record.endpoint, 512);
    const roomId = cleanShort(record.roomId, 64);
    if (!endpoint || !roomId || !/^[0-9a-f]{32}$/.test(roomId)) continue;
    try {
      const url = new URL(endpoint);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      if (url.username || url.password || url.hash || url.search) continue;
    } catch {
      continue;
    }
    const label = cleanLabel(record.label);
    if (!label) continue;
    seen.add(record.peerIdentity);
    records.push({
      peerIdentity: record.peerIdentity,
      label,
      secret: record.secret,
      endpoint,
      roomId,
      invitationSecret:
        typeof record.invitationSecret === 'string' && record.invitationSecret.length > 0
          && record.invitationSecret.length <= 512
          ? record.invitationSecret
          : null,
      updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : Date.now()
    });
    if (records.length >= SERVER_PAIRINGS_LIMIT) break;
  }
  return records.sort((a, b) => b.updatedAt - a.updatedAt);
}

export const serverPairings = createPersistentStore({
  storageKey: SERVER_PAIRINGS_STORAGE_KEY,
  channelName: SERVER_PAIRINGS_CHANNEL,
  defaultValue: [] as ServerPairRecord[],
  normalize: normalizePairings
});

export function rememberServerPairing(
  record: Omit<ServerPairRecord, 'updatedAt'> & { updatedAt?: number }
): void {
  if (!isValidServerIdentity(record.peerIdentity)) return;
  if (!SECRET_PATTERN.test(record.secret)) return;
  serverPairings.update((current) => normalizePairings([
    { ...record, updatedAt: record.updatedAt ?? Date.now() },
    ...current.filter((entry) => entry.peerIdentity !== record.peerIdentity)
  ]));
}

export function forgetServerPairing(peerIdentity: string): void {
  serverPairings.update((current) => current.filter((entry) => entry.peerIdentity !== peerIdentity));
}

export function findServerPairing(peerIdentity: string): ServerPairRecord | null {
  return serverPairings.getSnapshot().find((entry) => entry.peerIdentity === peerIdentity) ?? null;
}

export function setServerPairingInvitationByRoom(
  endpoint: string,
  roomId: string,
  invitationSecret: string
): void {
  if (!invitationSecret || invitationSecret.length > 512) return;
  serverPairings.update((current) => current.map((entry) =>
    entry.endpoint === endpoint && entry.roomId === roomId
      ? { ...entry, invitationSecret, updatedAt: Date.now() }
      : entry
  ));
}

export function setServerPairingInvitation(
  peerIdentity: string,
  invitation: { endpoint: string; roomId: string; invitationSecret: string | null }
): void {
  serverPairings.update((current) => normalizePairings(current.map((entry) =>
    entry.peerIdentity === peerIdentity
      ? { ...entry, endpoint: invitation.endpoint, roomId: invitation.roomId, invitationSecret: invitation.invitationSecret, updatedAt: Date.now() }
      : entry
  )));
}
