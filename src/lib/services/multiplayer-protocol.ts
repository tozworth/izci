import type {
  PlaybackSnapshot,
  TrackItem,
  RepeatMode,
  TrackKind,
  TrackMetadata,
} from '$lib/types';

export type MultiplayerCollection = 'queue' | 'library' | 'favorites';

// Version 18 adds explicit source revisions to buffered-Opus manifests so a
// listener never reuses cached bytes from a replaced track.
export const MULTIPLAYER_PROTOCOL_VERSION = 19;
const MULTIPLAYER_FRAME_CHUNK_SIZE = 12_000;
export const MULTIPLAYER_QUEUE_MAX_ITEMS = 50_000;
const MULTIPLAYER_RENDER_MAX_CLUSTERS = 200_000;
const MULTIPLAYER_RENDER_MAX_TOTAL_BYTES = 8 * 1024 * 1024 * 1024;
export const MULTIPLAYER_RENDER_MAX_RANGES = 100_000;

const MULTIPLAYER_ARTWORK_DATA_URL_MAX_LENGTH = 8 * 1024 * 1024;

export type MultiplayerCommand =
  | { type: 'transport.toggle'; commandId: string }
  | { type: 'transport.play'; commandId: string }
  | { type: 'transport.pause'; commandId: string }
  | { type: 'transport.stop'; commandId: string }
  | { type: 'transport.previous'; commandId: string }
  | { type: 'transport.next'; commandId: string }
  | { type: 'transport.seek'; commandId: string; seconds: number }
  | { type: 'queue.shuffle'; commandId: string }
  | { type: 'queue.repeat'; commandId: string }
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
  queue: TrackItem[];
  library: TrackItem[];
  favorites: TrackItem[];
  shuffleEnabled: boolean;
  repeatMode: RepeatMode;
}

