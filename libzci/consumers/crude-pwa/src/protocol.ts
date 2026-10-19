export const POOL_SIZE = 8;
export const BLOCK_FRAMES = 4096;
export interface Tag { session: number; instance: number; operation: number; generation: number }
export interface Snapshot {
  session: number; revision: number; generation: number; state: string; requested: string; running: string;
  position_frames: number; total_frames: number | null; sample_rate: number | null;
  provider: { id: string; version: string; name: string } | null;
  volume: number; mute: boolean; decoding_eof: boolean; pending_operation: boolean; error: string | null; tag: Tag;
}
export interface Descriptor {
  generation: number; source_start: number; source_end: number; source_rate: number;
  output_start: number; rate: number; frames: number;
}
export interface Block { type: 'block'; id: number; pcm: ArrayBuffer; descriptor: Descriptor }
export interface DecodeJob { type: 'open' | 'seek'; tag: Tag; file?: File; seconds?: number }
export type CommandKind = 'play' | 'pause' | 'stop' | 'seek' | 'volume' | 'mute' | 'dispose';
export const sameTag = (a: Tag, b: Tag): boolean => a.session === b.session && a.instance === b.instance && a.operation === b.operation && a.generation === b.generation;
export function failure(error: unknown): { kind: string; detail: string } {
  const e = error as {kind?: string; detail?: string; message?: string};
  return {kind: e?.kind ?? 'decoder-failure', detail: String(e?.detail ?? e?.message ?? error)};
}
