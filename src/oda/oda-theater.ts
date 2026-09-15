/**
 * Oda theater control IDs and ordering.
 *
 * The control strip is driven by the same logical focus model as every other
 * Oda view, so these IDs are the navigation contract between OdaShell (which
 * builds the model) and the theater components (which render the buttons).
 */

import { ODA_NP_QUEUE, ODA_NP_REPEAT, ODA_NP_SHUFFLE } from './oda-now-playing';

export type OdaTheaterKind = 'video' | 'image';

export const ODA_THEATER_PLAY_PAUSE = 'th:play-pause';
export const ODA_THEATER_SLIDESHOW = 'th:slideshow';
export const ODA_THEATER_PREVIOUS = 'th:previous';
export const ODA_THEATER_NEXT = 'th:next';
export const ODA_THEATER_PROGRESS = 'th:progress';
export const ODA_THEATER_FIT = 'th:fit';
export const ODA_THEATER_SEEK_STEP_SECONDS = 10;

export function resolveOdaTheaterControlRows(kind: OdaTheaterKind): string[][] {
  const center = kind === 'video' ? ODA_THEATER_PLAY_PAUSE : ODA_THEATER_SLIDESHOW;
  const transport = [
    ODA_THEATER_FIT,
    ODA_NP_SHUFFLE,
    ODA_THEATER_PREVIOUS,
    center,
    ODA_THEATER_NEXT,
    ODA_NP_REPEAT,
    ODA_NP_QUEUE
  ];
  return kind === 'video' ? [transport, [ODA_THEATER_PROGRESS]] : [transport];
}

export function resolveOdaTheaterControlIds(kind: OdaTheaterKind): string[] {
  return resolveOdaTheaterControlRows(kind).flat();
}
