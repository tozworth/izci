import type { PlaylistItem, PlaylistRepeatMode } from '$lib/types';
import { experimentalSettings } from '$lib/stores/experimental-settings';
import {
  MULTIPLAYER_PROTOCOL_VERSION,
  MULTIPLAYER_QUEUE_MAX_ITEMS,
  MULTIPLAYER_RENDER_MAX_RANGES,
  isMultiplayerCommand,
  type ClientMessage,
  type MultiplayerDeliveryMode,
} from './multiplayer-protocol';

export const RECEIVE_AUDIO_STORAGE_KEY = 'izci.multiplayer.receive-audio';

export function isMultiplayerClientTransportHealthy(
  connectionState: RTCPeerConnectionState,
  channelState: RTCDataChannelState | undefined
): boolean {
  return connectionState === 'connected' && channelState === 'open';
}

/**
 * Delivery decision between the two streaming pathways: files at or under the
 * "Send files under" limit transfer whole and play on the listener; larger
 * files are pre-rendered to buffered Opus. Live RTP remains only for video.
 * limitMiB: 0 = off (everything renders), < 0 = every file transfers.
 */
export function resolveMultiplayerDeliveryMode(
  track: PlaylistItem | null,
  audioEnabled: boolean,
  fileTransferLimitMiB = 0
): MultiplayerDeliveryMode {
  if (!track || !audioEnabled) return 'none';
  if (track.kind === 'video') return 'stream';
  if (fileTransferLimitMiB !== 0
    && track.size > 0
    && (fileTransferLimitMiB < 0 || track.size < fileTransferLimitMiB * 1024 * 1024)) {
    return 'source-file';
  }
  return 'render';
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
  if (message.kind === 'render.need') {
    return isRenderNeed(message.need);
  }
  if (message.kind === 'render.ready') {
    return typeof message.generationId === 'string'
      && message.generationId.length > 0
      && message.generationId.length <= 80
      && typeof message.renderId === 'string'
      && message.renderId.length > 0
      && message.renderId.length <= 80
      && Number.isInteger(message.epoch)
      && (message.epoch ?? 0) >= 0
      && typeof message.positionMs === 'number'
      && Number.isFinite(message.positionMs)
      && message.positionMs >= 0;
  }
  return message.kind === 'command' && isMultiplayerCommand(message.command);
}

function isRenderNeed(value: unknown): value is import('./multiplayer-protocol').MultiplayerRenderNeed {
  if (!value || typeof value !== 'object') return false;
  const need = value as Partial<import('./multiplayer-protocol').MultiplayerRenderNeed>;
  if (typeof need.generationId !== 'string'
    || need.generationId.length < 1
    || need.generationId.length > 80
    || typeof need.renderId !== 'string'
    || need.renderId.length < 1
    || need.renderId.length > 80
    || !Number.isInteger(need.epoch)
    || (need.epoch ?? 0) < 0
    || typeof need.targetTimeMs !== 'number'
    || !Number.isFinite(need.targetTimeMs)
    || need.targetTimeMs < 0
    || typeof need.aheadMs !== 'number'
    || !Number.isFinite(need.aheadMs)
    || need.aheadMs < 0
    || !Array.isArray(need.ranges)
    || need.ranges.length > MULTIPLAYER_RENDER_MAX_RANGES) return false;
  for (const range of need.ranges) {
    if (!Array.isArray(range)
      || range.length !== 2
      || !Number.isInteger(range[0])
      || !Number.isInteger(range[1])
      || range[0] < 0
      || range[1] < range[0]) return false;
  }
  return true;
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
