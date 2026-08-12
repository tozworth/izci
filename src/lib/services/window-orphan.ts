export type WindowOrphanPolicy = 'close-with-opener' | 'parent-owned' | 'survive-opener';

export interface OrphanWindowTarget extends EventTarget {
  readonly opener: Window | null;
  readonly closed?: boolean;
  close(): void;
  setInterval(handler: () => void, timeout: number): number;
  clearInterval(handle: number): void;
}

export function initializeWindowOrphanPolicy(
  policy: WindowOrphanPolicy,
  target: OrphanWindowTarget = window,
  visibilityTarget: EventTarget = document
): () => void {
  if (policy !== 'close-with-opener') return () => undefined;

  const wasOpenedByHost = target.opener !== null;
  if (!wasOpenedByHost) return () => undefined;

  let active = true;
  const closeIfOrphaned = () => {
    if (active && (!target.opener || target.opener.closed)) target.close();
  };
  target.addEventListener('focus', closeIfOrphaned);
  visibilityTarget.addEventListener('visibilitychange', closeIfOrphaned);
  const interval = target.setInterval(closeIfOrphaned, 1_000);

  return () => {
    if (!active) return;
    active = false;
    target.clearInterval(interval);
    target.removeEventListener('focus', closeIfOrphaned);
    visibilityTarget.removeEventListener('visibilitychange', closeIfOrphaned);
  };
}
