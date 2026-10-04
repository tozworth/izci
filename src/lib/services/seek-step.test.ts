import { describe, expect, it, vi } from 'vitest';
import { resolveSeekStep, createKeyboardSeekResolver } from './seek-step';

describe('pattern-aware seek steps', () => {
  const starts = [0, 7.68, 11.52, 26.88];

  it('accumulates repeated keys while progress is stale, resetting on track/subsong changes', () => {
    const resolve = createKeyboardSeekResolver();
    expect(resolve(5, 1, 40, starts, 'track:0')).toBe(7.68);
    expect(resolve(5, 1, 40, starts, 'track:0')).toBe(11.52);
    expect(resolve(5, -1, 40, starts, 'track:0')).toBe(7.68);
    expect(resolve(5, 1, 40, starts, 'track:1')).toBe(7.68);
    expect(resolve(12, 1, 40, starts, 'track:1')).toBe(26.88);
  });

  it('expires a pending keyboard target and honors disabling pattern seeks', () => {
    vi.useFakeTimers();
    try {
      const resolve = createKeyboardSeekResolver();
      expect(resolve(5, 1, 40, starts, 'track')).toBe(7.68);
      vi.advanceTimersByTime(251);
      expect(resolve(5, 1, 40, starts, 'track')).toBe(7.68);
      expect(resolve(5, 1, 40, null, 'track')).toBe(10);
    } finally { vi.useRealTimers(); }
  });

  it('seeks to adjacent patterns rather than restarting the current pattern', () => {
    expect(resolveSeekStep(10, -1, 40, starts)).toBe(0);
    expect(resolveSeekStep(10, 1, 40, starts)).toBe(11.52);
    expect(resolveSeekStep(11.52, -1, 40, starts)).toBe(7.68);
    expect(resolveSeekStep(11.5199, 1, 40, starts)).toBe(26.88);
  });

  it('stays within the first and last pattern without wrapping or ending playback', () => {
    expect(resolveSeekStep(1, -1, 40, starts)).toBe(0);
    expect(resolveSeekStep(35, 1, 40, starts)).toBe(26.88);
    expect(resolveSeekStep(40, -1, 40, starts)).toBe(11.52);
  });

  it('retains bounded time steps without pattern timing data', () => {
    expect(resolveSeekStep(10, -1, 40)).toBe(5);
    expect(resolveSeekStep(10, 1, 40, [])).toBe(15);
    expect(resolveSeekStep(1, -1, 40)).toBe(0);
    expect(resolveSeekStep(39, 1, 40)).toBe(40);
  });
});
