import type { ExperimentalSettings } from '$lib/types';
import { createSettingsStore } from './persistent-store';

export const EXPERIMENTAL_SETTINGS_STORAGE_KEY = 'izci.experimental-settings';
export const EXPERIMENTAL_SETTINGS_CHANNEL = 'izci-experimental-settings';

const NAME_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function createDefaultIzciName(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `Scout ${Array.from(bytes, (byte) => NAME_ALPHABET[byte % NAME_ALPHABET.length]).join('')}`;
}

export function normalizeIzciName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const name = value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 48);
  return name || fallback;
}

const defaultIzciName = createDefaultIzciName();

export const DEFAULT_EXPERIMENTAL_SETTINGS: ExperimentalSettings = {
  multiplayer: false,
  izciName: defaultIzciName
};

export function normalizeExperimentalSettings(value: unknown): ExperimentalSettings {
  const source = value && typeof value === 'object'
    ? value as Partial<ExperimentalSettings>
    : {};

  return {
    multiplayer: typeof source.multiplayer === 'boolean'
      ? source.multiplayer
      : DEFAULT_EXPERIMENTAL_SETTINGS.multiplayer,
    izciName: normalizeIzciName(source.izciName, defaultIzciName)
  };
}

export const experimentalSettings = createSettingsStore({
  storageKey: EXPERIMENTAL_SETTINGS_STORAGE_KEY,
  channelName: EXPERIMENTAL_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_EXPERIMENTAL_SETTINGS,
  normalize: normalizeExperimentalSettings
});

if (typeof window !== 'undefined') {
  let hasStoredName = false;
  try {
    const stored = JSON.parse(window.localStorage.getItem(EXPERIMENTAL_SETTINGS_STORAGE_KEY) ?? 'null') as unknown;
    hasStoredName = Boolean(
      stored
      && typeof stored === 'object'
      && typeof (stored as Partial<ExperimentalSettings>).izciName === 'string'
      && (stored as Partial<ExperimentalSettings>).izciName?.trim()
    );
  } catch {
    // Persist the normalized defaults below.
  }
  if (!hasStoredName) experimentalSettings.set(experimentalSettings.getSnapshot());
}
