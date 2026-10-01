import type { MultiplayerSettings } from '$lib/types';
import { hasBuiltinSignaling } from '$platform';
import { createSettingsStore, normalizeBoolean } from './persistent-store';

const MULTIPLAYER_SETTINGS_STORAGE_KEY = 'izci.multiplayer-settings';
const MULTIPLAYER_SETTINGS_CHANNEL = 'izci-multiplayer-settings';

const NAME_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const MULTIPLAYER_OPUS_BITRATE_MIN_KBPS = 32;
export const MULTIPLAYER_OPUS_BITRATE_MAX_KBPS = 160;
export const MULTIPLAYER_OPUS_BITRATE_STEP_KBPS = 8;
export const MULTIPLAYER_AUDIO_BUFFER_MIN_MS = 1_000;
export const MULTIPLAYER_AUDIO_BUFFER_MAX_MS = 30_000;
export const MULTIPLAYER_AUDIO_BUFFER_STEP_MS = 250;
export const MULTIPLAYER_RENDER_CACHE_LIMITS_MIB = [0, 64, 128, 256, 512] as const;
export const MULTIPLAYER_RENDER_DISK_CACHE_LIMITS_MIB = [256, 512, 1024, 2048, 4096] as const;
const MULTIPLAYER_RENDER_DISK_CACHE_DEFAULT_LIMIT_MIB = 1024;
export const MULTIPLAYER_FILE_TRANSFER_LIMITS_MIB = [0, 1, 2, 4, 8, 16, 32, 64, -1] as const;
export const MULTIPLAYER_SYNC_LEAD_TIME_MIN_MS = 250;
export const MULTIPLAYER_SYNC_LEAD_TIME_MAX_MS = 3_000;
export const MULTIPLAYER_SYNC_LEAD_TIME_STEP_MS = 50;
export const MULTIPLAYER_MAX_LISTENERS_MIN = 1;
export const MULTIPLAYER_MAX_LISTENERS_MAX = 8;
export const MULTIPLAYER_CHAT_HISTORY_LINES = [0, 25, 50, 100, 250, 500, 1000] as const;
const MULTIPLAYER_MOTD_MAX_LENGTH = 500;

function createDefaultIzciName(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return `Scout ${Array.from(bytes, (byte) => NAME_ALPHABET[byte % NAME_ALPHABET.length]).join('')}`;
}

function normalizeIzciName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const name = value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 48);
  return name || fallback;
}

function normalizeSingleLine(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength)
    : '';
}

const defaultIzciName = createDefaultIzciName();

export const DEFAULT_MULTIPLAYER_SETTINGS: MultiplayerSettings = {
  multiplayerSignaling: hasBuiltinSignaling ? 'builtin' : 'external',
  multiplayerBuiltinPort: 8787,
  multiplayerBuiltinPublicUrl: '',
  multiplayerBuiltinUpnp: false,
  multiplayerBuiltinIceUrls: 'stun:stun.l.google.com:19302',
  multiplayerBuiltinAllowedOrigins: '',
  multiplayer: false,
  izciName: defaultIzciName,
  multiplayerServerEndpoint: '',
  multiplayerServerNoticeVersion: 0,
  multiplayerServerForceRelay: false,
  multiplayerServerIceAck: '',
  multiplayerMotd: '',
  multiplayerChatHistoryLines: 0,
  multiplayerWaitForClients: false,
  multiplayerSynchronizedPlayback: false,
  multiplayerSyncLeadTimeMs: 1_000,
  multiplayerRestoreLastSession: true,
  multiplayerFreeplay: false,
  multiplayerStreamAudio: true,
  multiplayerFileTransferLimitMiB: 0,
  multiplayerOpusBitrateKbps: 128,
  multiplayerAudioBufferMs: 3_000,
  multiplayerRenderCacheLimitMiB: 256,
  multiplayerRenderDiskCacheEnabled: true,
  multiplayerRenderDiskCacheLimitMiB: MULTIPLAYER_RENDER_DISK_CACHE_DEFAULT_LIMIT_MIB,
  multiplayerMaxListeners: 4
};

function normalizeRenderCacheLimit(value: unknown): number {
  return typeof value === 'number'
    && MULTIPLAYER_RENDER_CACHE_LIMITS_MIB.includes(
      value as (typeof MULTIPLAYER_RENDER_CACHE_LIMITS_MIB)[number]
    )
    ? value
    : DEFAULT_MULTIPLAYER_SETTINGS.multiplayerRenderCacheLimitMiB;
}

