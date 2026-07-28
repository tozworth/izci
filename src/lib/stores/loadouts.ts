import type {
  Loadout,
  LoadoutAppearanceSettings,
  LoadoutColor,
  LoadoutPlaybackSettings,
  LoadoutSettings,
  LoadoutState,
  LoadoutTarget,
  LoadoutType
} from '$lib/types';
import { normalizeAppearanceSettings } from './appearance-settings';
import { normalizeModulePlaybackSettings } from './module-playback-settings';
import { createPersistentStore } from './persistent-store';
import { normalizePlaybackSettings } from './playback-settings';
import { normalizeVisualizerSettings } from './visualizer-settings';

export const LOADOUTS_STORAGE_KEY = 'izci.loadouts';
export const LOADOUTS_CHANNEL = 'izci-loadouts';
export const DEFAULT_LOADOUT_STATE: LoadoutState = {
  automaticEnabled: true,
  loadouts: []
};

const LOADOUT_TYPES: LoadoutType[] = ['file', 'path', 'type', 'tags', 'preset'];
export const LOADOUT_COLORS: LoadoutColor[] = [
  'white', 'red', 'orange', 'amber', 'lime', 'green',
  'teal', 'cyan', 'blue', 'indigo', 'violet', 'magenta'
];

function normalizeText(value: unknown, maximumLength = 240): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().slice(0, maximumLength);
  return normalized || null;
}

function normalizeTarget(value: unknown): LoadoutTarget | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<LoadoutTarget> & Record<string, unknown>;
  if (!LOADOUT_TYPES.includes(source.type as LoadoutType)) return null;

  switch (source.type) {
    case 'file': {
      const fileKey = normalizeText(source.fileKey, 640);
      const fileName = normalizeText(source.fileName, 240);
      return fileKey ? { type: 'file', fileKey, ...(fileName ? { fileName } : {}) } : null;
    }
    case 'path': {
      const folderId = normalizeText(source.folderId, 128);
      const folderName = normalizeText(source.folderName, 240);
      return folderId && folderName ? { type: 'path', folderId, folderName } : null;
    }
    case 'type': {
      const recognizedType = normalizeText(source.recognizedType, 80)?.toLowerCase();
      return recognizedType ? { type: 'type', recognizedType } : null;
    }
    case 'tags': {
      const pattern = typeof source.pattern === 'string' ? source.pattern.trim().slice(0, 500) : '';
      return pattern ? { type: 'tags', pattern } : null;
    }
    case 'preset':
      return { type: 'preset' };
  }

  return null;
}

function normalizePlayback(value: unknown): LoadoutPlaybackSettings | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<LoadoutPlaybackSettings>;
  const normalized = normalizePlaybackSettings(value);
  return {
    playbackRate: normalized.playbackRate,
    trueSpeed: normalized.trueSpeed,
    replayGainMode: normalized.replayGainMode,
    modules: normalizeModulePlaybackSettings(source.modules)
  };
}

function normalizeAppearance(value: unknown): LoadoutAppearanceSettings | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<LoadoutAppearanceSettings>;
  const appearance = normalizeAppearanceSettings({ backdropZones: source.backdropZones });
  return {
    backdropZones: appearance.backdropZones,
    visualizer: normalizeVisualizerSettings(source.visualizer)
  };
}

function normalizeSettings(value: unknown): LoadoutSettings | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<LoadoutSettings>;
  const settings: LoadoutSettings = {};
  const playback = normalizePlayback(source.playback);
  const appearance = normalizeAppearance(source.appearance);
  const rafPresetName = normalizeText(source.raf?.presetName, 80);
  const rafEnabled = typeof source.raf?.enabled === 'boolean' ? source.raf.enabled : null;

  if (playback) settings.playback = playback;
  if (rafPresetName && rafEnabled !== null) {
    settings.raf = { presetName: rafPresetName, enabled: rafEnabled };
  }
  if (appearance) settings.appearance = appearance;

  return Object.keys(settings).length > 0 ? settings : null;
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

