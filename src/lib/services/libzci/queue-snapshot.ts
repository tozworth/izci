/**
 * Read-only probe of the core queue snapshot contract for the future Svelte
 * queue facade. This module pins the JSON shape published by core
 * (`WebProfile` queue state, as consumed by the crude `queueView`) and maps
 * it to a render-ready view without touching any Svelte store. Mutations,
 * persistence and owner election stay open A2 work; nothing here writes.
 */

export interface CoreQueueItem {
  id: number;
  source_key: string;
  subsong: number | null;
}

export type CoreSourceKind = 'native_path' | 'browser_handle' | 'ephemeral';

export interface CoreSourceReference {
  key: string;
  kind: CoreSourceKind;
  locator: string;
  display_path: string;
}

/** Minimal structural mirror of the core queue/profile state we observe. */
export interface CoreProfileQueueState {
  revision: number;
  sources: CoreSourceReference[];
  queue: {
    items: CoreQueueItem[];
    current: number | null;
    up_next: number[];
  };
  position_seconds: number;
}

export interface QueueSnapshotRow {
  occurrenceId: number;
  title: string;
  /** False for plain File inputs and unknown sources: not restorable. */
  restorable: boolean;
  subsong: number | null;
  isCurrent: boolean;
}

export interface QueueSnapshotView {
  revision: number;
  rows: QueueSnapshotRow[];
  currentId: number | null;
  upNext: number[];
  positionSeconds: number;
}

/**
 * True when the view must re-render: first observation or a newer core
 * revision. Mirrors the crude revision guard so both shells skip stale work.
 */
export function isQueueSnapshotStale(
  lastRenderedRevision: number | null,
  state: CoreProfileQueueState
): boolean {
  return lastRenderedRevision === null || state.revision !== lastRenderedRevision;
}

/** Join occurrence items with their source references into render rows. */
export function toQueueSnapshotView(state: CoreProfileQueueState): QueueSnapshotView {
  const sources = new Map(state.sources.map((source) => [source.key, source]));
  const rows = state.queue.items.map((item) => {
    const source = sources.get(item.source_key);
    return {
      occurrenceId: item.id,
      // Unknown sources must stay visible rather than crash the join; the
      // key is the only stable label core still guarantees for them.
      title: source?.display_path ?? item.source_key,
      restorable: source?.kind === 'browser_handle',
      subsong: item.subsong,
      isCurrent: state.queue.current === item.id
    } satisfies QueueSnapshotRow;
  });
  return {
    revision: state.revision,
    rows,
    currentId: state.queue.current,
    upNext: [...state.queue.up_next],
    positionSeconds: state.position_seconds
  };
}
