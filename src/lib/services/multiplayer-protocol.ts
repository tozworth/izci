import type {
  PlaybackSnapshot,
  TrackItem,
  RepeatMode,
  TrackKind,
  TrackMetadata,
} from '$lib/types';

export type MultiplayerCollection = 'queue' | 'library' | 'favorites';

export interface MultiplayerChatTrackLink {
  collection: MultiplayerCollection;
  itemId: string;
  title: string;
}

export type MultiplayerChatAction = 'me' | 'join' | 'leave' | 'now-playing';

export interface MultiplayerChatMessage {
  id: string;
  name: string;
  text: string;
  sentAt: number;
  track?: MultiplayerChatTrackLink;
  action?: MultiplayerChatAction;
}

// Protocol identity: major breaks compatibility, minor is additive.
// A different major is incompatible. A minor mismatch alone is not an
// admission failure. Capabilities advertise independently meaningful
// facilities; absence means unavailable, unknown entries are ignored.
export const MULTIPLAYER_PROTOCOL_MAJOR = 1;
export const MULTIPLAYER_PROTOCOL_MINOR = 0;

export const MULTIPLAYER_PROTOCOL_CAPABILITIES = [
  'source-file',
  'buffered-opus',
  'synchronized-start',
  'pairing-proof',
  'freeplay',
  'chat'
] as const;

export type MultiplayerCapability = (typeof MULTIPLAYER_PROTOCOL_CAPABILITIES)[number];

/** Baseline capabilities required for admission. Empty: any major match admits. */
export const MULTIPLAYER_REQUIRED_BASELINE_CAPABILITIES: readonly string[] = [];

export interface MultiplayerImplementation {
  /** e.g. 'izci' for the browser app, 'izci-server' for the dedicated host. */
  product: string;
  productVersion: string;
  build?: string;
}

export interface MultiplayerProtocolIdentity {
  protocolMajor: number;
  protocolMinor: number;
  capabilities: string[];
  impl: MultiplayerImplementation;
}
const MULTIPLAYER_FRAME_CHUNK_SIZE = 12_000;
export const MULTIPLAYER_QUEUE_MAX_ITEMS = 50_000;
export const MULTIPLAYER_CHAT_MAX_MESSAGES = 200;
export const MULTIPLAYER_CHAT_MAX_MESSAGE_LENGTH = 500;
export const MULTIPLAYER_CHAT_MAX_MOTD_LENGTH = 500;
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
      type: 'queue.play-next';
      commandId: string;
      collection: MultiplayerCollection;
      itemIds: string[];
    }
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

export interface MultiplayerOdaBackground {
  dataUrl: string;
  opacity: number;
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
  | {
      kind: 'hello';
      protocolMajor: number;
      protocolMinor: number;
      capabilities: string[];
      impl: MultiplayerImplementation;
      name: string;
      /** Browser-local sidekick identity; absent on the legacy path. */
      identity?: string;
      /** Fresh per-connection nonce for sidekick pair proofs. */
      pairNonce?: string;
    }
  | { kind: 'pair.secret'; hostIdentity: string; secret: string }
  | { kind: 'invitation'; roomId: string; secret: string }
  | {
      kind: 'pairing';
      paired: boolean;
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
  | { kind: 'oda.background'; background: MultiplayerOdaBackground | null }
  | { kind: 'oda.background.opacity'; opacity: number }
  | { kind: 'chat.motd'; motd: string; hostName: string }
  | { kind: 'chat.message'; message: MultiplayerChatMessage }
  | { kind: 'chat.history'; messages: MultiplayerChatMessage[] }
  | { kind: 'chat.clear' }
  | { kind: 'ack'; commandId: string; accepted: boolean; message?: string }
  | { kind: 'kicked' };

export type ClientMessage =
  | {
      kind: 'hello';
      protocolMajor: number;
      protocolMinor: number;
      capabilities: string[];
      impl: MultiplayerImplementation;
      name: string;
      platform: string;
      freeplayEnabled: boolean;
      /** Browser-local sidekick identity; absent on the legacy path. */
      identity?: string;
    }
  | {
      kind: 'pair.proof';
      clientIdentity: string;
      hostNonce: string;
      guestNonce: string;
      proof: string;
    }
  | {
      kind: 'chat.send';
      text: string;
      track?: MultiplayerChatTrackLink;
      action?: Extract<MultiplayerChatAction, 'now-playing'>;
    }
  | { kind: 'freeplay.preference'; enabled: boolean }
  | { kind: 'oda.background.preference'; enabled: boolean }
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
    case 'queue.play-next':
      return (command.collection === 'queue'
        || command.collection === 'library'
        || command.collection === 'favorites')
        && Array.isArray(command.itemIds)
        && command.itemIds.length > 0
        && command.itemIds.length <= MULTIPLAYER_QUEUE_MAX_ITEMS
        && command.itemIds.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 200);
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

const SIDEKICK_IDENTITY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const SIDEKICK_NONCE_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const CAPABILITY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function isSidekickIdentity(value: unknown): value is string {
  return typeof value === 'string' && SIDEKICK_IDENTITY_PATTERN.test(value);
}

function isOptionalSidekickField(value: unknown, pattern: RegExp): boolean {
  return value === undefined || (typeof value === 'string' && pattern.test(value));
}

export function normalizeCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    if (entry.length < 1 || entry.length > 64) continue;
    if (!CAPABILITY_PATTERN.test(entry)) continue;
    if (!seen.has(entry)) seen.add(entry);
  }
  return [...seen];
}

