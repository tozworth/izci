import { writable } from 'svelte/store';

export const PLAYER_VOLUME_STORAGE_KEY = 'izci.player-volume.v1';
export const PLAYER_VOLUME_CHANNEL = 'izci-player-volume';
export const DEFAULT_PLAYER_VOLUME = 0.85;

let broadcastChannel: BroadcastChannel | null = null;
let syncInitialized = false;

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

function readStoredVolume(): number {
  if (typeof window === 'undefined') {
    return DEFAULT_PLAYER_VOLUME;
  }

  try {
    const rawValue = window.localStorage.getItem(PLAYER_VOLUME_STORAGE_KEY);
    return rawValue ? normalizeVolume(JSON.parse(rawValue)) : DEFAULT_PLAYER_VOLUME;
  } catch {
    return DEFAULT_PLAYER_VOLUME;
  }
}

function persistVolume(volume: number): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(PLAYER_VOLUME_STORAGE_KEY, JSON.stringify(volume));
  broadcastChannel?.postMessage(volume);
}

const store = writable<number>(readStoredVolume());
let currentVolume = readStoredVolume();

store.subscribe((value) => {
  currentVolume = value;
});

function initializeSync(): void {
  if (syncInitialized || typeof window === 'undefined') {
    return;
  }

  syncInitialized = true;

  window.addEventListener('storage', (event) => {
    if (event.key !== PLAYER_VOLUME_STORAGE_KEY || !event.newValue) {
      return;
    }

    try {
      store.set(normalizeVolume(JSON.parse(event.newValue)));
    } catch {
      store.set(DEFAULT_PLAYER_VOLUME);
    }
  });

  if ('BroadcastChannel' in window) {
    broadcastChannel = new BroadcastChannel(PLAYER_VOLUME_CHANNEL);
    broadcastChannel.addEventListener('message', (event) => {
      store.set(normalizeVolume(event.data));
    });
  }
}

function setVolume(nextValue: unknown): number {
  const normalized = normalizeVolume(nextValue);
  store.set(normalized);
  persistVolume(normalized);
  return normalized;
}

initializeSync();

export const playerVolume = {
  subscribe: store.subscribe,
  getSnapshot(): number {
    return currentVolume;
  },
  set(nextValue: number): number {
    return setVolume(nextValue);
  },
  reset(): number {
    return setVolume(DEFAULT_PLAYER_VOLUME);
  }
};
