import { describe, expect, it, vi } from 'vitest';
import { initializeWindowOrphanPolicy, type OrphanWindowTarget } from './window-orphan';

class WindowDouble extends EventTarget implements OrphanWindowTarget {
  opener: Window | null;
  close = vi.fn();
  clearInterval = vi.fn();
  intervalHandler: (() => void) | null = null;

  constructor(opener: Window | null) {
    super();
    this.opener = opener;
  }

  setInterval(handler: () => void): number {
    this.intervalHandler = handler;
    return 42;
  }
}

describe('window orphan policy', () => {
  it('closes an opener-owned page and releases every watcher once', () => {
    const opener = { closed: false } as Window;
    const target = new WindowDouble(opener);
    const visibility = new EventTarget();
    const cleanup = initializeWindowOrphanPolicy('close-with-opener', target, visibility);

    target.dispatchEvent(new Event('focus'));
    expect(target.close).not.toHaveBeenCalled();
    (opener as { closed: boolean }).closed = true;
    visibility.dispatchEvent(new Event('visibilitychange'));
    target.intervalHandler?.();
    expect(target.close).toHaveBeenCalledTimes(2);

    cleanup();
    cleanup();
    expect(target.clearInterval).toHaveBeenCalledOnce();
    target.dispatchEvent(new Event('focus'));
    expect(target.close).toHaveBeenCalledTimes(2);
  });

  it.each(['parent-owned', 'survive-opener'] as const)('does not watch %s windows', (policy) => {
    const target = new WindowDouble({ closed: true } as Window);
    const cleanup = initializeWindowOrphanPolicy(policy, target, new EventTarget());
    target.dispatchEvent(new Event('focus'));
    target.intervalHandler?.();
    cleanup();
    expect(target.close).not.toHaveBeenCalled();
    expect(target.clearInterval).not.toHaveBeenCalled();
  });

  it('does not close a standalone close-with-opener page', () => {
    const target = new WindowDouble(null);
    initializeWindowOrphanPolicy('close-with-opener', target, new EventTarget());
    target.dispatchEvent(new Event('focus'));
    expect(target.intervalHandler).toBeNull();
    expect(target.close).not.toHaveBeenCalled();
  });
});
