import { createPersistentStore } from '$lib/settings/store';

export const MULTIPLAYER_RECENTS_STORAGE_KEY = 'izci.multiplayer-recents';
export const MULTIPLAYER_RECENTS_CHANNEL = 'izci-multiplayer-recents';
export const MULTIPLAYER_RECENTS_LIMIT = 5;

export interface MultiplayerRecent {
  name: string;
  inviteCode: string;
}

function normalizeRecents(value: unknown): MultiplayerRecent[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const recents: MultiplayerRecent[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const { name, inviteCode } = candidate as Partial<MultiplayerRecent>;
    if (typeof name !== 'string' || typeof inviteCode !== 'string') continue;
    const cleanName = name.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 48);
    if (!cleanName || !/^[a-z0-9]{8}$/.test(inviteCode) || seen.has(inviteCode)) continue;
    seen.add(inviteCode);
    recents.push({ name: cleanName, inviteCode });
    if (recents.length === MULTIPLAYER_RECENTS_LIMIT) break;
  }
  return recents;
}

export const multiplayerRecents = createPersistentStore({
  storageKey: MULTIPLAYER_RECENTS_STORAGE_KEY,
  channelName: MULTIPLAYER_RECENTS_CHANNEL,
  defaultValue: [] as MultiplayerRecent[],
  normalize: normalizeRecents
});

export function rememberMultiplayerHost(name: string, inviteCode: string): void {
  multiplayerRecents.update((current) => [
    { name, inviteCode },
    ...current.filter((recent) => recent.inviteCode !== inviteCode)
  ]);
}
