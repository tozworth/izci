import { describe, expect, it, vi } from 'vitest';
import { createPageShutdownCoordinator } from './page-shutdown';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

describe('page shutdown coordination', () => {
  it('waits for unmount and domain cleanup before persistence may close', async () => {
    const unmountGate = deferred();
    const domainGate = deferred();
    const order: string[] = [];
    const coordinator = createPageShutdownCoordinator(async () => {
      order.push('domain-start');
      await domainGate.promise;
      order.push('domain-end');
    });
    const cleanup = coordinator.wrapMountCleanup(async () => {
      order.push('unmount-start');
      await unmountGate.promise;
      order.push('unmount-end');
    });

    const unmounting = cleanup();
    const persistence = coordinator.beforePersistence().then(() => order.push('persistence'));
    await Promise.resolve();
    expect(order).toEqual(['unmount-start']);
    unmountGate.resolve();
    await vi.waitFor(() => expect(order).toContain('domain-start'));
    expect(order).toEqual(['unmount-start', 'unmount-end', 'domain-start']);
    domainGate.resolve();
    await Promise.all([unmounting, persistence]);
    expect(order).toEqual(['unmount-start', 'unmount-end', 'domain-start', 'domain-end', 'persistence']);
  });

  it('runs domain cleanup once when both lifecycle releases request it', async () => {
    const shutdown = vi.fn().mockResolvedValue(undefined);
    const coordinator = createPageShutdownCoordinator(shutdown);
    const cleanup = coordinator.wrapMountCleanup(() => undefined);
    await Promise.all([cleanup(), coordinator.beforePersistence()]);
    expect(shutdown).toHaveBeenCalledOnce();
  });
});