export function hasCapability(capabilities: unknown, capability: string): boolean {
  return normalizeCapabilities(capabilities).includes(capability);
}

function isProtocolMinor(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 0
    && value <= 9999;
}

export function isCompatibleProtocolMajor(major: unknown): boolean {
  return major === MULTIPLAYER_PROTOCOL_MAJOR;
}

/** Admission rule: same major plus every required baseline capability. Minor is ignored. */
export function isCompatibleHelloIdentity(identity: {
  protocolMajor?: unknown;
  capabilities?: unknown;
}): boolean {
  if (!isCompatibleProtocolMajor(identity.protocolMajor)) return false;
  const caps = new Set(normalizeCapabilities(identity.capabilities));
  for (const required of MULTIPLAYER_REQUIRED_BASELINE_CAPABILITIES) {
    if (!caps.has(required)) return false;
  }
  return true;
}

export function getMissingBaselineCapabilities(capabilities: unknown): string[] {
  const caps = new Set(normalizeCapabilities(capabilities));
  return MULTIPLAYER_REQUIRED_BASELINE_CAPABILITIES.filter((required) => !caps.has(required));
}

export function isValidImplementation(value: unknown): value is MultiplayerImplementation {
  if (!value || typeof value !== 'object') return false;
  const impl = value as Partial<MultiplayerImplementation>;
  return typeof impl.product === 'string'
    && impl.product.length >= 1
    && impl.product.length <= 64
    && !/[\u0000-\u001f\u007f]/.test(impl.product)
    && typeof impl.productVersion === 'string'
    && impl.productVersion.length >= 1
    && impl.productVersion.length <= 32
    && !/[\u0000-\u001f\u007f]/.test(impl.productVersion)
    && (impl.build === undefined
      || (typeof impl.build === 'string'
        && impl.build.length <= 128
        && !/[\u0000-\u001f\u007f]/.test(impl.build)));
}

/** Human presentation without assuming every host is browser izci. */
export function formatHostImplementation(impl: MultiplayerImplementation | null | undefined): string {
  if (!impl) return '—';
  if (impl.product === 'izci-server') return `izci dedicated server ${impl.productVersion}`;
  return `${impl.product} ${impl.productVersion}`;
}

/**
 * Envelope shape for any command frame, including unsupported command types.
 * Validators accept this envelope; execution then nacks unknown types instead
 * of dropping them silently.
 */
export function isMultiplayerCommandEnvelope(value: unknown): value is { type: string; commandId: string } {
  if (!value || typeof value !== 'object') return false;
  const command = value as Partial<MultiplayerCommand>;
  return typeof command.type === 'string'
    && command.type.length >= 1
    && command.type.length <= 80
    && typeof command.commandId === 'string'
    && command.commandId.length >= 1
    && command.commandId.length <= 80;
}

/**
 * Unknown-message policy: unknown optional kinds are ignored safely.
 * A frame carrying `critical: true` declares it must not be silently skipped;
 * senders must only emit such frames after negotiating the corresponding
 * capability, and receivers log/drop them rather than failing the connection.
 */
export function isUnknownCriticalMessage(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.kind === 'string' && record.critical === true;
}

export function isHelloProtocolIdentity(value: {
  protocolMajor?: unknown;
  protocolMinor?: unknown;
  capabilities?: unknown;
  impl?: unknown;
}): boolean {
  if (!isCompatibleProtocolMajor(value.protocolMajor)) return false;
  if (!isProtocolMinor(value.protocolMinor)) return false;
  if (!Array.isArray(value.capabilities)) return false;
  // Unknown optional capabilities are ignored, but every advertised name must
  // use the bounded wire format so malformed frames cannot smuggle state.
  for (const entry of value.capabilities) {
    if (typeof entry !== 'string' || !CAPABILITY_PATTERN.test(entry)) return false;
  }
  return isValidImplementation(value.impl);
}

