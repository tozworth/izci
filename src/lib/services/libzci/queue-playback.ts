import { inferExtension, inferKind } from '$lib/utils/files';
import type { TrackKind } from '$lib/types';
import type { CoreSourceRegistry, QueueLoadLike } from './source-registry';

/**
 * Resolve a core `QueueLoad` to a playback request using live `File`s.
 *
 * Core owns queue order, occurrence ids, positions, and subsongs; Svelte
 * owns `File` objects, handles, and audio nodes until the owner worker
 * materializes them. This helper is the transitional seam:
 *
 * - `resolveQueuePlayback` returns `null` when the source needs capability/
 *   native resolution through the future owner worker (`access-required`).
 * - Unsupported kinds (including images, which never enter the music queue)
 *   are reported as `unsupported` by `describeQueueLoadIssue`.
 *
 * Nothing here posts commands, touches storage, or starts audio.
 */

export interface ResolvedQueuePlayback {
  file: File;
  occurrence: number;
  positionSeconds: number;
  subsong: number | null;
  autoplay: boolean;
  displayPath: string;
  extension: string;
  kind: TrackKind | null;
}

export type QueueLoadIssue = 'access-required' | 'unsupported';

function normalizePositionSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 0;
  return value;
}

function normalizeSubsong(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

export function resolveQueuePlayback(
  load: QueueLoadLike,
  registry: CoreSourceRegistry
): ResolvedQueuePlayback | null {
  const file = registry.resolveLoad(load);
  if (!file) return null;
  const displayPath = load.source.display_path;
  const extension = inferExtension(file.name || displayPath);
  const kind = inferKind(extension);
  return {
    file,
    occurrence: load.occurrence,
    positionSeconds: normalizePositionSeconds(load.position_seconds),
    subsong: normalizeSubsong(load.subsong),
    autoplay: load.autoplay === true,
    displayPath,
    extension,
    kind
  };
}

/**
 * Classify why a `QueueLoad` cannot play right now. Returns `null` when the
 * load resolves to a playable (non-image) file.
 */
export function describeQueueLoadIssue(
  load: QueueLoadLike,
  registry: CoreSourceRegistry
): QueueLoadIssue | null {
  const resolved = resolveQueuePlayback(load, registry);
  if (!resolved) return 'access-required';
  if (resolved.kind === null || resolved.kind === 'image') return 'unsupported';
  return null;
}
