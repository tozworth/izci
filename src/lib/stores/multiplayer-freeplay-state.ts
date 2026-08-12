import type { PlaylistRepeatMode } from '$lib/contracts/catalog';
import { createPersistentStore } from './persistent-store';

export const MULTIPLAYER_FREEPLAY_STATE_STORAGE_KEY = 'izci.multiplayer-freeplay-state';
export const MULTIPLAYER_FREEPLAY_STATE_CHANNEL = 'izci-multiplayer-freeplay-state';
export const MULTIPLAYER_FREEPLAY_QUEUE_MAX_IDS = 50_000;

export interface MultiplayerFreeplayState {
  hostId: string;
  queue: string[];
  shuffleEnabled: boolean;
  repeatMode: PlaylistRepeatMode;
  currentTrackId: string | null;
  savedAt: number;
}

export function normalizeMultiplayerFreeplayState(value: unknown): MultiplayerFreeplayState | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<MultiplayerFreeplayState>;
  if (typeof candidate.hostId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(candidate.hostId)) return null;
  const queue: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(candidate.queue)) {
    for (const id of candidate.queue) {
      if (typeof id !== 'string' || id.length === 0 || id.length > 200 || seen.has(id)) continue;
      seen.add(id);
      queue.push(id);
      if (queue.length >= MULTIPLAYER_FREEPLAY_QUEUE_MAX_IDS) break;
    }
  }
  return {
    hostId: candidate.hostId,
    queue,
    shuffleEnabled: candidate.shuffleEnabled === true,
    repeatMode: candidate.repeatMode === 'one' || candidate.repeatMode === 'all' ? candidate.repeatMode : 'off',
    currentTrackId: typeof candidate.currentTrackId === 'string'
      && candidate.currentTrackId.length > 0
      && candidate.currentTrackId.length <= 200
      ? candidate.currentTrackId
      : null,
    savedAt: typeof candidate.savedAt === 'number' && Number.isFinite(candidate.savedAt)
      ? candidate.savedAt
      : Date.now()
  };
}

export const multiplayerFreeplayState = createPersistentStore({
  storageKey: MULTIPLAYER_FREEPLAY_STATE_STORAGE_KEY,
  channelName: MULTIPLAYER_FREEPLAY_STATE_CHANNEL,
  defaultValue: null as MultiplayerFreeplayState | null,
  normalize: normalizeMultiplayerFreeplayState
});

export function rememberMultiplayerFreeplayState(
  state: Omit<MultiplayerFreeplayState, 'savedAt'>
): void {
  multiplayerFreeplayState.set({ ...state, savedAt: Date.now() });
}
