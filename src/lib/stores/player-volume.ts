import { createPersistentStore } from './persistent-store';

const PLAYER_VOLUME_STORAGE_KEY = 'izci.player-volume.v1';
const PLAYER_VOLUME_CHANNEL = 'izci-player-volume';
export const DEFAULT_PLAYER_VOLUME = 0.85;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizeVolume(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clamp(value, 0, 1);
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return clamp(parsed, 0, 1);
    }
  }

  return DEFAULT_PLAYER_VOLUME;
}

const store = createPersistentStore({
  storageKey: PLAYER_VOLUME_STORAGE_KEY,
  channelName: PLAYER_VOLUME_CHANNEL,
  defaultValue: DEFAULT_PLAYER_VOLUME,
  normalize: normalizeVolume
});

export const playerVolume = {
  subscribe: store.subscribe,
  getSnapshot: store.getSnapshot,
  set(nextValue: number): number {
    return store.set(nextValue);
  },
  reset: store.reset
};
