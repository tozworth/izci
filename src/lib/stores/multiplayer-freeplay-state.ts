import { createPersistentStore } from './persistent-store';
import type { PlaylistRepeatMode } from '$lib/types';

export const MULTIPLAYER_FREEPLAY_STATE_STORAGE_KEY = 'izci.multiplayer-freeplay-state';
export const MULTIPLAYER_FREEPLAY_STATE_CHANNEL = 'izci-multiplayer-freeplay-state';

// Matches the wire sanity bound; the queue is only catalog item IDs, so a
// 50k-entry record is a few hundred KB at most.
export const MULTIPLAYER_FREEPLAY_QUEUE_MAX_IDS = 50_000;

/**
 * The Freeplay client's owned session state, keyed by the paired host so a
 * later session with the same host restores the queue and transport flags.
 * Only catalog item IDs are stored — never host content or artwork.
 */
export interface MultiplayerFreeplayState {
  hostId: string;
  queue: string[];
  shuffleEnabled: boolean;
  repeatMode: PlaylistRepeatMode;
  /**
   * The catalog item id of the track that was playing. Restored after a
   * reconnect so the client can re-activate it on the fresh host peer (a host
   * restart wipes the host-side selection memory).
   */
  currentTrackId: string | null;
  savedAt: number;
}

function normalizeFreeplayState(value: unknown): MultiplayerFreeplayState | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<MultiplayerFreeplayState>;
  if (typeof candidate.hostId !== 'string'
    || !/^[A-Za-z0-9_-]{1,128}$/.test(candidate.hostId)) {
    return null;
  }
  const seen = new Set<string>();
  const queue: string[] = [];
  if (Array.isArray(candidate.queue)) {
    for (const id of candidate.queue) {
      if (typeof id !== 'string' || id.length === 0 || id.length > 200) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push(id);
      if (queue.length >= MULTIPLAYER_FREEPLAY_QUEUE_MAX_IDS) break;
    }
  }
  const shuffleEnabled = candidate.shuffleEnabled === true;
  const repeatMode = candidate.repeatMode === 'all' || candidate.repeatMode === 'one'
    ? candidate.repeatMode
    : 'off';
  const currentTrackId = typeof candidate.currentTrackId === 'string'
    && candidate.currentTrackId.length > 0
    && candidate.currentTrackId.length <= 200
    ? candidate.currentTrackId
    : null;
  const savedAt = typeof candidate.savedAt === 'number' && Number.isFinite(candidate.savedAt)
    ? candidate.savedAt
    : Date.now();
  return { hostId: candidate.hostId, queue, shuffleEnabled, repeatMode, currentTrackId, savedAt };
}

export const multiplayerFreeplayState = createPersistentStore({
  storageKey: MULTIPLAYER_FREEPLAY_STATE_STORAGE_KEY,
  channelName: MULTIPLAYER_FREEPLAY_STATE_CHANNEL,
  defaultValue: null as MultiplayerFreeplayState | null,
  normalize: normalizeFreeplayState
});

export interface RememberMultiplayerFreeplayStateInput {
  hostId: string;
  queue: string[];
  shuffleEnabled: boolean;
  repeatMode: PlaylistRepeatMode;
  currentTrackId: string | null;
}

/**
 * Records the client-owned Freeplay state for a host. Written on every queue
 * or transport-flag change; the next session with the same host restores it.
 * Best-effort localStorage — a failed write is never fatal.
 */
export function rememberMultiplayerFreeplayState(state: RememberMultiplayerFreeplayStateInput): void {
  multiplayerFreeplayState.set({
    hostId: state.hostId,
    queue: state.queue,
    shuffleEnabled: state.shuffleEnabled,
    repeatMode: state.repeatMode,
    currentTrackId: state.currentTrackId,
    savedAt: Date.now()
  });
}
