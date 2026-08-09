import type { PlaylistItem, PlaylistRepeatMode } from '$lib/types';
import { experimentalSettings } from '$lib/stores/experimental-settings';
import {
  MULTIPLAYER_PROTOCOL_VERSION,
  MULTIPLAYER_QUEUE_MAX_ITEMS,
  isMultiplayerCommand,
  type ClientMessage,
  type MultiplayerDeliveryMode,
  type MultiplayerPlaybackPreparation,
} from './multiplayer-protocol';

export const RECEIVE_AUDIO_STORAGE_KEY = 'izci.multiplayer.receive-audio';

export function isMultiplayerClientTransportHealthy(
  connectionState: RTCPeerConnectionState,
  channelState: RTCDataChannelState | undefined
): boolean {
  return connectionState === 'connected' && channelState === 'open';
}

export function shouldTransferMultiplayerSourceFile(
  track: PlaylistItem | null,
  limitMiB: number,
  audioEnabled = true
): boolean {
  if (!audioEnabled || !track?.file || track.kind === 'video' || limitMiB === 0) return false;
  return limitMiB < 0 || track.file.size < limitMiB * 1024 * 1024;
}

export function isMultiplayerFreeplayActive(pairing: {
  paired: boolean;
  freeplayPaired: boolean;
  hostEnabled: boolean;
  clientEnabled: boolean;
}): boolean {
  return pairing.paired
    && pairing.freeplayPaired
    && pairing.hostEnabled
    && pairing.clientEnabled;
}

export function resolveMultiplayerFreeplayAgreement(pairing: {
  paired: boolean;
  hostEnabled: boolean;
  clientEnabled: boolean;
}): boolean {
  return pairing.paired && pairing.hostEnabled && pairing.clientEnabled;
}

export function cycleMultiplayerRepeatMode(mode: PlaylistRepeatMode): PlaylistRepeatMode {
  return mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off';
}

export function sanitizeFreeplayQueueIds(itemIds: string[]): string[] {
  const seen = new Set<string>();
  const sanitized: string[] = [];
  for (const id of itemIds) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 200 || seen.has(id)) continue;
    seen.add(id);
    sanitized.push(id);
    if (sanitized.length >= MULTIPLAYER_QUEUE_MAX_ITEMS) break;
  }
  return sanitized;
}

export function parseFreeplayRestoredFlags(message: {
  shuffleEnabled?: unknown;
  repeatMode?: unknown;
}): { shuffleEnabled: boolean; repeatMode: PlaylistRepeatMode } | null {
  if (typeof message.shuffleEnabled !== 'boolean') return null;
  if (message.repeatMode !== 'off' && message.repeatMode !== 'one' && message.repeatMode !== 'all') return null;
  return { shuffleEnabled: message.shuffleEnabled, repeatMode: message.repeatMode };
}

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<ClientMessage> & Record<string, unknown>;
  if (message.kind === 'hello') {
    return message.version === MULTIPLAYER_PROTOCOL_VERSION
      && typeof message.name === 'string'
      && typeof message.platform === 'string'
      && typeof message.freeplayEnabled === 'boolean';
  }
  if (message.kind === 'freeplay.preference') {
    return typeof message.enabled === 'boolean';
  }
  if (message.kind === 'freeplay.queue') {
    return Array.isArray(message.itemIds)
      && message.itemIds.length <= MULTIPLAYER_QUEUE_MAX_ITEMS
      && message.itemIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 200)
      && (message.shuffleEnabled === undefined || typeof message.shuffleEnabled === 'boolean')
      && (message.repeatMode === undefined
        || message.repeatMode === 'off'
        || message.repeatMode === 'one'
        || message.repeatMode === 'all');
  }
  if (message.kind === 'playback.ready') {
    return typeof message.generationId === 'string'
      && message.generationId.length > 0
      && message.generationId.length <= 80;
  }
  if (message.kind === 'clock.pong') {
    return typeof message.generationId === 'string'
      && message.generationId.length > 0
      && message.generationId.length <= 80
      && typeof message.hostSentAt === 'number'
      && Number.isFinite(message.hostSentAt)
      && typeof message.clientReceivedAt === 'number'
      && Number.isFinite(message.clientReceivedAt)
      && typeof message.clientSentAt === 'number'
      && Number.isFinite(message.clientSentAt);
  }
  if (message.kind === 'playback.ended') {
    return typeof message.generationId === 'string'
      && message.generationId.length > 0
      && message.generationId.length <= 80
      && typeof message.trackId === 'string'
      && message.trackId.length > 0
      && message.trackId.length <= 200;
  }
  if (message.kind === 'source.retry') {
    return typeof message.generationId === 'string'
      && message.generationId.length > 0
      && message.generationId.length <= 80;
  }
  return message.kind === 'command' && isMultiplayerCommand(message.command);
}

export function resolvePlaybackPreparationDelivery(mode: MultiplayerDeliveryMode): MultiplayerDeliveryMode {
  return mode;
}

export function getLocalName(): string {
  return sanitizeClientName(experimentalSettings.getSnapshot().izciName);
}

export function getClientPlatform(): string {
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
    || navigator.platform;
  return sanitizePlatform(platform || 'Unknown');
}

export function sanitizeClientName(value: string): string {
  const name = value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 48);
  return name || 'Guest client';
}

export function sanitizePlatform(value: string): string {
  const platform = value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 32);
  return platform || 'Unknown';
}

export function readReceiveAudioPreference(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(RECEIVE_AUDIO_STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

export function writeReceiveAudioPreference(enabled: boolean): void {
  try {
    window.localStorage.setItem(RECEIVE_AUDIO_STORAGE_KEY, String(enabled));
  } catch {
    // The in-memory choice still applies when storage is unavailable.
  }
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && /permission[_ -]?denied/i.test(error.message)) {
    return 'Multiplayer signaling was rejected by the server. The app and server may be out of sync.';
  }
  return error instanceof Error && error.message ? error.message : fallback;
}
