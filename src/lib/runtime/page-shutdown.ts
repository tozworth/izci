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
