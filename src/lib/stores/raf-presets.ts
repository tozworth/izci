import { samePersistentValue } from './persistent-store';
import { normalizeRafSettings, rafSettings } from './raf-settings';
import { createPersistentStore } from './persistent-store';
import { LOADOUT_COLORS } from './loadouts';
import type { LoadoutColor } from '$lib/types';
import { normalizePresetIcon, type PresetIcon } from '$lib/utils/preset-icons';
import type { RafPreset, RafPresetSettings, RafPresetState, RafRackSettings } from '$lib/types';

const RAF_PRESETS_STORAGE_KEY = 'izci.raf-presets';
const RAF_PRESETS_CHANNEL = 'izci-raf-presets';
export const DEFAULT_RAF_PRESET_STATE: RafPresetState = { presets: [], selectedPresetId: null };

function compareRafPresetNames(first: RafPreset, second: RafPreset): number {
  return first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: 'base' });
}

function normalizePresetName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.trim().replace(/\s+/g, ' ').slice(0, 80);
  return name || null;
}

function toPresetSettings(settings: unknown): RafPresetSettings {
  return { effects: normalizeRafSettings(settings).effects };
}

export function normalizeRafPresetState(value: unknown): RafPresetState {
  if (!value || typeof value !== 'object') return DEFAULT_RAF_PRESET_STATE;
  const source = value as { presets?: unknown; selectedPresetId?: unknown };
  const presets: RafPreset[] = [];
  const ids = new Set<string>();

  if (Array.isArray(source.presets)) {
    for (const candidate of source.presets) {
      if (!candidate || typeof candidate !== 'object') continue;
      const preset = candidate as { id?: unknown; name?: unknown; color?: unknown; icon?: unknown; settings?: unknown };
      const name = normalizePresetName(preset.name);
      if (
        typeof preset.id !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(preset.id) ||
        ids.has(preset.id) ||
        !name
      ) continue;
      ids.add(preset.id);
      const color = LOADOUT_COLORS.includes(preset.color as LoadoutColor) ? preset.color as LoadoutColor : undefined;
      const icon = normalizePresetIcon(preset.icon);
      presets.push({ id: preset.id, name, ...(color ? { color } : {}), ...(icon ? { icon } : {}), settings: toPresetSettings(preset.settings) });
    }
  }

  presets.sort(compareRafPresetNames);

  const selectedPresetId = typeof source.selectedPresetId === 'string' && ids.has(source.selectedPresetId)
    ? source.selectedPresetId
    : null;
  return { presets, selectedPresetId };
}

function createRafPresetId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `raf-preset-${crypto.randomUUID()}`;
  }
  return `raf-preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function isRafPresetDirty(state: RafPresetState, settings: RafRackSettings): boolean {
  const preset = state.presets.find((candidate) => candidate.id === state.selectedPresetId);
  return Boolean(preset && !samePersistentValue(preset.settings, toPresetSettings(settings)));
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
  setSelectedPresetId(id: string | null): RafPresetState {
    return store.update((state) => ({
      ...state,
      selectedPresetId: id && state.presets.some((preset) => preset.id === id) ? id : null
    }));
  },
  create(name: string, settings: RafRackSettings = rafSettings.getSnapshot()): RafPreset | null {
    const normalizedName = normalizePresetName(name);
    if (!normalizedName) return null;
    const preset = { id: createRafPresetId(), name: normalizedName, settings: toPresetSettings(settings) };
    store.update((state) => ({
      presets: [...state.presets, preset],
      selectedPresetId: preset.id
    }));
    return preset;
  },
  apply(id: string, enabled = rafSettings.getSnapshot().enabled): RafRackSettings | null {
    const preset = store.getSnapshot().presets.find((candidate) => candidate.id === id);
    if (!preset) return null;
    const settings = rafSettings.replace({ enabled, effects: preset.settings.effects });
    store.update((state) => ({ ...state, selectedPresetId: id }));
    return settings;
  },
  save(): RafPreset | null {
    const state = store.getSnapshot();
    const index = state.presets.findIndex((preset) => preset.id === state.selectedPresetId);
    if (index < 0) return null;
    const presets = [...state.presets];
    presets[index] = { ...presets[index], settings: toPresetSettings(rafSettings.getSnapshot()) };
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
  setColor(id: string, color?: LoadoutColor): RafPreset | null {
    if (color !== undefined && !LOADOUT_COLORS.includes(color)) return null;
    let updated: RafPreset | null = null;
    store.update((state) => ({
      ...state,
      presets: state.presets.map((preset) => {
        if (preset.id !== id) return preset;
        const { color: _previousColor, ...rest } = preset;
        updated = { ...rest, ...(color ? { color } : {}) };
        return updated;
      })
    }));
    return updated;
  },
  setIcon(id: string, icon?: PresetIcon): RafPreset | null {
    if (icon !== undefined && !normalizePresetIcon(icon)) return null;
    let updated: RafPreset | null = null;
    store.update((state) => ({
      ...state,
      presets: state.presets.map((preset) => {
        if (preset.id !== id) return preset;
        const { icon: _previousIcon, ...rest } = preset;
        updated = { ...rest, ...(icon ? { icon } : {}) };
        return updated;
      })
    }));
    return updated;
  },
  delete(id: string): RafPresetState {
    return store.update((state) => ({
      presets: state.presets.filter((preset) => preset.id !== id),
      selectedPresetId: state.selectedPresetId === id ? null : state.selectedPresetId
    }));
  },
  reset: store.reset
};