export function isProtocolDisplayName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 48
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function isHostMessage(value: unknown): value is HostMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<HostMessage> & Record<string, unknown>;
  if (message.kind === 'hello') {
    return isHelloProtocolIdentity(message as {
        protocolMajor?: unknown;
        protocolMinor?: unknown;
        capabilities?: unknown;
        impl?: unknown;
      })
      && isProtocolDisplayName(message.name)
      && isOptionalSidekickField(message.identity, SIDEKICK_IDENTITY_PATTERN)
      && isOptionalSidekickField(message.pairNonce, SIDEKICK_NONCE_PATTERN);
  }
  if (message.kind === 'pair.secret') {
    return isSidekickIdentity(message.hostIdentity)
      && typeof message.secret === 'string'
      && /^[0-9a-f]{64}$/.test(message.secret);
  }
  if (message.kind === 'invitation') {
    return typeof message.roomId === 'string'
      && /^[0-9a-f]{32}$/.test(message.roomId)
      && typeof message.secret === 'string'
      && message.secret.length > 0
      && message.secret.length <= 512;
  }
  if (message.kind === 'kicked') return true;
  if (message.kind === 'pairing') {
    return typeof message.paired === 'boolean'
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
  if (message.kind === 'oda.background') {
    return message.background === null || isMultiplayerOdaBackground(message.background);
  }
  if (message.kind === 'oda.background.opacity') {
    return typeof message.opacity === 'number'
      && Number.isInteger(message.opacity)
      && message.opacity >= 0
      && message.opacity <= 100;
  }
  if (message.kind === 'chat.message') {
    return isMultiplayerChatMessage(message.message);
  }
  if (message.kind === 'chat.motd') {
    return typeof message.motd === 'string'
      && message.motd.length <= MULTIPLAYER_CHAT_MAX_MOTD_LENGTH
      && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(message.motd)
      && typeof message.hostName === 'string'
      && message.hostName.length > 0
      && message.hostName.length <= 48
      && !/[\u0000-\u001f\u007f]/.test(message.hostName);
  }
  if (message.kind === 'chat.history') {
    return Array.isArray(message.messages)
      && message.messages.length <= MULTIPLAYER_CHAT_MAX_MESSAGES
      && message.messages.every(isMultiplayerChatMessage);
  }
  if (message.kind === 'chat.clear') return true;
  return false;
}

export function isMultiplayerChatTrackLink(value: unknown): value is MultiplayerChatTrackLink {
  if (!value || typeof value !== 'object') return false;
  const link = value as Partial<MultiplayerChatTrackLink>;
  return (link.collection === 'queue'
    || link.collection === 'library'
    || link.collection === 'favorites')
    && typeof link.itemId === 'string'
    && link.itemId.length > 0
    && link.itemId.length <= 200
    && typeof link.title === 'string'
    && link.title.length > 0
    && link.title.length <= MULTIPLAYER_CHAT_MAX_MESSAGE_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(link.title);
}

export function isMultiplayerChatMessage(value: unknown): value is MultiplayerChatMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Partial<MultiplayerChatMessage>;
  return typeof message.id === 'string'
    && message.id.length > 0
    && message.id.length <= 80
    && typeof message.name === 'string'
    && message.name.length > 0
    && message.name.length <= 48
    && typeof message.text === 'string'
    && message.text.length > 0
    && message.text.length <= MULTIPLAYER_CHAT_MAX_MESSAGE_LENGTH
    && (message.action === undefined
      || message.action === 'me'
      || message.action === 'join'
      || message.action === 'leave'
      || message.action === 'now-playing')
    && (message.track === undefined || isMultiplayerChatTrackLink(message.track))
    && (message.action !== 'now-playing' || message.track !== undefined)
    && !/[\u0000-\u001f\u007f]/.test(message.name)
    && !/[\u0000-\u001f\u007f]/.test(message.text)
    && typeof message.sentAt === 'number'
    && Number.isFinite(message.sentAt);
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

function isMultiplayerOdaBackground(value: unknown): value is MultiplayerOdaBackground {
  if (!value || typeof value !== 'object') return false;
  const background = value as Partial<MultiplayerOdaBackground>;
  return typeof background.dataUrl === 'string'
    && background.dataUrl.length <= MULTIPLAYER_ARTWORK_DATA_URL_MAX_LENGTH
    && /^data:image\/[a-z0-9.+-]+;base64,/i.test(background.dataUrl)
    && Number.isInteger(background.opacity)
    && (background.opacity ?? -1) >= 0
    && (background.opacity ?? 101) <= 100;
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
  return value === 'stream' || value === 'module' || value === 'video' || value === 'image';
}

function createTransferId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