function normalizeRenderDiskCacheLimit(value: unknown): number {
  return typeof value === 'number'
    && MULTIPLAYER_RENDER_DISK_CACHE_LIMITS_MIB.includes(
      value as (typeof MULTIPLAYER_RENDER_DISK_CACHE_LIMITS_MIB)[number]
    )
    ? value
    : DEFAULT_MULTIPLAYER_SETTINGS.multiplayerRenderDiskCacheLimitMiB;
}

function normalizeFileTransferLimit(value: unknown): number {
  return typeof value === 'number'
    && MULTIPLAYER_FILE_TRANSFER_LIMITS_MIB.includes(
      value as (typeof MULTIPLAYER_FILE_TRANSFER_LIMITS_MIB)[number]
    )
    ? value
    : DEFAULT_MULTIPLAYER_SETTINGS.multiplayerFileTransferLimitMiB;
}

function normalizeChatHistoryLines(value: unknown): number {
  return typeof value === 'number'
    && MULTIPLAYER_CHAT_HISTORY_LINES.includes(value as (typeof MULTIPLAYER_CHAT_HISTORY_LINES)[number])
    ? value
    : DEFAULT_MULTIPLAYER_SETTINGS.multiplayerChatHistoryLines;
}

function normalizeBoundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(Math.round(value), min), max)
    : fallback;
}

export function normalizeMultiplayerSettings(value: unknown): MultiplayerSettings {
  const source = value && typeof value === 'object'
    ? value as Partial<MultiplayerSettings>
    : {};

  return {
    multiplayerSignaling: source.multiplayerSignaling === 'builtin' || source.multiplayerSignaling === 'external'
      ? source.multiplayerSignaling : DEFAULT_MULTIPLAYER_SETTINGS.multiplayerSignaling,
    multiplayerBuiltinPort: normalizeBoundedInteger(source.multiplayerBuiltinPort, 8787, 1, 65535),
    multiplayerBuiltinPublicUrl: normalizeSingleLine(source.multiplayerBuiltinPublicUrl, 512),
    multiplayerBuiltinUpnp: normalizeBoolean(source.multiplayerBuiltinUpnp, false),
    multiplayerBuiltinIceUrls: normalizeSingleLine(source.multiplayerBuiltinIceUrls, 2048),
    multiplayerBuiltinAllowedOrigins: normalizeSingleLine(source.multiplayerBuiltinAllowedOrigins, 2048),
    multiplayer: normalizeBoolean(source.multiplayer, DEFAULT_MULTIPLAYER_SETTINGS.multiplayer),
    izciName: normalizeIzciName(source.izciName, defaultIzciName),
    multiplayerServerEndpoint: typeof source.multiplayerServerEndpoint === 'string'
      ? source.multiplayerServerEndpoint.trim().slice(0, 512)
      : '',
    multiplayerServerNoticeVersion: typeof source.multiplayerServerNoticeVersion === 'number'
      && Number.isFinite(source.multiplayerServerNoticeVersion)
      ? Math.max(0, Math.floor(source.multiplayerServerNoticeVersion))
      : DEFAULT_MULTIPLAYER_SETTINGS.multiplayerServerNoticeVersion,
    multiplayerServerForceRelay: normalizeBoolean(
      source.multiplayerServerForceRelay,
      DEFAULT_MULTIPLAYER_SETTINGS.multiplayerServerForceRelay
    ),
    multiplayerServerIceAck: typeof source.multiplayerServerIceAck === 'string'
      ? source.multiplayerServerIceAck.slice(0, 2048)
      : '',
    multiplayerMotd: normalizeSingleLine(source.multiplayerMotd, MULTIPLAYER_MOTD_MAX_LENGTH),
    multiplayerChatHistoryLines: normalizeChatHistoryLines(source.multiplayerChatHistoryLines),
    multiplayerWaitForClients: normalizeBoolean(
      source.multiplayerWaitForClients,
      DEFAULT_MULTIPLAYER_SETTINGS.multiplayerWaitForClients
    ),
    multiplayerSynchronizedPlayback: normalizeBoolean(
      source.multiplayerSynchronizedPlayback,
      DEFAULT_MULTIPLAYER_SETTINGS.multiplayerSynchronizedPlayback
    ),
    multiplayerSyncLeadTimeMs: normalizeBoundedInteger(
      source.multiplayerSyncLeadTimeMs,
      DEFAULT_MULTIPLAYER_SETTINGS.multiplayerSyncLeadTimeMs,
      MULTIPLAYER_SYNC_LEAD_TIME_MIN_MS,
      MULTIPLAYER_SYNC_LEAD_TIME_MAX_MS
    ),
    multiplayerRestoreLastSession: normalizeBoolean(
      source.multiplayerRestoreLastSession,
      DEFAULT_MULTIPLAYER_SETTINGS.multiplayerRestoreLastSession
    ),
    multiplayerFreeplay: normalizeBoolean(source.multiplayerFreeplay, DEFAULT_MULTIPLAYER_SETTINGS.multiplayerFreeplay),
    multiplayerStreamAudio: normalizeBoolean(
      source.multiplayerStreamAudio,
      DEFAULT_MULTIPLAYER_SETTINGS.multiplayerStreamAudio
    ),
    multiplayerFileTransferLimitMiB: normalizeFileTransferLimit(
      source.multiplayerFileTransferLimitMiB
    ),
    multiplayerOpusBitrateKbps: normalizeBoundedInteger(
      source.multiplayerOpusBitrateKbps,
      DEFAULT_MULTIPLAYER_SETTINGS.multiplayerOpusBitrateKbps,
      MULTIPLAYER_OPUS_BITRATE_MIN_KBPS,
      MULTIPLAYER_OPUS_BITRATE_MAX_KBPS
    ),
    multiplayerAudioBufferMs: normalizeBoundedInteger(
      source.multiplayerAudioBufferMs,
      DEFAULT_MULTIPLAYER_SETTINGS.multiplayerAudioBufferMs,
      MULTIPLAYER_AUDIO_BUFFER_MIN_MS,
      MULTIPLAYER_AUDIO_BUFFER_MAX_MS
    ),
    multiplayerRenderCacheLimitMiB: normalizeRenderCacheLimit(
      source.multiplayerRenderCacheLimitMiB
    ),
    multiplayerRenderDiskCacheEnabled: normalizeBoolean(
      source.multiplayerRenderDiskCacheEnabled,
      DEFAULT_MULTIPLAYER_SETTINGS.multiplayerRenderDiskCacheEnabled
    ),
    multiplayerRenderDiskCacheLimitMiB: normalizeRenderDiskCacheLimit(
      source.multiplayerRenderDiskCacheLimitMiB
    ),
    multiplayerMaxListeners: normalizeBoundedInteger(
      source.multiplayerMaxListeners,
      DEFAULT_MULTIPLAYER_SETTINGS.multiplayerMaxListeners,
      MULTIPLAYER_MAX_LISTENERS_MIN,
      MULTIPLAYER_MAX_LISTENERS_MAX
    )
  };
}

