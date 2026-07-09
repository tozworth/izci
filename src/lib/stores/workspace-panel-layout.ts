import type { WorkspacePanelLayoutSettings } from '$lib/types';
import { createPersistentStore } from './persistent-store';

export const WORKSPACE_PANEL_LAYOUT_STORAGE_KEY = 'izci.workspace-panel-layout.v2';
export const WORKSPACE_PANEL_LAYOUT_CHANNEL = 'izci-workspace-panel-layout';

export const DEFAULT_WORKSPACE_PANEL_LAYOUT: WorkspacePanelLayoutSettings = {
  leftFraction: 0.28,
  centerFraction: 0.42,
  rightFraction: 0.3
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
  const leftFraction = clamp(
    toNumber(source.leftFraction, DEFAULT_WORKSPACE_PANEL_LAYOUT.leftFraction),
    0.1,
    0.8
  );
  const centerFraction = clamp(
    toNumber(source.centerFraction, DEFAULT_WORKSPACE_PANEL_LAYOUT.centerFraction),
    0.1,
    0.8
  );
  const rightFraction = clamp(
    toNumber(source.rightFraction, DEFAULT_WORKSPACE_PANEL_LAYOUT.rightFraction),
    0.1,
    0.8
  );
  const total = leftFraction + centerFraction + rightFraction;

  return {
    leftFraction: leftFraction / total,
    centerFraction: centerFraction / total,
    rightFraction: rightFraction / total
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
