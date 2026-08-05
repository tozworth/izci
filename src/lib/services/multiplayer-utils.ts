import type { PlaylistItem } from '$lib/types';
import { experimentalSettings } from '$lib/stores/experimental-settings';
import {
  MULTIPLAYER_PROTOCOL_VERSION,
  isMultiplayerCommand,
  type ClientMessage,
  type MultiplayerAudioAvailability,
  type MultiplayerPlaybackPreparation,
  type MultiplayerPlaybackPreparationAudio
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

/**
 * The combined Freeplay agreement for a pair: both sides currently opt in. This is
 * what gets persisted to the pairing record (and what `freeplayPaired` restores from)
 * so enabling Freeplay after pairing works without re-pairing.
 */
export function resolveMultiplayerFreeplayAgreement(pairing: {
  paired: boolean;
  hostEnabled: boolean;
  clientEnabled: boolean;
}): boolean {
  return pairing.paired && pairing.hostEnabled && pairing.clientEnabled;
}

export function isMultiplayerPlaybackPreparationReady(
  preparation: MultiplayerPlaybackPreparation,
  state: {
    remoteTrackId: string | null;
    receiveAudio: boolean;
    loadedSourceTrackId: string | null;
    streamReady: boolean;
  }
): boolean {
  if (state.remoteTrackId !== preparation.trackId) return false;
  if (!state.receiveAudio || preparation.audio === 'none') return true;
  if (preparation.audio === 'file') {
    return state.loadedSourceTrackId === preparation.trackId;
  }
  return state.streamReady;
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
  if (message.kind === 'playback.ready') {
    return typeof message.preparationId === 'string'
      && message.preparationId.length > 0
      && message.preparationId.length <= 80;
  }
  if (message.kind === 'playback.ended') {
    return typeof message.trackId === 'string'
      && message.trackId.length > 0
      && message.trackId.length <= 200;
  }
  return message.kind === 'command' && isMultiplayerCommand(message.command);
}

export function resolvePlaybackPreparationAudio(
  availability: MultiplayerAudioAvailability
): MultiplayerPlaybackPreparationAudio {
  if (availability.sourceFile) return 'file';
  return availability.enabled ? 'stream' : 'none';
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