export type MultiplayerMode = 'singleplayer' | 'coop' | 'coopAudio' | 'freeplay';

export function deriveMultiplayerMode(
  settings: Pick<MultiplayerSettings, 'multiplayer' | 'multiplayerFreeplay' | 'multiplayerStreamAudio'>
): MultiplayerMode {
  if (!settings.multiplayer) return 'singleplayer';
  if (settings.multiplayerFreeplay) return 'freeplay';
  if (settings.multiplayerStreamAudio) return 'coopAudio';
  return 'coop';
}

export function multiplayerModePatch(
  mode: MultiplayerMode
): Pick<MultiplayerSettings, 'multiplayer' | 'multiplayerFreeplay' | 'multiplayerStreamAudio'> {
  switch (mode) {
    case 'singleplayer':
      return { multiplayer: false, multiplayerFreeplay: false, multiplayerStreamAudio: false };
    case 'coop':
      return { multiplayer: true, multiplayerFreeplay: false, multiplayerStreamAudio: false };
    case 'coopAudio':
      return { multiplayer: true, multiplayerFreeplay: false, multiplayerStreamAudio: true };
    case 'freeplay':
      return { multiplayer: true, multiplayerFreeplay: true, multiplayerStreamAudio: true };
  }
}

export const multiplayerSettings = createSettingsStore({
  storageKey: MULTIPLAYER_SETTINGS_STORAGE_KEY,
  channelName: MULTIPLAYER_SETTINGS_CHANNEL,
  defaultValue: DEFAULT_MULTIPLAYER_SETTINGS,
  normalize: normalizeMultiplayerSettings
});

if (typeof window !== 'undefined') {
  // Drop retired signaling state; persist only the current settings schema.
  try {
    window.localStorage.removeItem('izci.multiplayer-pairings');
    window.localStorage.removeItem('izci.multiplayer-recents');
    multiplayerSettings.set(multiplayerSettings.getSnapshot());
  } catch {
    // Settings remain usable when storage is unavailable.
  }
}
