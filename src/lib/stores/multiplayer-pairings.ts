import { createPersistentStore } from './persistent-store';

const MULTIPLAYER_PAIRINGS_STORAGE_KEY = 'izci.multiplayer-pairings';
const MULTIPLAYER_PAIRINGS_CHANNEL = 'izci-multiplayer-pairings';

export interface MultiplayerPairing {
  hostId: string;
  name: string;
  freeplay: boolean;
}

function normalizePairings(value: unknown): MultiplayerPairing[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const pairings: MultiplayerPairing[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') continue;
    const { hostId, name, freeplay } = candidate as Partial<MultiplayerPairing>;
    if (typeof hostId !== 'string' || typeof name !== 'string') continue;
    const cleanName = name.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 48);
    if (!cleanName || !/^[A-Za-z0-9_-]{1,128}$/.test(hostId) || seen.has(hostId)) continue;
    seen.add(hostId);
    pairings.push({ hostId, name: cleanName, freeplay: freeplay === true });
  }
  return pairings;
}

export const multiplayerPairings = createPersistentStore({
  storageKey: MULTIPLAYER_PAIRINGS_STORAGE_KEY,
  channelName: MULTIPLAYER_PAIRINGS_CHANNEL,
  defaultValue: [] as MultiplayerPairing[],
  normalize: normalizePairings
});

export function rememberMultiplayerPairing(hostId: string, name: string, freeplay = false): void {
  multiplayerPairings.update((current) => [
    { hostId, name, freeplay },
    ...current.filter((pairing) => pairing.hostId !== hostId)
  ]);
}

export function forgetMultiplayerPairing(hostId: string): void {
  multiplayerPairings.update((current) => current.filter((pairing) => pairing.hostId !== hostId));
}
