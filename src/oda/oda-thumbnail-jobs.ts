export type CancelOdaThumbnailJob = () => boolean;

interface QueuedJob {
  started: boolean;
  run: () => Promise<void>;
}

/**
 * Bounds file reads and image/video decoding shared by Oda's scrolling
 * browsers. Cancelling a job that has not started removes it immediately.
 */
export function createOdaThumbnailJobQueue(maxConcurrent = 2) {
  const concurrency = Math.max(1, Math.floor(maxConcurrent));
  const pending: QueuedJob[] = [];
  let active = 0;

  function pump(): void {
    while (active < concurrency && pending.length > 0) {
      const job = pending.shift()!;
      job.started = true;
      active += 1;
      void job.run()
        .catch(() => {})
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  }

  function schedule(run: () => Promise<void>): CancelOdaThumbnailJob {
    const job: QueuedJob = { started: false, run };
    pending.push(job);
    queueMicrotask(pump);

    return () => {
      if (job.started) return false;
      const index = pending.indexOf(job);
      if (index < 0) return false;
      pending.splice(index, 1);
      return true;
    };
  }

  return { schedule };
}

const odaThumbnailJobs = createOdaThumbnailJobQueue(2);

export const scheduleOdaThumbnailJob = odaThumbnailJobs.schedule;
