import type { WorkspacePanelLayoutSettings } from '$lib/types';
import { createPersistentStore } from './persistent-store';

export const WORKSPACE_PANEL_LAYOUT_STORAGE_KEY = 'izci.workspace-panel-layout.v1';
export const WORKSPACE_PANEL_LAYOUT_CHANNEL = 'izci-workspace-panel-layout';

export const DEFAULT_WORKSPACE_PANEL_LAYOUT: WorkspacePanelLayoutSettings = {
  playlistFraction: 0.28,
  libraryFraction: 0.42,
  detailsFraction: 0.3
};

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

const store = createPersistentStore({
  storageKey: WORKSPACE_PANEL_LAYOUT_STORAGE_KEY,
  channelName: WORKSPACE_PANEL_LAYOUT_CHANNEL,
  defaultValue: DEFAULT_WORKSPACE_PANEL_LAYOUT,
  normalize: normalizeLayoutSettings
});

export const workspacePanelLayout = {
  subscribe: store.subscribe,
  getSnapshot: store.getSnapshot,
  set(nextValue: WorkspacePanelLayoutSettings): WorkspacePanelLayoutSettings {
    return store.set(nextValue);
  },
  update(patch: Partial<WorkspacePanelLayoutSettings>): WorkspacePanelLayoutSettings {
    return store.update((settings) => ({ ...settings, ...patch }));
  },
  reset: store.reset
};
