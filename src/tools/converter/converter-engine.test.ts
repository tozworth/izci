import { describe, expect, it } from 'vitest';
import { runConcurrent } from './converter-engine';

describe('converter concurrency pool', () => {
  it('honors the requested parallel job limit', async () => {
    let active = 0;
    let maximumActive = 0;
    const completed: number[] = [];
    await runConcurrent([0, 1, 2, 3, 4], 2, new AbortController().signal, async (item) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      completed.push(item);
      active -= 1;
    });
    expect(maximumActive).toBe(2);
    expect(completed.sort()).toEqual([0, 1, 2, 3, 4]);
  });

  it('does not start work after cancellation', async () => {
    const controller = new AbortController();
    const started: number[] = [];
    await runConcurrent([0, 1, 2], 1, controller.signal, async (item) => {
      started.push(item);
      controller.abort();
    });
    expect(started).toEqual([0]);
  });
});
