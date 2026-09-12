/**
 * Oda Now Playing focus IDs.
 *
 * The transport strip and queue rail are two navigation regions linked by the
 * now-playing focus model, so both OdaShell and the view need the same IDs.
 */

export const ODA_NP_PLAY_PAUSE = 'np:play-pause';
export const ODA_NP_PREVIOUS = 'np:previous';
export const ODA_NP_NEXT = 'np:next';
export const ODA_NP_PROGRESS = 'np:progress';
export const ODA_NP_SHUFFLE = 'np:shuffle';
export const ODA_NP_REPEAT = 'np:repeat';
export const ODA_NP_VOLUME = 'np:volume';
export const ODA_NP_SEEK_STEP_SECONDS = 10;

export type OdaNowPlayingQueueAction = 'move-up' | 'move-down' | 'remove';

const ODA_NP_QUEUE_ACTION_PREFIX = 'np:queue-action:';

export function odaNowPlayingQueueActionFocusId(
  trackId: string,
  action: OdaNowPlayingQueueAction
): string {
  return `${ODA_NP_QUEUE_ACTION_PREFIX}${action}:${trackId}`;
}

export function parseOdaNowPlayingQueueActionFocusId(
  focusId: string | null
): { trackId: string; action: OdaNowPlayingQueueAction } | null {
  if (!focusId?.startsWith(ODA_NP_QUEUE_ACTION_PREFIX)) return null;
  const value = focusId.slice(ODA_NP_QUEUE_ACTION_PREFIX.length);
  const separator = value.indexOf(':');
  if (separator < 0) return null;
  const action = value.slice(0, separator);
  if (action !== 'move-up' && action !== 'move-down' && action !== 'remove') return null;
  const trackId = value.slice(separator + 1);
  return trackId ? { trackId, action } : null;
}

export function resolveOdaNowPlayingQueueActionIds(
  trackId: string,
  canMove: boolean,
  canRemove: boolean
): string[] {
  return [
    ...(canMove
      ? [
          odaNowPlayingQueueActionFocusId(trackId, 'move-up'),
          odaNowPlayingQueueActionFocusId(trackId, 'move-down')
        ]
      : []),
    ...(canRemove ? [odaNowPlayingQueueActionFocusId(trackId, 'remove')] : [])
  ];
}

export function resolveOdaNowPlayingRemovalTargetId(
  queueIds: readonly string[],
  removedId: string
): string | null {
  const index = queueIds.indexOf(removedId);
  if (index < 0) return null;
  return queueIds[index + 1] ?? queueIds[index - 1] ?? null;
}

export function resolveOdaNowPlayingTransportIds(): string[] {
  return resolveOdaNowPlayingTransportRows().flat();
}

export function resolveOdaNowPlayingTransportRows(): string[][] {
  return [
    [ODA_NP_PROGRESS],
    [ODA_NP_SHUFFLE, ODA_NP_PREVIOUS, ODA_NP_PLAY_PAUSE, ODA_NP_NEXT, ODA_NP_REPEAT, ODA_NP_VOLUME]
  ];
}
