import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('$lib/services/logging', () => ({
  logInfo: vi.fn()
}));

import {
  SLEEP_TIMER_PRESET_MINUTES,
  cancelSleepTimer,
  setSleepTimer,
  setSleepTimerFiredHandler,
  sleepTimer
} from './sleep-timer';

// The service schedules through window.setInterval; delegate to the global
// timer functions so vi.useFakeTimers() controls the ticks.
vi.stubGlobal('window', {
  setInterval: (...args: Parameters<typeof setInterval>) => setInterval(...args),
  clearInterval: (id: number) => clearInterval(id)
});

describe('sleep timer lifecycle', () => {
  let fired: Mock<() => void>;

  beforeEach(() => {
    vi.useFakeTimers();
    cancelSleepTimer();
    fired = vi.fn();
    setSleepTimerFiredHandler(fired);
  });

  afterEach(() => {
    cancelSleepTimer();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('activates with a rounded-up end time and full remaining seconds', () => {
    vi.setSystemTime(1_000_000);

    setSleepTimer(30);

    expect(sleepTimer.getSnapshot()).toMatchObject({
      active: true,
      durationMinutes: 30,
      remainingSeconds: 30 * 60,
      endTime: 1_000_000 + 30 * 60_000
    });
  });

  it('clamps sub-minute durations to one minute', () => {
    setSleepTimer(0);

    expect(sleepTimer.getSnapshot()).toMatchObject({
      active: true,
      durationMinutes: 1,
      remainingSeconds: 60
    });
  });

  it('counts down as time advances without firing early', () => {
    setSleepTimer(2);

    vi.advanceTimersByTime(90_000);

    const snapshot = sleepTimer.getSnapshot();
    expect(snapshot.active).toBe(true);
    expect(snapshot.remainingSeconds).toBe(30);
    expect(fired).not.toHaveBeenCalled();

    vi.advanceTimersByTime(29_000);

    expect(sleepTimer.getSnapshot().remainingSeconds).toBe(1);
    expect(fired).not.toHaveBeenCalled();
  });

  it('fires the handler once at zero remaining and resets to inactive', () => {
    setSleepTimer(1);
    const endTime = sleepTimer.getSnapshot().endTime;

    vi.advanceTimersByTime(60_000);

    expect(fired).toHaveBeenCalledTimes(1);
    expect(sleepTimer.getSnapshot()).toEqual({
      active: false,
      endTime: null,
      durationMinutes: null,
      remainingSeconds: null
    });

    // The interval is stopped after firing; more elapsed time is inert.
    vi.advanceTimersByTime(120_000);
    expect(fired).toHaveBeenCalledTimes(1);
    expect(endTime).not.toBeNull();
  });

  it('cancel deactivates immediately and no longer fires', () => {
    setSleepTimer(1);

    cancelSleepTimer();

    expect(sleepTimer.getSnapshot()).toEqual({
      active: false,
      endTime: null,
      durationMinutes: null,
      remainingSeconds: null
    });

    vi.advanceTimersByTime(120_000);
    expect(fired).not.toHaveBeenCalled();
  });

  it('restarting replaces the deadline instead of stacking intervals', () => {
    setSleepTimer(60);

    vi.advanceTimersByTime(30_000);
    setSleepTimer(15);

    const restarted = sleepTimer.getSnapshot();
    expect(restarted.durationMinutes).toBe(15);
    expect(restarted.remainingSeconds).toBe(15 * 60);

    // Original deadline would be ~59.5 minutes away; the new one fires first.
    vi.advanceTimersByTime(15 * 60_000 - 500);
    expect(fired).not.toHaveBeenCalled();
    expect(sleepTimer.getSnapshot().remainingSeconds).toBe(1);

    vi.advanceTimersByTime(500);
    expect(fired).toHaveBeenCalledTimes(1);
  });

  it('exposes the preset minute options', () => {
    expect(SLEEP_TIMER_PRESET_MINUTES).toEqual([15, 30, 45, 60, 90]);
  });
});
