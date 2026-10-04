import { describe, expect, it } from 'vitest';
import { createThumbnailJobQueue } from './thumbnail-jobs';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => { resolve = next; });
  return { promise, resolve };
}

describe('Thumbnail job queue', () => {
  it('bounds concurrent thumbnail work', async () => {
    const queue = createThumbnailJobQueue(2);
    const gates = [deferred(), deferred(), deferred()];
    let active = 0;
    let peak = 0;
    let started = 0;

    for (const gate of gates) {
      queue.schedule(async () => {
        started += 1;
        active += 1;
        peak = Math.max(peak, active);
        await gate.promise;
        active -= 1;
      });
    }

    await Promise.resolve();
    expect(started).toBe(2);
    expect(peak).toBe(2);
    gates[0].resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toBe(3);
    gates[1].resolve();
    gates[2].resolve();
  });

  it('removes offscreen work before it starts', async () => {
    const queue = createThumbnailJobQueue(1);
    const gate = deferred();
    let secondStarted = false;
    queue.schedule(() => gate.promise);
    const cancel = queue.schedule(async () => { secondStarted = true; });

    expect(cancel()).toBe(true);
    gate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(secondStarted).toBe(false);
  });
});
