import { writable } from 'svelte/store';
import { playerController } from '$lib/services/player-controller';
import { logDebug, logInfo } from '$lib/services/logging';
import type { PlaybackSnapshot, TrackItem } from '$lib/types';

export interface AbLoopRange {
  start: number;
  end: number;
}

export interface AbLoopState {
  active: boolean;
  start: number | null;
  end: number | null;
}

export const initialAbLoopState: AbLoopState = {
  active: false,
  start: null,
  end: null
};

export function resolveAbLoopRange(
  state: Pick<AbLoopState, 'active' | 'start' | 'end'>
): AbLoopRange | null {
  if (!state.active || state.start === null || state.end === null) return null;
  if (!(state.start < state.end)) return null;
  return { start: state.start, end: state.end };
}

export function canEnableAbLoop(state: Pick<AbLoopState, 'start' | 'end'>): boolean {
  return state.start !== null && state.end !== null && state.start < state.end;
}

let state = initialAbLoopState;
let lastLoopTrackId: string | null = null;
const store = writable<AbLoopState>(state);

function publish(nextState: AbLoopState): void {
  state = nextState;
  store.set(nextState);
}

function enforceLoop(snapshot: PlaybackSnapshot): void {
  const range = resolveAbLoopRange(state);
  if (!range || snapshot.currentTime < range.end) return;
  logDebug('playback', 'A-B loop wrapped', {
    start: range.start,
    end: range.end,
    at: snapshot.currentTime
  });
  playerController.seek(range.start);
}

function clearLoopOnTrackChange(track: TrackItem | null): void {
  const trackId = track?.id ?? null;
  if (trackId === lastLoopTrackId) return;
  lastLoopTrackId = trackId;
  if (state.active || state.start !== null || state.end !== null) {
    logInfo('playback', 'A-B loop cleared on track change');
    publish(initialAbLoopState);
  }
}

export function setAbLoopStart(seconds: number): void {
  const start = Math.max(seconds, 0);
  logInfo('playback', 'A-B loop start set', { start });
  publish({ active: false, start, end: state.end });
}

export function setAbLoopEnd(seconds: number): void {
  const end = Math.max(seconds, 0);
  logInfo('playback', 'A-B loop end set', { end });
  publish({ active: canEnableAbLoop({ start: state.start, end }), start: state.start, end });
}

export function clearAbLoop(): void {
  logInfo('playback', 'A-B loop cleared');
  publish(initialAbLoopState);
}

export const abLoop = {
  subscribe: store.subscribe,
  getSnapshot(): AbLoopState {
    return state;
  }
};

playerController.currentTrack.subscribe(clearLoopOnTrackChange);
playerController.snapshot.subscribe(enforceLoop);
