import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWheelSeekController } from './wheel-seek';

afterEach(() => {
  vi.useRealTimers();
});

describe('createWheelSeekController', () => {
  it('accumulates pattern steps and reverses direction within a wheel burst', () => {
    vi.useFakeTimers();
    const commits: number[] = [];
    const previews: Array<number | null> = [];
    const controller = createWheelSeekController({
      getCurrentTime: () => 5,
      getDuration: () => 40,
      getContextKey: () => 'module-a:0',
      getPatternSeekTimes: () => [0, 7.68, 11.52, 26.88],
      onPreview: (seconds) => previews.push(seconds),
      onCommit: (seconds) => commits.push(seconds)
    });
    controller.step(-1);
    controller.step(-1);
    controller.step(1);
    expect(previews).toEqual([7.68, 11.52, 7.68]);
    vi.advanceTimersByTime(80);
    expect(commits).toEqual([7.68]);
  });

  it('accumulates a rapid wheel burst independently of stale playback progress', () => {
    vi.useFakeTimers();
    let currentTime = 60;
    const previews: Array<number | null> = [];
    const commits: number[] = [];
    const controller = createWheelSeekController({
      getCurrentTime: () => currentTime,
      getDuration: () => 120,
      getContextKey: () => 'track-a',
      onPreview: (seconds) => previews.push(seconds),
      onCommit: (seconds) => commits.push(seconds)
    });

    controller.step(1);
    currentTime = 60;
    controller.step(1);
    currentTime = 55;
    controller.step(1);

    expect(previews).toEqual([55, 50, 45]);
    expect(commits).toEqual([]);

    vi.advanceTimersByTime(80);

    expect(previews).toEqual([55, 50, 45, null]);
    expect(commits).toEqual([45]);
  });

  it('discards a pending seek when the active track changes', () => {
    vi.useFakeTimers();
    let trackId = 'track-a';
    const commits: number[] = [];
    const controller = createWheelSeekController({
      getCurrentTime: () => 30,
      getDuration: () => 90,
      getContextKey: () => trackId,
      onPreview: () => undefined,
      onCommit: (seconds) => commits.push(seconds)
    });

    controller.step(1);
    trackId = 'track-b';
    vi.advanceTimersByTime(80);

    expect(commits).toEqual([]);
  });

  it('can commit immediately and clamps against the latest duration', () => {
    let duration = 100;
    const commits: number[] = [];
    const controller = createWheelSeekController({
      getCurrentTime: () => 98,
      getDuration: () => duration,
      getContextKey: () => 'track-a',
      onPreview: () => undefined,
      onCommit: (seconds) => commits.push(seconds)
    });

    controller.step(-1);
    duration = 99;
    controller.commit();

    expect(commits).toEqual([99]);
  });
});
