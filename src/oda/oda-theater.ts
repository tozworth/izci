/**
 * Oda theater control IDs and ordering.
 *
 * The control strip is driven by the same logical focus model as every other
 * Oda view, so these IDs are the navigation contract between OdaShell (which
 * builds the model) and the theater components (which render the buttons).
 */

import { ODA_NP_QUEUE } from './oda-now-playing';

export type OdaTheaterKind = 'video' | 'image';

export const ODA_THEATER_PLAY_PAUSE = 'th:play-pause';
export const ODA_THEATER_PREVIOUS = 'th:previous';
export const ODA_THEATER_NEXT = 'th:next';
export const ODA_THEATER_SEEK_BACK = 'th:seek-back';
export const ODA_THEATER_SEEK_FORWARD = 'th:seek-forward';
export const ODA_THEATER_FIT = 'th:fit';
export const ODA_THEATER_ZOOM_OUT = 'th:zoom-out';
export const ODA_THEATER_ZOOM_IN = 'th:zoom-in';
export const ODA_THEATER_ROTATE = 'th:rotate';
export const ODA_THEATER_BACK = 'th:back';
export const ODA_THEATER_SEEK_STEP_SECONDS = 10;

export function resolveOdaTheaterControlIds(kind: OdaTheaterKind): string[] {
  const transport = [ODA_THEATER_PLAY_PAUSE, ODA_THEATER_PREVIOUS, ODA_THEATER_NEXT];
  if (kind === 'video') {
    return [...transport, ODA_THEATER_SEEK_BACK, ODA_THEATER_SEEK_FORWARD, ODA_THEATER_FIT, ODA_NP_QUEUE, ODA_THEATER_BACK];
  }
  return [...transport, ODA_THEATER_ZOOM_OUT, ODA_THEATER_ZOOM_IN, ODA_THEATER_ROTATE, ODA_THEATER_FIT, ODA_NP_QUEUE, ODA_THEATER_BACK];
}