export interface MultiplayerPlayback {
  generationId: string;
  snapshot: PlaybackSnapshot;
  track: TrackItem | null;
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

export type MultiplayerDeliveryMode = 'none' | 'stream' | 'source-file' | 'render';

export interface MultiplayerDeliveryState {
  generationId: string;
  trackId: string | null;
  mode: MultiplayerDeliveryMode;
  reason: 'host-disabled' | 'no-track' | null;
}

interface MultiplayerRenderClusterInfo {
  index: number;
  timeMs: number;
  sizeBytes: number;
}

export interface MultiplayerRenderManifest {
  generationId: string;
  renderId: string;
  trackId: string;
  /** Stable for one source revision without exposing its local path. */
  sourceRevision: string;
  codec: 'opus';
  container: 'webm';
  durationMs: number;
  bitrateKbps: number;
  clusterDurationMs: number;
  clusters: MultiplayerRenderClusterInfo[];
  initSizeBytes: number;
  totalBytes: number;
}

export interface MultiplayerRenderNeed {
  generationId: string;
  renderId: string;
  /** Incremented on seek; mismatched in-flight fragments are dropped. */
  epoch: number;
  targetTimeMs: number;
  aheadMs: number;
  /** Inclusive cluster-index ranges the client already holds. */
  ranges: Array<[number, number]>;
}

export interface MultiplayerPlaybackPreparation {
  generationId: string;
  trackId: string;
  delivery: MultiplayerDeliveryMode;
}

export interface MultiplayerSynchronizedStart {
  generationId: string;
  trackId: string;
  positionSeconds: number;
  startAt: number;
}

export type HostMessage =
  | { kind: 'hello'; version: number; name: string; appVersion: string }
  | {
      kind: 'pairing';
      paired: boolean;
      freeplayPaired: boolean;
      freeplayActive: boolean;
      hostId: string;
      name: string;
    }
  | { kind: 'catalog'; catalog: MultiplayerCatalog }
  | { kind: 'state'; shuffleEnabled: boolean; repeatMode: RepeatMode }
  | { kind: 'playback'; playback: MultiplayerPlayback }
  | { kind: 'playback.prepare'; preparation: MultiplayerPlaybackPreparation }
  | { kind: 'clock.ping'; generationId: string; hostSentAt: number }
  | { kind: 'playback.start'; start: MultiplayerSynchronizedStart }
  | { kind: 'playback.cancel'; generationId: string }
  | { kind: 'delivery'; delivery: MultiplayerDeliveryState }
  | { kind: 'buffer'; bufferMs: number }
  | { kind: 'render.manifest'; manifest: MultiplayerRenderManifest }
  | { kind: 'artwork'; artwork: MultiplayerArtwork | null }
  | { kind: 'ack'; commandId: string; accepted: boolean; message?: string }
  | { kind: 'kicked' };

export type ClientMessage =
  | { kind: 'hello'; version: number; name: string; platform: string; freeplayEnabled: boolean }
  | { kind: 'freeplay.preference'; enabled: boolean }
  | {
      kind: 'freeplay.queue';
      itemIds: string[];
      shuffleEnabled?: boolean;
      repeatMode?: RepeatMode;
    }
  | { kind: 'command'; command: MultiplayerCommand }
  | { kind: 'playback.ready'; generationId: string }
  | {
      kind: 'clock.pong';
      generationId: string;
      hostSentAt: number;
      clientReceivedAt: number;
      clientSentAt: number;
    }
  | { kind: 'playback.ended'; generationId: string; trackId: string }
  | { kind: 'source.retry'; generationId: string }
  | { kind: 'render.need'; need: MultiplayerRenderNeed }
  | { kind: 'render.ready'; generationId: string; renderId: string; epoch: number; positionMs: number };

interface ChunkFrame {
  kind: 'chunk';
  transferId: string;
  index: number;
  total: number;
  payload: string;
}

export function sanitizeTrackItem(item: TrackItem): TrackItem {
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

function sanitizeTrackMetadata(metadata: TrackMetadata): TrackMetadata {
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
    case 'queue.shuffle':
    case 'queue.repeat':
      return true;
    case 'transport.seek':
      return typeof command.seconds === 'number'
        && Number.isFinite(command.seconds)
        && command.seconds >= 0
        && command.seconds <= 60 * 60 * 24 * 7;
    case 'collection.activate':
      return (command.collection === 'queue'
        || command.collection === 'library'
        || command.collection === 'favorites')
        && typeof command.itemId === 'string'
        && command.itemId.length > 0
        && command.itemId.length <= 200;
    default:
      return false;
  }
}

function isRemoteTrackItem(value: unknown): value is TrackItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<TrackItem>;
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
    return message.version === MULTIPLAYER_PROTOCOL_VERSION
      && typeof message.name === 'string'
      && typeof message.appVersion === 'string';
  }
  if (message.kind === 'kicked') return true;
  if (message.kind === 'pairing') {
    return typeof message.paired === 'boolean'
      && typeof message.freeplayPaired === 'boolean'
      && typeof message.freeplayActive === 'boolean'
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
      && Array.isArray(catalog.queue)
      && catalog.queue.every(isRemoteTrackItem)
      && Array.isArray(catalog.library)
      && catalog.library.every(isRemoteTrackItem)
      && Array.isArray(catalog.favorites)
      && catalog.favorites.every(isRemoteTrackItem)
      && typeof catalog.shuffleEnabled === 'boolean'
      && (catalog.repeatMode === 'off' || catalog.repeatMode === 'one' || catalog.repeatMode === 'all');
  }
  if (message.kind === 'state') {
    return typeof message.shuffleEnabled === 'boolean'
      && (message.repeatMode === 'off' || message.repeatMode === 'one' || message.repeatMode === 'all');
  }
  if (message.kind === 'playback') {
    const playback = message.playback as Partial<MultiplayerPlayback> | undefined;
    return Boolean(playback)
      && typeof playback?.generationId === 'string'
      && playback.generationId.length > 0
      && playback.generationId.length <= 80
      && typeof playback?.sentAt === 'number'
      && isPlaybackSnapshot(playback.snapshot)
      && (playback.track === null || isRemoteTrackItem(playback.track));
  }
  if (message.kind === 'playback.prepare') {
    const preparation = message.preparation as Partial<MultiplayerPlaybackPreparation> | undefined;
    return Boolean(preparation)
      && typeof preparation?.generationId === 'string'
      && preparation.generationId.length > 0
      && preparation.generationId.length <= 80
      && typeof preparation.trackId === 'string'
      && preparation.trackId.length > 0
      && preparation.trackId.length <= 200
      && (preparation.delivery === 'source-file'
        || preparation.delivery === 'stream'
        || preparation.delivery === 'render'
        || preparation.delivery === 'none');
  }
  if (message.kind === 'clock.ping') {
    return typeof message.generationId === 'string'
      && message.generationId.length > 0
      && message.generationId.length <= 80
      && typeof message.hostSentAt === 'number'
      && Number.isFinite(message.hostSentAt);
  }
  if (message.kind === 'playback.start') {
    const start = message.start as Partial<MultiplayerSynchronizedStart> | undefined;
    return Boolean(start)
      && typeof start?.generationId === 'string'
      && start.generationId.length > 0
      && start.generationId.length <= 80
      && typeof start.trackId === 'string'
      && start.trackId.length > 0
      && start.trackId.length <= 200
      && typeof start.positionSeconds === 'number'
      && Number.isFinite(start.positionSeconds)
      && start.positionSeconds >= 0
      && typeof start.startAt === 'number'
      && Number.isFinite(start.startAt);
  }
  if (message.kind === 'playback.cancel') {
    return typeof message.generationId === 'string'
      && message.generationId.length > 0
      && message.generationId.length <= 80;
  }
  if (message.kind === 'delivery') {
    const delivery = message.delivery as Partial<MultiplayerDeliveryState> | undefined;
    return Boolean(delivery)
      && typeof delivery?.generationId === 'string'
      && delivery.generationId.length > 0
      && delivery.generationId.length <= 80
      && (delivery.trackId === null
        || (typeof delivery.trackId === 'string'
          && delivery.trackId.length > 0
          && delivery.trackId.length <= 200))
      && (delivery.mode === 'none'
        || delivery.mode === 'stream'
        || delivery.mode === 'source-file'
        || delivery.mode === 'render')
      && (delivery.reason === null
        || delivery.reason === 'host-disabled'
        || delivery.reason === 'no-track')
      && (delivery.mode === 'none'
        ? delivery.reason === 'host-disabled' || delivery.reason === 'no-track'
        : delivery.reason === null);
  }
  if (message.kind === 'buffer') {
    return typeof message.bufferMs === 'number'
      && Number.isFinite(message.bufferMs)
      && message.bufferMs >= 0
      && message.bufferMs <= 30_000;
  }
  if (message.kind === 'render.manifest') {
    return isRenderManifest(message.manifest);
  }
  if (message.kind === 'artwork') {
    return message.artwork === null || isMultiplayerArtwork(message.artwork);
  }
  return false;
}

