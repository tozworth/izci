import { describeAccessAction } from './access-status';
import { describeQueueLoadIssue, resolveQueuePlayback } from './queue-playback';
import { guardTransportCommand } from './transport-guard';
import type { CoreSourceRegistry, QueueLoadLike } from './source-registry';

/**
 * Compose the cold-start / reload / handoff restore flow from existing seams.
 *
 * The owner worker reports the current `QueueLoad` (`restore`); the registry
 * resolves it to a live `File`; access status decides whether playback may
 * proceed or a grant/re-add is needed; the transport guard decides whether
 * `play` needs a restore-first. This module only composes those pure
 * decisions — it never posts, resolves handles, or starts audio. The async
 * `restore` call itself stays on the caller (owner-client) so this helper
 * remains unit-testable without a worker.
 */

export type RestorePlan =
  | { action: 'select-track' }
  | { action: 'wait' }
  | { action: 're-add' }
  | { action: 'grant-and-retry' }
  | {
      action: 'play';
      file: File;
      occurrence: number;
      positionSeconds: number;
      subsong: number | null;
      autoplay: boolean;
    };

/**
 * Plan what to do with a restored load (or none) and the current access.
 * Pure: no I/O, no posts, no timers.
 */
export function planRestoredPlayback(
  load: QueueLoadLike | null,
  registry: CoreSourceRegistry,
  access: string
): RestorePlan {
  if (load === null) return { action: 'select-track' };
  const issue = describeQueueLoadIssue(load, registry);
  if (issue === 'unsupported') return { action: 'select-track' };
  if (issue === 'access-required') return mapAccessToPlan(access);
  const resolved = resolveQueuePlayback(load, registry);
  if (!resolved) return mapAccessToPlan(access);
  const guard = guardTransportCommand('play', access);
  if (guard.allowed && !guard.restoreFirst) {
    return {
      action: 'play',
      file: resolved.file,
      occurrence: resolved.occurrence,
      positionSeconds: resolved.positionSeconds,
      subsong: resolved.subsong,
      autoplay: resolved.autoplay
    };
  }
  return mapAccessToPlan(access);
}

function mapAccessToPlan(access: string): RestorePlan {
  const fallback = describeAccessAction(access);
  if (fallback === 'wait') return { action: 'wait' };
  if (fallback === 're-add') return { action: 're-add' };
  if (fallback === 'select-track') return { action: 'select-track' };
  return { action: 'grant-and-retry' };
}
