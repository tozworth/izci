import type { PageCleanup } from './page-bootstrap';

/** Orders page-domain work after unmount and before persistence disposal. */
export function createPageShutdownCoordinator(shutdown?: PageCleanup) {
  let mountInitialized = false;
  let resolveUnmount!: () => void;
  const unmounted = new Promise<void>((resolve) => { resolveUnmount = resolve; });
  let shutdownPromise: Promise<void> | undefined;
  const shutdownDomain = () => {
    shutdownPromise ??= Promise.resolve().then(async () => { await shutdown?.(); });
    return shutdownPromise;
  };
  return {
    wrapMountCleanup(cleanup: PageCleanup | void): PageCleanup {
      mountInitialized = true;
      return async () => {
        try {
          await cleanup?.();
        } finally {
          resolveUnmount();
        }
        await shutdownDomain();
      };
    },
    async beforePersistence(): Promise<void> {
      if (mountInitialized) await unmounted;
      await shutdownDomain();
    }
  };
}

export async function closePagePersistence(
  disposeOwners: () => unknown | Promise<unknown>,
  disposeDatabases: () => unknown | Promise<unknown>,
  afterPersistence?: PageCleanup
): Promise<void> {
  try {
    await disposeOwners();
  } finally {
    try {
      await disposeDatabases();
    } finally {
      await afterPersistence?.();
    }
  }
}

export interface PageShutdownSequence {
  readonly shutdownDomain: () => unknown | Promise<unknown>;
  readonly flushSettings: () => unknown | Promise<unknown>;
  readonly disposeSettings: () => unknown | Promise<unknown>;
  readonly disposeOwners: () => unknown | Promise<unknown>;
  readonly disposeDatabases: () => unknown | Promise<unknown>;
  readonly afterPersistence?: PageCleanup;
}

/**
 * Runs every teardown boundary in order even when an earlier owner fails. A
 * failed domain shutdown must never strand settings, databases, or a Web Lock.
 */
export async function runPageShutdownSequence(sequence: PageShutdownSequence): Promise<void> {
  const failures: unknown[] = [];
  for (const operation of [
    sequence.shutdownDomain,
    sequence.flushSettings,
    sequence.disposeSettings,
    sequence.disposeOwners,
    sequence.disposeDatabases,
    sequence.afterPersistence
  ]) {
    if (!operation) continue;
    try {
      await operation();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Page shutdown completed with failures.');
  }
}
