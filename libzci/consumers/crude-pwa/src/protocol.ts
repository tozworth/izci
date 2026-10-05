/**
 * Worker protocol: every message carries session/generation identity so
 * stale results are releasable on both sides. Field names match the
 * JSON shapes in `crates/libzci-web/src/bindings.rs`.
 *
 * Routing: the document routes; it never decides. Engine sessions are
 * engine-issued; decode loads are document-issued (`loadId`) until the
 * document binds them to an engine session after `open`.
 */

export type SessionId = number;
export type Generation = number;

export type TransportState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'ended'
  | 'failed'
  | 'output-suspended';

export interface ProviderRef {
  id: string;
  version: string;
  display_name: string;
}

export interface Snapshot {
  session: SessionId;
  revision: number;
  generation: Generation;
  state: TransportState;
  provider: ProviderRef | null;
  position_frames: number;
  total_frames: number | null;
  error: string | null;
}

export interface PageEntry {
  offset: number;
  /** -1 encodes a missing granule (no packet ends on the page). */
  granule: number;
  serial: number;
  seq: number;
  header_type: number;
  header_len: number;
  body_len: number;
}

/** `true` when the page carries a packet-ending granule. */
export function hasGranule(page: PageEntry): boolean {
  return page.granule >= 0;
}

/** Document -> engine worker. */
export type MainToEngine =
  | { type: 'open'; header: ArrayBuffer; extensionHint: string | null }
  | { type: 'commit-index'; session: SessionId; pages: PageEntry[]; audioStartPage: number; audioStartPacket: number; preskip: number; channels: number }
  | { type: 'ingest-pcm'; session: SessionId; generation: Generation; startFrame: number; pcm: Float32Array }
  | { type: 'note-eof'; session: SessionId; generation: Generation }
  | { type: 'command'; session: SessionId; kind: 'play' | 'pause' | 'stop' | 'seek' | 'dispose'; frame?: number }
  | { type: 'seek-plan'; session: SessionId; target: number }
  | { type: 'snapshot'; session: SessionId };

/** Engine worker -> document. */
export type EngineToMain =
  | { type: 'snapshot'; session: SessionId; snapshot: Snapshot }
  | { type: 'command-result'; session: SessionId; generation: Generation; snapshot: Snapshot }
  | { type: 'seek-plan'; session: SessionId; target: number; startPage: number; skipPackets: number; skipSamples: number; totalFrames: number | null }
  | { type: 'index-committed'; session: SessionId; totalFrames: number; audioStartPage: number; audioStartPacket: number }
  | { type: 'pumped'; session: SessionId; generation: Generation; acceptedFrames: number; positionFrames: number }
  | { type: 'error'; session: SessionId; kind: string; detail: string };

/** Document -> decode worker. */
export type MainToDecode =
  | { type: 'load'; loadId: number; file: File; extensionHint: string | null }
  | { type: 'scan'; loadId: number; session: SessionId }
  | { type: 'start'; session: SessionId; generation: Generation; startPage: number; skipPackets: number; skipSamples: number; targetFrame: number; totalFrames: number | null }
  | { type: 'release'; session: SessionId };

/** Decode worker -> document. */
export type DecodeToMain =
  | { type: 'header'; loadId: number; header: ArrayBuffer; fileSize: number; maxSingleRead: number }
  | { type: 'index'; loadId: number; session: SessionId; pages: PageEntry[]; audioStartPage: number; audioStartPacket: number; preskip: number; channels: number; totalEstimate: number | null; bytesRead: number; maxSingleRead: number }
  | { type: 'pcm'; session: SessionId; generation: Generation; startFrame: number; pcm: Float32Array }
  | { type: 'eof'; session: SessionId; generation: Generation; frames: number }
  | { type: 'failed'; session: SessionId; generation: Generation; kind: string; detail: string }
  | { type: 'released'; session: SessionId };