function normalizeLoadout(value: unknown, ids: Set<string>): Loadout | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<Loadout>;
  const id = normalizeText(source.id, 128);
  const name = normalizeText(source.name);
  const color = LOADOUT_COLORS.includes(source.color as LoadoutColor)
    ? source.color as LoadoutColor
    : undefined;
  const target = normalizeTarget(source.target);
  const settings = normalizeSettings(source.settings);

  if (!id || ids.has(id) || !name || !target || !settings) return null;
  ids.add(id);
  const createdAt = normalizeTimestamp(source.createdAt, Date.now());
  return {
    id,
    name,
    ...(color ? { color } : {}),
    target,
    settings,
    createdAt,
    updatedAt: normalizeTimestamp(source.updatedAt, createdAt)
  };
}

export function normalizeLoadoutState(value: unknown): LoadoutState {
  if (!value || typeof value !== 'object') return DEFAULT_LOADOUT_STATE;
  const source = value as Partial<LoadoutState>;
  const ids = new Set<string>();
  return {
    automaticEnabled: source.automaticEnabled !== false,
    loadouts: Array.isArray(source.loadouts)
      ? source.loadouts
          .map((candidate) => normalizeLoadout(candidate, ids))
          .filter((candidate): candidate is Loadout => candidate !== null)
      : []
  };
}

export function createLoadoutId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `loadout-${crypto.randomUUID()}`;
  }
  return `loadout-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const store = createPersistentStore({
  storageKey: LOADOUTS_STORAGE_KEY,
  channelName: LOADOUTS_CHANNEL,
  defaultValue: DEFAULT_LOADOUT_STATE,
  normalize: normalizeLoadoutState
});

export const loadouts = {
  subscribe: store.subscribe,
  getSnapshot: store.getSnapshot,
  setAutomaticEnabled(automaticEnabled: boolean): LoadoutState {
    return store.update((state) => ({ ...state, automaticEnabled }));
  },
  create(name: string, target: LoadoutTarget, settings: LoadoutSettings): Loadout | null {
    const now = Date.now();
    const candidate = normalizeLoadout(
      { id: createLoadoutId(), name, target, settings, createdAt: now, updatedAt: now },
      new Set(store.getSnapshot().loadouts.map((loadout) => loadout.id))
    );
    if (!candidate) return null;
    store.update((state) => ({ ...state, loadouts: [...state.loadouts, candidate] }));
    return candidate;
  },
  updateSettings(id: string, settings: LoadoutSettings): Loadout | null {
    const normalized = normalizeSettings(settings);
    if (!normalized) return null;
    let updated: Loadout | null = null;
    store.update((state) => ({
      ...state,
      loadouts: state.loadouts.map((loadout) => {
        if (loadout.id !== id) return loadout;
        updated = { ...loadout, settings: normalized, updatedAt: Date.now() };
        return updated;
      })
    }));
    return updated;
  },
  rename(id: string, name: string): Loadout | null {
    const normalized = normalizeText(name);
    if (!normalized) return null;
    let updated: Loadout | null = null;
    store.update((state) => ({
      ...state,
      loadouts: state.loadouts.map((loadout) => {
        if (loadout.id !== id) return loadout;
        const target = loadout.target.type === 'file' && !loadout.target.fileName
          ? { ...loadout.target, fileName: loadout.name }
          : loadout.target;
        updated = { ...loadout, name: normalized, target, updatedAt: Date.now() };
        return updated;
      })
    }));
    return updated;
  },
  setColor(id: string, color?: LoadoutColor): Loadout | null {
    if (color !== undefined && !LOADOUT_COLORS.includes(color)) return null;
    let updated: Loadout | null = null;
    store.update((state) => ({
      ...state,
      loadouts: state.loadouts.map((loadout) => {
        if (loadout.id !== id) return loadout;
        const { color: _previousColor, ...rest } = loadout;
        updated = { ...rest, ...(color ? { color } : {}), updatedAt: Date.now() };
        return updated;
      })
    }));
    return updated;
  },
  move(id: string, targetIndex: number): LoadoutState {
    return store.update((state) => {
      const sourceIndex = state.loadouts.findIndex((loadout) => loadout.id === id);
      if (sourceIndex < 0) return state;
      const nextLoadouts = [...state.loadouts];
      const [movedLoadout] = nextLoadouts.splice(sourceIndex, 1);
      nextLoadouts.splice(Math.min(Math.max(targetIndex, 0), nextLoadouts.length), 0, movedLoadout);
      return { ...state, loadouts: nextLoadouts };
    });
  },
  delete(id: string): LoadoutState {
    return store.update((state) => ({
      ...state,
      loadouts: state.loadouts.filter((loadout) => loadout.id !== id)
    }));
  },
  reset: store.reset
};
