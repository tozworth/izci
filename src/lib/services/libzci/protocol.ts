/** Shared contracts for the production libzci browser playback bridge. */
export const BLOCK_FRAMES = 4096;
export const POOL_SIZE = 8;

export interface CoreTag {
  session: number;
  instance: number;
  operation: number;
  generation: number;
}

export interface CoreModuleObservation {
  selected_subsong: number;
  order: number;
  pattern: number;
  row: number;
  first_row: number;
  rows: number;
  channels: number;
  cells: number[][];
}

export interface CoreSnapshot {
  session: number;
  revision: number;
  generation: number;
  state: 'Idle' | 'Loading' | 'Ready' | 'Playing' | 'Ended' | 'Failed' | 'OutputSuspended';
  requested: 'Held' | 'Running';
  running: 'Closed' | 'Running' | 'Suspended' | 'Failed';
  position_frames: number;
  consumed_frames: number;
  output_rate: number | null;
  total_frames: number | null;
  sample_rate: number | null;
  provider: { id: string; version: string; name: string } | null;
  volume: number;
  mute: boolean;
  decoding_eof: boolean;
  pending_operation: boolean;
  error: string | null;
  tag: CoreTag;
  subsong?: number | null;
  capabilities?: Record<string, number | boolean>;
  module?: CoreModuleObservation | null;
}

export interface CoreFacts {
  provider: { id: string; name: string; version: string };
  rate: number;
  channels: number;
  total: number | null;
  comments: Array<[string, string]>;
  capabilities: Record<string, number | boolean>;
  module: CoreModuleObservation | null;
  applied?: Record<string, boolean>;
  normalization_points?: Array<{ source_frame: number; tags: Record<string, unknown> }>;
}

export interface WorkletBlock {
  type: 'block';
  id: number;
  pcm: ArrayBuffer;
  descriptor: {
    generation: number;
    source_start: number;
    source_end: number;
    source_rate: number;
    output_start: number;
    rate: number;
    frames: number;
  };
}

export interface WorkletEof {
  type: 'eof';
  generation: number;
}

export type WorkletDecodeMessage = WorkletBlock | WorkletEof;

export interface WorkerInitRequest {
  type: 'init';
  rate: number;
  latency: number;
  decode: MessagePort;
  control: MessagePort;
}

export interface WorkerLoadRequest {
  type: 'load';
  request: string;
  file: File;
  startSeconds: number;
  subsong: number | null;
  autoPlay: boolean;
  replayGain: Record<string, unknown>;
}

export interface WorkerCommandRequest {
  type: 'command';
  request: string;
  kind: string;
  value: number;
}

export interface WorkerCloseRequest {
  type: 'close';
}

export interface WorkerContextRequest {
  type: 'context';
  state: AudioContextState;
}

export type WorkerRequest = WorkerInitRequest | WorkerLoadRequest | WorkerCommandRequest | WorkerCloseRequest | WorkerContextRequest;

export interface WorkerSnapshotMessage {
  type: 'snapshot';
  core: CoreSnapshot;
  facts: CoreFacts | null;
  ended: boolean;
}

export interface WorkerResultMessage {
  type: 'result';
  request: string;
  value?: unknown;
  error?: string;
}

export interface WorkerErrorMessage {
  type: 'error';
  detail: string;
  kind?: string;
}

export interface WorkerReadyMessage {
  type: 'ready';
}

export type WorkerMessage =
  | WorkerSnapshotMessage
  | WorkerResultMessage
  | WorkerErrorMessage
  | WorkerReadyMessage;
