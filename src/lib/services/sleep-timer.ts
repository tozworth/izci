import { writable } from 'svelte/store';
import { logInfo } from '$lib/services/logging';

export const SLEEP_TIMER_PRESET_MINUTES = [15, 30, 45, 60, 90] as const;

export interface SleepTimerState {
  active: boolean;
  endTime: number | null;
  durationMinutes: number | null;
  remainingSeconds: number | null;
}

const TICK_MS = 1000;

const initialSleepTimerState: SleepTimerState = {
  active: false,
  endTime: null,
  durationMinutes: null,
  remainingSeconds: null
};

export function resolveSleepRemainingSeconds(endTime: number, now: number): number {
  return Math.max(0, Math.ceil((endTime - now) / 1000));
}

let state = initialSleepTimerState;
let intervalId: number | null = null;
let firedHandler: (() => void) | null = null;
const store = writable<SleepTimerState>(state);

function publish(nextState: SleepTimerState): void {
  state = nextState;
  store.set(nextState);
}

function stopInterval(): void {
  if (intervalId === null) return;
  window.clearInterval(intervalId);
  intervalId = null;
}

function fire(): void {
  stopInterval();
  logInfo('playback', 'Sleep timer fired');
  publish(initialSleepTimerState);
  firedHandler?.();
}

function tick(): void {
  const endTime = state.endTime;
  if (endTime === null) return;
  const remainingSeconds = resolveSleepRemainingSeconds(endTime, Date.now());
  publish({ ...state, remainingSeconds });
  if (remainingSeconds <= 0) fire();
}

function startInterval(): void {
  stopInterval();
  intervalId = window.setInterval(tick, TICK_MS);
}

export function setSleepTimerFiredHandler(handler: () => void): void {
  firedHandler = handler;
}

export function setSleepTimer(minutes: number): void {
  const durationMinutes = Math.max(1, Math.round(minutes));
  const endTime = Date.now() + durationMinutes * 60_000;
  logInfo('playback', 'Sleep timer set', { durationMinutes, endTime });
  publish({
    active: true,
    endTime,
    durationMinutes,
    remainingSeconds: durationMinutes * 60
  });
  startInterval();
}

export function cancelSleepTimer(): void {
  stopInterval();
  logInfo('playback', 'Sleep timer cancelled');
  publish(initialSleepTimerState);
}

export const sleepTimer = {
  subscribe: store.subscribe,
  getSnapshot(): SleepTimerState {
    return state;
  }
};
