import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWheelSeekController } from './wheel-seek';

afterEach(() => {
  vi.useRealTimers();
});

describe('createWheelSeekController', () => {
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

  it('uses the live step from a getter on every notch', () => {
    let stepSeconds = 5;
    let currentTime = 60;
    const previews: number[] = [];
    const controller = createWheelSeekController({
      getCurrentTime: () => currentTime,
      getDuration: () => 120,
      getContextKey: () => 'track-a',
      stepSeconds: () => stepSeconds,
      onPreview: (seconds) => {
        if (seconds !== null) previews.push(seconds);
      },
      onCommit: () => undefined
    });

    controller.step(1);
    stepSeconds = 10;
    controller.step(1);
    stepSeconds = 2;
    controller.step(1);

    expect(previews).toEqual([55, 45, 43]);
  });

  it('falls back to the default step for an invalid getter value', () => {
    let stepSeconds = 0;
    const previews: number[] = [];
    const controller = createWheelSeekController({
      getCurrentTime: () => 100,
      getDuration: () => 120,
      getContextKey: () => 'track-a',
      stepSeconds: () => stepSeconds,
      onPreview: (seconds) => {
        if (seconds !== null) previews.push(seconds);
      },
      onCommit: () => undefined
    });

    controller.step(1);

    expect(previews).toEqual([95]);
  });
});
