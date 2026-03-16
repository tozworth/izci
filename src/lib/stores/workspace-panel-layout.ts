import { writable } from 'svelte/store';
import type { WorkspacePanelLayoutSettings } from '$lib/types';

export const WORKSPACE_PANEL_LAYOUT_STORAGE_KEY = 'izci.workspace-panel-layout.v1';
export const WORKSPACE_PANEL_LAYOUT_CHANNEL = 'izci-workspace-panel-layout';

export const DEFAULT_WORKSPACE_PANEL_LAYOUT: WorkspacePanelLayoutSettings = {
  playlistFraction: 0.28,
  libraryFraction: 0.42,
  detailsFraction: 0.3
};

let broadcastChannel: BroadcastChannel | null = null;
let syncInitialized = false;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

function normalizeLayoutSettings(value: unknown): WorkspacePanelLayoutSettings {
  const source =
    value && typeof value === 'object' ? (value as Partial<WorkspacePanelLayoutSettings>) : {};
  const playlistFraction = clamp(
    toNumber(source.playlistFraction, DEFAULT_WORKSPACE_PANEL_LAYOUT.playlistFraction),
    0.1,
    0.8
  );
  const libraryFraction = clamp(
    toNumber(source.libraryFraction, DEFAULT_WORKSPACE_PANEL_LAYOUT.libraryFraction),
    0.1,
    0.8
  );
  const detailsFraction = clamp(
    toNumber(source.detailsFraction, DEFAULT_WORKSPACE_PANEL_LAYOUT.detailsFraction),
    0.1,
    0.8
  );
  const total = playlistFraction + libraryFraction + detailsFraction;

  return {
    playlistFraction: playlistFraction / total,
    libraryFraction: libraryFraction / total,
    detailsFraction: detailsFraction / total
  };
}

function readStoredLayoutSettings(): WorkspacePanelLayoutSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_WORKSPACE_PANEL_LAYOUT;
  }

  try {
    const rawValue = window.localStorage.getItem(WORKSPACE_PANEL_LAYOUT_STORAGE_KEY);
    return rawValue ? normalizeLayoutSettings(JSON.parse(rawValue)) : DEFAULT_WORKSPACE_PANEL_LAYOUT;
  } catch {
    return DEFAULT_WORKSPACE_PANEL_LAYOUT;
  }
}

function persistLayoutSettings(settings: WorkspacePanelLayoutSettings): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(WORKSPACE_PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(settings));
  broadcastChannel?.postMessage(settings);
}

const store = writable<WorkspacePanelLayoutSettings>(readStoredLayoutSettings());
let currentSettings = readStoredLayoutSettings();

store.subscribe((value) => {
  currentSettings = value;
});

function initializeSync(): void {
  if (syncInitialized || typeof window === 'undefined') {
    return;
  }

  syncInitialized = true;

  window.addEventListener('storage', (event) => {
    if (event.key !== WORKSPACE_PANEL_LAYOUT_STORAGE_KEY || !event.newValue) {
      return;
    }

    try {
      store.set(normalizeLayoutSettings(JSON.parse(event.newValue)));
    } catch {
      store.set(DEFAULT_WORKSPACE_PANEL_LAYOUT);
    }
  });

  if ('BroadcastChannel' in window) {
    broadcastChannel = new BroadcastChannel(WORKSPACE_PANEL_LAYOUT_CHANNEL);
    broadcastChannel.addEventListener('message', (event) => {
      store.set(normalizeLayoutSettings(event.data));
    });
  }
}

initializeSync();

function setLayoutSettings(nextValue: unknown): WorkspacePanelLayoutSettings {
  const normalized = normalizeLayoutSettings(nextValue);
  store.set(normalized);
  persistLayoutSettings(normalized);
  return normalized;
}

export const workspacePanelLayout = {
  subscribe: store.subscribe,
  getSnapshot(): WorkspacePanelLayoutSettings {
    return currentSettings;
  },
  set(nextValue: WorkspacePanelLayoutSettings): WorkspacePanelLayoutSettings {
    return setLayoutSettings(nextValue);
  },
  update(patch: Partial<WorkspacePanelLayoutSettings>): WorkspacePanelLayoutSettings {
    return setLayoutSettings({
      ...currentSettings,
      ...patch
    });
  },
  reset(): WorkspacePanelLayoutSettings {
    return setLayoutSettings(DEFAULT_WORKSPACE_PANEL_LAYOUT);
  }
};
