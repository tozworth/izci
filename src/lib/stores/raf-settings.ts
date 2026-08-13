import {
  RAF_EFFECT_REGISTRY,
  normalizeRafEffect,
  normalizeRafEffectDisplayName
} from '$lib/services/raf-effect-registry';
import type { RafEffectSettings, RafEffectType, RafRackSettings } from '$lib/contracts/raf';
import { createPersistentStore } from '$lib/settings/store';

export const RAF_SETTINGS_STORAGE_KEY = 'izci.raf-settings';
export const RAF_SETTINGS_CHANNEL = 'izci-raf-settings';
export const DEFAULT_RAF_SETTINGS: RafRackSettings = { enabled: true, effects: [] };

export function normalizeRafSettings(value: unknown): RafRackSettings {
  if (!value || typeof value !== 'object') return DEFAULT_RAF_SETTINGS;
  const source = value as { enabled?: unknown; effects?: unknown };
  const effects: RafEffectSettings[] = [];
  const ids = new Set<string>();

  if (Array.isArray(source.effects)) {
    for (const candidate of source.effects) {
      const effect = normalizeRafEffect(candidate);
      if (!effect || ids.has(effect.id)) continue;
      ids.add(effect.id);
      effects.push(effect);
    }
  }

  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : DEFAULT_RAF_SETTINGS.enabled,
    effects
  };
}

export function createRafEffectId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `raf-${crypto.randomUUID()}`;
  }
  return `raf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const store = createPersistentStore({
  storageKey: RAF_SETTINGS_STORAGE_KEY,
  channelName: RAF_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_RAF_SETTINGS,
  normalize: normalizeRafSettings
});

export const rafSettings = {
  subscribe: store.subscribe,
  getSnapshot: store.getSnapshot,
  replace(settings: unknown): RafRackSettings {
    return store.set(settings);
  },
  setEnabled(enabled: boolean): RafRackSettings {
    return store.update((settings) => ({ ...settings, enabled }));
  },
  addEffect(type: RafEffectType): RafRackSettings {
    return store.update((settings) => ({
      ...settings,
      effects: [...settings.effects, RAF_EFFECT_REGISTRY[type].createDefault(createRafEffectId())]
    }));
  },
  updateEffect(id: string, updater: (effect: RafEffectSettings) => RafEffectSettings): RafRackSettings {
    return store.update((settings) => ({
      ...settings,
      effects: settings.effects.map((effect) => effect.id === id ? updater(effect) : effect)
    }));
  },
  renameEffect(id: string, displayName: string): RafRackSettings {
    const normalizedName = normalizeRafEffectDisplayName(displayName);
    return store.update((settings) => ({
      ...settings,
      effects: settings.effects.map((effect) => {
        if (effect.id !== id) return effect;
        const { displayName: _currentName, ...rest } = effect;
        return { ...rest, ...(normalizedName ? { displayName: normalizedName } : {}) } as RafEffectSettings;
      })
    }));
  },
  cloneEffect(id: string): RafRackSettings {
    return store.update((settings) => {
      const sourceIndex = settings.effects.findIndex((effect) => effect.id === id);
      if (sourceIndex < 0) return settings;
      const clone = normalizeRafEffect({ ...settings.effects[sourceIndex], id: createRafEffectId() });
      if (!clone) return settings;
      const effects = [...settings.effects];
      effects.splice(sourceIndex + 1, 0, clone);
      return { ...settings, effects };
    });
  },
  removeEffect(id: string): RafRackSettings {
    return store.update((settings) => ({
      ...settings,
      effects: settings.effects.filter((effect) => effect.id !== id)
    }));
  },
  clearEffects(): RafRackSettings {
    return store.update((settings) => ({ ...settings, effects: [] }));
  },
  moveEffect(id: string, targetIndex: number): RafRackSettings {
    return store.update((settings) => {
      const sourceIndex = settings.effects.findIndex((effect) => effect.id === id);
      if (sourceIndex < 0) return settings;
      const effects = [...settings.effects];
      const [effect] = effects.splice(sourceIndex, 1);
      effects.splice(Math.min(Math.max(targetIndex, 0), effects.length), 0, effect);
      return { ...settings, effects };
    });
  },
  resetEffect(id: string): RafRackSettings {
    return store.update((settings) => ({
      ...settings,
      effects: settings.effects.map((effect) =>
        effect.id === id
          ? {
              ...RAF_EFFECT_REGISTRY[effect.type].createDefault(effect.id),
              enabled: effect.enabled,
              ...(effect.displayName ? { displayName: effect.displayName } : {})
            }
          : effect
      )
    }));
  },
  reset: store.reset
};
