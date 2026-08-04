import type {
  PlaybackSnapshot,
  PlaylistItem,
  PlaylistRepeatMode,
  TrackKind,
  TrackMetadata,
} from '$lib/types';

export type MultiplayerCollection = 'playlist' | 'library' | 'favorites';

export const MULTIPLAYER_PROTOCOL_VERSION = 7;
export const MULTIPLAYER_FRAME_CHUNK_SIZE = 12_000;

const MULTIPLAYER_ARTWORK_DATA_URL_MAX_LENGTH = 8 * 1024 * 1024;

export type MultiplayerCommand =
  | { type: 'transport.toggle'; commandId: string }
  | { type: 'transport.play'; commandId: string }
  | { type: 'transport.pause'; commandId: string }
  | { type: 'transport.stop'; commandId: string }
  | { type: 'transport.previous'; commandId: string }
  | { type: 'transport.next'; commandId: string }
  | { type: 'transport.seek'; commandId: string; seconds: number }
  | { type: 'playlist.shuffle'; commandId: string }
  | { type: 'playlist.repeat'; commandId: string }
  | {
      type: 'collection.activate';
      commandId: string;
      collection: MultiplayerCollection;
      itemId: string;
    };

export type MultiplayerCommandInput = MultiplayerCommand extends infer Command
  ? Command extends { commandId: string }
    ? Omit<Command, 'commandId'>
    : never
  : never;

export interface MultiplayerCatalog {
  revision: number;
  playlist: PlaylistItem[];
  library: PlaylistItem[];
  favorites: PlaylistItem[];
  shuffleEnabled: boolean;
  repeatMode: PlaylistRepeatMode;
}

export interface MultiplayerPlayback {
  snapshot: PlaybackSnapshot;
  track: PlaylistItem | null;
  sentAt: number;
}

export interface MultiplayerArtwork {
  trackId: string;
  assetId: string;
  dataUrl: string;
  mimeType: string;
  width: number;
  height: number;
}

export interface MultiplayerAudioAvailability {
  enabled: boolean;
  postRaf: boolean;
  reason: 'host-disabled' | 'video-disabled' | null;
}

export type HostMessage =
  | { kind: 'hello'; version: number; name: string }
  | { kind: 'pairing'; paired: boolean; hostId: string; name: string }
  | { kind: 'catalog'; catalog: MultiplayerCatalog }
  | { kind: 'playback'; playback: MultiplayerPlayback }
  | { kind: 'audio'; audio: MultiplayerAudioAvailability }
  | { kind: 'artwork'; artwork: MultiplayerArtwork | null }
  | { kind: 'ack'; commandId: string; accepted: boolean; message?: string }
  | { kind: 'kicked' };

export type ClientMessage =
  | { kind: 'hello'; version: number; name: string; platform: string }
  | { kind: 'command'; command: MultiplayerCommand };

interface ChunkFrame {
  kind: 'chunk';
  transferId: string;
  index: number;
  total: number;
  payload: string;
}

export function sanitizePlaylistItem(item: PlaylistItem): PlaylistItem {
  return {
    id: item.id,
    name: item.name,
    extension: item.extension,
    kind: item.kind,
    size: Number.isFinite(item.size) ? item.size : 0,
    lastModified: Number.isFinite(item.lastModified) ? item.lastModified : 0,
    ...(item.path ? { path: item.path } : {}),
    ...(item.metadata ? { metadata: sanitizeTrackMetadata(item.metadata) } : {}),
    ...(typeof item.rating === 'number' ? { rating: item.rating } : {}),
    ...(typeof item.subsong === 'number' ? { subsong: item.subsong } : {})
  };
}

export function sanitizeTrackMetadata(metadata: TrackMetadata): TrackMetadata {
  const copy = JSON.parse(JSON.stringify(metadata)) as TrackMetadata;
  return copy;
}

