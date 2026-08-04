import type { ExperimentalSettings } from '$lib/types';
import { createSettingsStore } from './persistent-store';

export const EXPERIMENTAL_SETTINGS_STORAGE_KEY = 'izci.experimental-settings';
export const EXPERIMENTAL_SETTINGS_CHANNEL = 'izci-experimental-settings';

const NAME_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const MULTIPLAYER_OPUS_BITRATE_MIN_KBPS = 32;
export const MULTIPLAYER_OPUS_BITRATE_MAX_KBPS = 160;
export const MULTIPLAYER_OPUS_BITRATE_STEP_KBPS = 8;
export const MULTIPLAYER_AUDIO_BUFFER_MIN_MS = 100;
export const MULTIPLAYER_AUDIO_BUFFER_MAX_MS = 4_000;
export const MULTIPLAYER_AUDIO_BUFFER_STEP_MS = 50;
export const MULTIPLAYER_FILE_TRANSFER_LIMITS_MIB = [0, 1, 2, 4, 8, 16, 32, 64, -1] as const;
export const MULTIPLAYER_MAX_LISTENERS_MIN = 1;
export const MULTIPLAYER_MAX_LISTENERS_MAX = 8;
export const MULTIPLAYER_TURN_URL_MAX_LENGTH = 512;
export const MULTIPLAYER_TURN_SECRET_MAX_LENGTH = 512;
export const MULTIPLAYER_TURN_CREDENTIAL_HOURS_MIN = 1;
export const MULTIPLAYER_TURN_CREDENTIAL_HOURS_MAX = 48;

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

function normalizeSingleLine(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength)
    : '';
}

export function normalizeMultiplayerTurnUrl(value: unknown): string {
  const url = normalizeSingleLine(value, MULTIPLAYER_TURN_URL_MAX_LENGTH);
  if (!url) return '';
  return /^(?:turn|turns):/i.test(url) ? url : `turn:${url}`;
}

const defaultIzciName = createDefaultIzciName();

export const DEFAULT_EXPERIMENTAL_SETTINGS: ExperimentalSettings = {
  multiplayer: false,
  izciName: defaultIzciName,
  multiplayerWaitForClients: false,
  multiplayerTurnUrl: '',
  multiplayerTurnSecret: '',
  multiplayerTurnCredentialHours: 12,
  multiplayerForceTurn: false,
  multiplayerFreeplay: false,
  multiplayerStreamAudio: true,
  multiplayerFileTransferLimitMiB: 0,
  multiplayerSendPostRaf: false,
  multiplayerOpusBitrateKbps: 128,
  multiplayerAudioBufferMs: 750,
  multiplayerMaxListeners: 4
};

function normalizeFileTransferLimit(value: unknown): number {
  return typeof value === 'number'
    && MULTIPLAYER_FILE_TRANSFER_LIMITS_MIB.includes(
      value as (typeof MULTIPLAYER_FILE_TRANSFER_LIMITS_MIB)[number]
    )
    ? value
    : DEFAULT_EXPERIMENTAL_SETTINGS.multiplayerFileTransferLimitMiB;
}

function normalizeBoundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(Math.round(value), min), max)
    : fallback;
}

export function normalizeExperimentalSettings(value: unknown): ExperimentalSettings {
  const source = value && typeof value === 'object'
    ? value as Partial<ExperimentalSettings>
    : {};

  return {
    multiplayer: typeof source.multiplayer === 'boolean'
      ? source.multiplayer
      : DEFAULT_EXPERIMENTAL_SETTINGS.multiplayer,
    izciName: normalizeIzciName(source.izciName, defaultIzciName),
    multiplayerWaitForClients: typeof source.multiplayerWaitForClients === 'boolean'
      ? source.multiplayerWaitForClients
      : DEFAULT_EXPERIMENTAL_SETTINGS.multiplayerWaitForClients,
    multiplayerTurnUrl: normalizeMultiplayerTurnUrl(source.multiplayerTurnUrl),
    multiplayerTurnSecret: normalizeSingleLine(
      source.multiplayerTurnSecret,
      MULTIPLAYER_TURN_SECRET_MAX_LENGTH
    ),
    multiplayerTurnCredentialHours: normalizeBoundedInteger(
      source.multiplayerTurnCredentialHours,
      DEFAULT_EXPERIMENTAL_SETTINGS.multiplayerTurnCredentialHours,
      MULTIPLAYER_TURN_CREDENTIAL_HOURS_MIN,
      MULTIPLAYER_TURN_CREDENTIAL_HOURS_MAX
    ),
    multiplayerForceTurn: typeof source.multiplayerForceTurn === 'boolean'
      ? source.multiplayerForceTurn
      : DEFAULT_EXPERIMENTAL_SETTINGS.multiplayerForceTurn,
    multiplayerFreeplay: typeof source.multiplayerFreeplay === 'boolean'
      ? source.multiplayerFreeplay
      : DEFAULT_EXPERIMENTAL_SETTINGS.multiplayerFreeplay,
    multiplayerStreamAudio: typeof source.multiplayerStreamAudio === 'boolean'
      ? source.multiplayerStreamAudio
      : DEFAULT_EXPERIMENTAL_SETTINGS.multiplayerStreamAudio,
    multiplayerFileTransferLimitMiB: normalizeFileTransferLimit(
      source.multiplayerFileTransferLimitMiB
    ),
    multiplayerSendPostRaf: typeof source.multiplayerSendPostRaf === 'boolean'
      ? source.multiplayerSendPostRaf
      : DEFAULT_EXPERIMENTAL_SETTINGS.multiplayerSendPostRaf,
    multiplayerOpusBitrateKbps: normalizeBoundedInteger(
      source.multiplayerOpusBitrateKbps,
      DEFAULT_EXPERIMENTAL_SETTINGS.multiplayerOpusBitrateKbps,
      MULTIPLAYER_OPUS_BITRATE_MIN_KBPS,
      MULTIPLAYER_OPUS_BITRATE_MAX_KBPS
    ),
    multiplayerAudioBufferMs: normalizeBoundedInteger(
      source.multiplayerAudioBufferMs,
      DEFAULT_EXPERIMENTAL_SETTINGS.multiplayerAudioBufferMs,
      MULTIPLAYER_AUDIO_BUFFER_MIN_MS,
      MULTIPLAYER_AUDIO_BUFFER_MAX_MS
    ),
    multiplayerMaxListeners: normalizeBoundedInteger(
      source.multiplayerMaxListeners,
      DEFAULT_EXPERIMENTAL_SETTINGS.multiplayerMaxListeners,
      MULTIPLAYER_MAX_LISTENERS_MIN,
      MULTIPLAYER_MAX_LISTENERS_MAX
    )
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
