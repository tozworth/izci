import { writable, type Readable } from 'svelte/store';
import {
  toQueueSnapshotView,
  type CoreProfileQueueState,
  type QueueSnapshotView
} from './queue-snapshot';

/**
 * Read-only Svelte observation facade over core queue state. The future
 * owner-worker binding will push `WebProfile` observations here; components
 * render from `view` and never mutate through this module. Queue commands,
 * persistence and owner election remain open A2 work.
 */
export interface CoreQueueFacade {
  readonly view: Readable<QueueSnapshotView | null>;
  readonly revision: Readable<number | null>;
  /**
   * Apply a core observation. First observations always apply; later ones
   * apply only when they carry a newer revision, so late or duplicate
   * deliveries from owner handoff stay harmless.
   */
  pushObservation(state: CoreProfileQueueState): void;
}

export function createCoreQueueFacade(): CoreQueueFacade {
  const view = writable<QueueSnapshotView | null>(null);
  const revision = writable<number | null>(null);
  let appliedRevision: number | null = null;

  return {
    view: { subscribe: view.subscribe },
    revision: { subscribe: revision.subscribe },
    pushObservation(state: CoreProfileQueueState): void {
      if (appliedRevision !== null && state.revision <= appliedRevision) return;
      appliedRevision = state.revision;
      view.set(toQueueSnapshotView(state));
      revision.set(state.revision);
    }
  };
}
