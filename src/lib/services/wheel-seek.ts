interface WheelSeekControllerOptions {
  getCurrentTime: () => number;
  getDuration: () => number;
  getContextKey: () => string | null;
  onPreview: (seconds: number | null) => void;
  onCommit: (seconds: number) => void;
  stepSeconds?: number;
  settleDelayMs?: number;
}

const DEFAULT_STEP_SECONDS = 5;
const DEFAULT_SETTLE_DELAY_MS = 80;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function createWheelSeekController({
  getCurrentTime,
  getDuration,
  getContextKey,
  onPreview,
  onCommit,
  stepSeconds = DEFAULT_STEP_SECONDS,
  settleDelayMs = DEFAULT_SETTLE_DELAY_MS
}: WheelSeekControllerOptions) {
  let target: number | null = null;
  let contextKey: string | null = null;
  let commitTimer: ReturnType<typeof setTimeout> | null = null;

  function clearCommitTimer(): void {
    if (commitTimer === null) return;
    clearTimeout(commitTimer);
    commitTimer = null;
  }

  function cancel(): void {
    clearCommitTimer();
    target = null;
    contextKey = null;
    onPreview(null);
  }

  function commit(): void {
    clearCommitTimer();

    if (target === null || contextKey !== getContextKey()) {
      cancel();
      return;
    }

    const duration = getDuration();
    const nextTarget = Number.isFinite(duration) && duration > 0
      ? clamp(target, 0, duration)
      : null;

    target = null;
    contextKey = null;
    onPreview(null);

    if (nextTarget !== null) {
      onCommit(nextTarget);
    }
  }

  function step(deltaY: number): boolean {
    const duration = getDuration();
    const nextContextKey = getContextKey();

    if (
      deltaY === 0 ||
      nextContextKey === null ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      return false;
    }

    if (target === null || contextKey !== nextContextKey) {
      target = clamp(getCurrentTime(), 0, duration);
      contextKey = nextContextKey;
    }

    target = clamp(
      target + (deltaY < 0 ? stepSeconds : -stepSeconds),
      0,
      duration
    );
    onPreview(target);

    clearCommitTimer();
    commitTimer = setTimeout(commit, settleDelayMs);
    return true;
  }

  return {
    step,
    cancel,
    commit
  };
}