export function isMultiplayerCommand(value: unknown): value is MultiplayerCommand {
  if (!value || typeof value !== 'object') return false;
  const command = value as Partial<MultiplayerCommand>;
  if (typeof command.type !== 'string' || typeof command.commandId !== 'string') return false;
  if (command.commandId.length < 1 || command.commandId.length > 80) return false;

  switch (command.type) {
    case 'transport.toggle':
    case 'transport.play':
    case 'transport.pause':
    case 'transport.stop':
    case 'transport.previous':
    case 'transport.next':
    case 'playlist.shuffle':
    case 'playlist.repeat':
      return true;
    case 'transport.seek':
      return typeof command.seconds === 'number'
        && Number.isFinite(command.seconds)
        && command.seconds >= 0
        && command.seconds <= 60 * 60 * 24 * 7;
    case 'collection.activate':
      return (command.collection === 'playlist'
        || command.collection === 'library'
        || command.collection === 'favorites')
        && typeof command.itemId === 'string'
        && command.itemId.length > 0
        && command.itemId.length <= 200;
    default:
      return false;
  }
}

export function isRemotePlaylistItem(value: unknown): value is PlaylistItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PlaylistItem>;
  return typeof item.id === 'string'
    && typeof item.name === 'string'
    && typeof item.extension === 'string'
    && isTrackKind(item.kind)
    && typeof item.size === 'number'
    && typeof item.lastModified === 'number';
}

export function isHostMessage(value: unknown): value is HostMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<HostMessage> & Record<string, unknown>;
  if (message.kind === 'hello') {
    return message.version === MULTIPLAYER_PROTOCOL_VERSION && typeof message.name === 'string';
  }
  if (message.kind === 'kicked') return true;
  if (message.kind === 'pairing') {
    return typeof message.paired === 'boolean'
      && typeof message.hostId === 'string'
      && /^[A-Za-z0-9_-]{1,128}$/.test(message.hostId)
      && typeof message.name === 'string'
      && message.name.length > 0
      && message.name.length <= 48;
  }
  if (message.kind === 'ack') {
    return typeof message.commandId === 'string' && typeof message.accepted === 'boolean';
  }
  if (message.kind === 'catalog') {
    const catalog = message.catalog as Partial<MultiplayerCatalog> | undefined;
    return Boolean(catalog)
      && typeof catalog?.revision === 'number'
      && Array.isArray(catalog.playlist)
      && catalog.playlist.every(isRemotePlaylistItem)
      && Array.isArray(catalog.library)
      && catalog.library.every(isRemotePlaylistItem)
      && Array.isArray(catalog.favorites)
      && catalog.favorites.every(isRemotePlaylistItem)
      && typeof catalog.shuffleEnabled === 'boolean'
      && (catalog.repeatMode === 'off' || catalog.repeatMode === 'one' || catalog.repeatMode === 'all');
  }
  if (message.kind === 'playback') {
    const playback = message.playback as Partial<MultiplayerPlayback> | undefined;
    return Boolean(playback)
      && typeof playback?.sentAt === 'number'
      && isPlaybackSnapshot(playback.snapshot)
      && (playback.track === null || isRemotePlaylistItem(playback.track));
  }
  if (message.kind === 'audio') {
    const audio = message.audio as Partial<MultiplayerAudioAvailability> | undefined;
    return Boolean(audio)
      && typeof audio?.enabled === 'boolean'
      && typeof audio.postRaf === 'boolean'
      && (audio.reason === null
        || audio.reason === 'host-disabled'
        || audio.reason === 'video-disabled');
  }
  if (message.kind === 'artwork') {
    return message.artwork === null || isMultiplayerArtwork(message.artwork);
  }
  return false;
}

