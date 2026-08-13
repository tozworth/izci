import { describe, expect, it, vi } from 'vitest';
import {
  closePagePersistence,
  createPageShutdownCoordinator,
  runPageShutdownSequence
} from './page-shutdown';

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

  it('releases page memory only after owner flush and database disposal', async () => {
    const order: string[] = [];
    await closePagePersistence(
      async () => { order.push('owners'); },
      async () => { order.push('databases'); },
      async () => { order.push('memory'); }
    );
    expect(order).toEqual(['owners', 'databases', 'memory']);
  });

  it('still closes persistence and releases page ownership after domain shutdown fails', async () => {
    const order: string[] = [];
    const failure = new Error('domain shutdown failed');

    const result = runPageShutdownSequence({
      shutdownDomain: async () => { order.push('domain'); throw failure; },
      flushSettings: () => { order.push('settings:flush'); },
      disposeSettings: () => { order.push('settings:dispose'); },
      disposeOwners: async () => { order.push('owners'); },
      disposeDatabases: async () => { order.push('databases'); },
      afterPersistence: async () => { order.push('ownership:release'); }
    });

    await expect(result).rejects.toMatchObject({ errors: [failure] });
    expect(order).toEqual([
      'domain',
      'settings:flush',
      'settings:dispose',
      'owners',
      'databases',
      'ownership:release'
    ]);
  });
});
