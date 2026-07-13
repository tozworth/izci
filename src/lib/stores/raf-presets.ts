import { samePersistentValue } from './persistent-store';
import { normalizeRafSettings, rafSettings } from './raf-settings';
import { createPersistentStore } from './persistent-store';
import type { RafPreset, RafPresetState, RafRackSettings } from '$lib/types';

export const RAF_PRESETS_STORAGE_KEY = 'izci.raf-presets';
export const RAF_PRESETS_CHANNEL = 'izci-raf-presets';
export const DEFAULT_RAF_PRESET_STATE: RafPresetState = { presets: [], selectedPresetId: null };

export function compareRafPresetNames(first: RafPreset, second: RafPreset): number {
  return first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: 'base' });
}

function normalizePresetName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ').slice(0, 80);
  return name || null;
}

export function normalizeRafPresetState(value: unknown): RafPresetState {
  if (!value || typeof value !== 'object') return DEFAULT_RAF_PRESET_STATE;
  const source = value as { presets?: unknown; selectedPresetId?: unknown };
  const presets: RafPreset[] = [];
  const ids = new Set<string>();

  if (Array.isArray(source.presets)) {
    for (const candidate of source.presets) {
      if (!candidate || typeof candidate !== 'object') continue;
      const preset = candidate as { id?: unknown; name?: unknown; settings?: unknown };
      const name = normalizePresetName(preset.name);
      if (
        typeof preset.id !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(preset.id) ||
        ids.has(preset.id) ||
        !name
      ) continue;
      ids.add(preset.id);
      presets.push({ id: preset.id, name, settings: normalizeRafSettings(preset.settings) });
    }
  }

  presets.sort(compareRafPresetNames);

  const selectedPresetId = typeof source.selectedPresetId === 'string' && ids.has(source.selectedPresetId)
    ? source.selectedPresetId
    : null;
  return { presets, selectedPresetId };
}

export function createRafPresetId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `raf-preset-${crypto.randomUUID()}`;
  }
  return `raf-preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function isRafPresetDirty(state: RafPresetState, settings: RafRackSettings): boolean {
  const preset = state.presets.find((candidate) => candidate.id === state.selectedPresetId);
  return Boolean(preset && !samePersistentValue(preset.settings, normalizeRafSettings(settings)));
}

const store = createPersistentStore({
  storageKey: RAF_PRESETS_STORAGE_KEY,
  channelName: RAF_PRESETS_CHANNEL,
  defaultValue: DEFAULT_RAF_PRESET_STATE,
  normalize: normalizeRafPresetState
});

export const rafPresets = {
  subscribe: store.subscribe,
  getSnapshot: store.getSnapshot,
  create(name: string, settings: RafRackSettings = rafSettings.getSnapshot()): RafPreset | null {
    const normalizedName = normalizePresetName(name);
    if (!normalizedName) return null;
    const preset = { id: createRafPresetId(), name: normalizedName, settings: normalizeRafSettings(settings) };
    store.update((state) => ({
      presets: [...state.presets, preset],
      selectedPresetId: preset.id
    }));
    return preset;
  },
  apply(id: string): RafRackSettings | null {
    const preset = store.getSnapshot().presets.find((candidate) => candidate.id === id);
    if (!preset) return null;
    store.update((state) => ({ ...state, selectedPresetId: id }));
    return rafSettings.replace(preset.settings);
  },
  save(): RafPreset | null {
    const state = store.getSnapshot();
    const index = state.presets.findIndex((preset) => preset.id === state.selectedPresetId);
    if (index < 0) return null;
    const presets = [...state.presets];
    presets[index] = { ...presets[index], settings: normalizeRafSettings(rafSettings.getSnapshot()) };
    store.set({ ...state, presets });
    return presets[index];
  },
  rename(id: string, name: string): RafPreset | null {
    const normalizedName = normalizePresetName(name);
    if (!normalizedName) return null;
    let renamed: RafPreset | null = null;
    store.update((state) => ({
      ...state,
      presets: state.presets.map((preset) => {
        if (preset.id !== id) return preset;
        renamed = { ...preset, name: normalizedName };
        return renamed;
      })
    }));
    return renamed;
  },
  delete(id: string): RafPresetState {
    return store.update((state) => ({
      presets: state.presets.filter((preset) => preset.id !== id),
      selectedPresetId: state.selectedPresetId === id ? null : state.selectedPresetId
    }));
  },
  reset: store.reset
};