function isRenderManifest(value: unknown): value is MultiplayerRenderManifest {
  if (!value || typeof value !== 'object') return false;
  const manifest = value as Partial<MultiplayerRenderManifest>;
  if (typeof manifest.generationId !== 'string'
    || manifest.generationId.length < 1
    || manifest.generationId.length > 80
    || typeof manifest.renderId !== 'string'
    || manifest.renderId.length < 1
    || manifest.renderId.length > 80
    || typeof manifest.trackId !== 'string'
    || manifest.trackId.length < 1
    || manifest.trackId.length > 200
    || typeof manifest.sourceRevision !== 'string'
    || manifest.sourceRevision.length < 1
    || manifest.sourceRevision.length > 120
    || manifest.codec !== 'opus'
    || manifest.container !== 'webm'
    || typeof manifest.durationMs !== 'number'
    || !Number.isFinite(manifest.durationMs)
    || manifest.durationMs < 0
    || typeof manifest.bitrateKbps !== 'number'
    || !Number.isFinite(manifest.bitrateKbps)
    || manifest.bitrateKbps <= 0
    || typeof manifest.clusterDurationMs !== 'number'
    || !Number.isFinite(manifest.clusterDurationMs)
    || manifest.clusterDurationMs <= 0
    || !Array.isArray(manifest.clusters)
    || manifest.clusters.length > MULTIPLAYER_RENDER_MAX_CLUSTERS
    || typeof manifest.initSizeBytes !== 'number'
    || !Number.isSafeInteger(manifest.initSizeBytes)
    || manifest.initSizeBytes < 0
    || typeof manifest.totalBytes !== 'number'
    || !Number.isSafeInteger(manifest.totalBytes)
    || manifest.totalBytes < 0
    || manifest.totalBytes > MULTIPLAYER_RENDER_MAX_TOTAL_BYTES) return false;

  let previousTimeMs = -1;
  let expectedTotalBytes = manifest.initSizeBytes;
  for (let index = 0; index < manifest.clusters.length; index += 1) {
    const cluster = manifest.clusters[index];
    if (!cluster || typeof cluster !== 'object') return false;
    if (cluster.index !== index) return false;
    if (typeof cluster.timeMs !== 'number'
      || !Number.isFinite(cluster.timeMs)
      || cluster.timeMs < previousTimeMs) return false;
    if (typeof cluster.sizeBytes !== 'number'
      || !Number.isSafeInteger(cluster.sizeBytes)
      || cluster.sizeBytes <= 0
      || cluster.sizeBytes > 16 * 1024 * 1024) return false;
    expectedTotalBytes += cluster.sizeBytes;
    if (!Number.isSafeInteger(expectedTotalBytes)
      || expectedTotalBytes > MULTIPLAYER_RENDER_MAX_TOTAL_BYTES) return false;
    previousTimeMs = cluster.timeMs;
  }
  return manifest.initSizeBytes > 0 && manifest.totalBytes === expectedTotalBytes;
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