function isMultiplayerArtwork(value: unknown): value is MultiplayerArtwork {
  if (!value || typeof value !== 'object') return false;
  const artwork = value as Partial<MultiplayerArtwork>;
  return typeof artwork.trackId === 'string'
    && artwork.trackId.length > 0
    && artwork.trackId.length <= 200
    && typeof artwork.assetId === 'string'
    && /^[a-f0-9]{64}$/.test(artwork.assetId)
    && typeof artwork.dataUrl === 'string'
    && artwork.dataUrl.length <= MULTIPLAYER_ARTWORK_DATA_URL_MAX_LENGTH
    && /^data:image\/[a-z0-9.+-]+;base64,/i.test(artwork.dataUrl)
    && typeof artwork.mimeType === 'string'
    && /^image\/[a-z0-9.+-]+$/i.test(artwork.mimeType)
    && Number.isInteger(artwork.width)
    && (artwork.width ?? 0) > 0
    && (artwork.width ?? 0) <= 4096
    && Number.isInteger(artwork.height)
    && (artwork.height ?? 0) > 0
    && (artwork.height ?? 0) <= 4096;
}

export function encodeMultiplayerMessage(message: HostMessage | ClientMessage): string[] {
  const payload = JSON.stringify(message);
  if (payload.length <= MULTIPLAYER_FRAME_CHUNK_SIZE) return [payload];

  const transferId = createTransferId();
  const total = Math.ceil(payload.length / MULTIPLAYER_FRAME_CHUNK_SIZE);
  const frames: string[] = [];
  for (let index = 0; index < total; index += 1) {
    const frame: ChunkFrame = {
      kind: 'chunk',
      transferId,
      index,
      total,
      payload: payload.slice(
        index * MULTIPLAYER_FRAME_CHUNK_SIZE,
        (index + 1) * MULTIPLAYER_FRAME_CHUNK_SIZE
      )
    };
    frames.push(JSON.stringify(frame));
  }
  return frames;
}

export function createMultiplayerMessageDecoder<T>(
  accept: (value: unknown) => value is T
): (frame: string) => T | null {
  const pending = new Map<string, { total: number; chunks: string[]; received: number }>();

  return (frame: string): T | null => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame);
    } catch {
      return null;
    }

    if (!isChunkFrame(parsed)) return accept(parsed) ? parsed : null;
    let transfer = pending.get(parsed.transferId);
    if (!transfer || transfer.total !== parsed.total) {
      transfer = { total: parsed.total, chunks: new Array(parsed.total), received: 0 };
      pending.set(parsed.transferId, transfer);
    }
    if (transfer.chunks[parsed.index] === undefined) {
      transfer.chunks[parsed.index] = parsed.payload;
      transfer.received += 1;
    }
    if (transfer.received !== transfer.total) return null;

    pending.delete(parsed.transferId);
    try {
      const complete = JSON.parse(transfer.chunks.join('')) as unknown;
      return accept(complete) ? complete : null;
    } catch {
      return null;
    }
  };
}

function isChunkFrame(value: unknown): value is ChunkFrame {
  if (!value || typeof value !== 'object') return false;
  const frame = value as Partial<ChunkFrame>;
  return frame.kind === 'chunk'
    && typeof frame.transferId === 'string'
    && Number.isInteger(frame.index)
    && Number.isInteger(frame.total)
    && (frame.index ?? -1) >= 0
    && (frame.total ?? 0) > 0
    && (frame.total ?? 0) <= 10_000
    && (frame.index ?? 0) < (frame.total ?? 0)
    && typeof frame.payload === 'string';
}

function isPlaybackSnapshot(value: unknown): value is PlaybackSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<PlaybackSnapshot>;
  return (snapshot.state === 'idle'
    || snapshot.state === 'loading'
    || snapshot.state === 'playing'
    || snapshot.state === 'paused'
    || snapshot.state === 'ended'
    || snapshot.state === 'error')
    && typeof snapshot.currentTime === 'number'
    && typeof snapshot.duration === 'number'
    && typeof snapshot.volume === 'number'
    && typeof snapshot.muted === 'boolean'
    && (snapshot.backend === null || isTrackKind(snapshot.backend));
}

function isTrackKind(value: unknown): value is TrackKind {
  return value === 'stream' || value === 'module' || value === 'video';
}

function createTransferId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
