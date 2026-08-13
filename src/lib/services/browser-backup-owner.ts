import { flushSettingsStores } from '$lib/settings/store';
import { flushBrowserPersistenceOwners } from '$lib/persistence/browser-indexed-db';
import {
  BACKUP_COORDINATION_CHANNEL_NAME,
  BACKUP_OWNERSHIP_LOCK_NAME,
  createSerializedBackupOwner,
  registerRealmBackupOwner,
  serveBackupOwner,
  type BackupCoordinationChannel,
  type BackupOwnerLease,
  type BackupOwnerOperations,
  type SerializedBackupOwner
} from '$lib/services/backup-coordination';

interface BackupOwnerBrowserTarget {
  readonly BroadcastChannel?: typeof BroadcastChannel;
  readonly navigator: Navigator;
  readonly crypto: Crypto;
}

export interface MainBackupOwnerHandle {
  readonly ready: Promise<boolean>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}

function noOpLease(): BackupOwnerLease {
  return { release: () => undefined };
}

export async function tryAcquireBrowserBackupOwnerLease(
  navigatorTarget: Navigator,
  options: { readonly allowWithoutLocks: boolean; readonly wait?: boolean }
): Promise<BackupOwnerLease | null> {
  const manager = navigatorTarget.locks;
  if (!manager) return options.allowWithoutLocks ? noOpLease() : null;

  let releaseHold: (() => void) | null = null;
  let resolveAcquired: (lease: BackupOwnerLease | null) => void = () => undefined;
  const acquired = new Promise<BackupOwnerLease | null>((resolve) => {
    resolveAcquired = resolve;
  });
  let released = false;
  const requestSettled = manager.request(
    BACKUP_OWNERSHIP_LOCK_NAME,
    options.wait
      ? { mode: 'exclusive' }
      : { mode: 'exclusive', ifAvailable: true },
    async (lock) => {
      if (!lock) {
        resolveAcquired(null);
        return;
      }
      const hold = new Promise<void>((resolve) => {
        releaseHold = resolve;
      });
      resolveAcquired({
        async release() {
          if (released) return;
          released = true;
          releaseHold?.();
          await requestSettled;
        }
      });
      await hold;
    }
  );
  void requestSettled.catch(() => resolveAcquired(null));
  return acquired;
}

async function loadBrowserBackupOperations(): Promise<BackupOwnerOperations> {
  const [backups, collections, folders] = await Promise.all([
    import('$lib/services/backups'),
    import('$lib/stores/playlist'),
    import('$lib/services/filesystem-folders')
  ]);
  await Promise.all([
    collections.libraryStore.ready(),
    collections.favoritesStore.ready(),
    folders.filesystemFolders.ready(),
    backups.pendingBackupRestore.ready()
  ]);

  return {
    async flushState() {
      flushSettingsStores();
      await flushBrowserPersistenceOwners();
    },
    createBackup: backups.createBackupArchive,
    restoreBackup: backups.restoreBackupArchive,
    locateFiles: backups.locatePendingFiles,
    locateFolder: backups.locatePendingFolder,
    getPendingRestore: backups.pendingBackupRestore.getSnapshot,
    subscribePendingRestore(listener) {
      return backups.pendingBackupRestore.subscribe(listener);
    },
    async disposeState() {
      await Promise.all([
        collections.playlistStore.shutdown(),
        collections.libraryStore.shutdown(),
        collections.favoritesStore.shutdown(),
        folders.filesystemFolders.dispose(),
        backups.pendingBackupRestore.dispose()
      ]);
    }
  };
}

function createBrowserChannel(
  target: BackupOwnerBrowserTarget
): BackupCoordinationChannel | null {
  if (!target.BroadcastChannel) return null;
  return new target.BroadcastChannel(BACKUP_COORDINATION_CHANNEL_NAME);
}

export function startMainBackupOwner(
  target: BackupOwnerBrowserTarget = window
): MainBackupOwnerHandle {
  let lease: BackupOwnerLease | null = null;
  let owner: SerializedBackupOwner | null = null;
  let unregisterRealmOwner: (() => void) | null = null;
  let stopServer: (() => Promise<void>) | null = null;
  let stopPromise: Promise<void> | null = null;
  let disposeRequested = false;

  const ready = (async (): Promise<boolean> => {
    lease = await tryAcquireBrowserBackupOwnerLease(target.navigator, {
      // A main realm remains authoritative on older engines. Standalone
      // Options never takes this unlocked fallback.
      allowWithoutLocks: true,
      // If a standalone Options realm owns the catalog, main must wait for it
      // to finish and release before collection modules are evaluated.
      wait: true
    });
    if (!lease || disposeRequested) {
      await lease?.release();
      lease = null;
      return false;
    }

    const operations = await loadBrowserBackupOperations();
    if (disposeRequested) {
      await lease.release();
      lease = null;
      return false;
    }
    owner = createSerializedBackupOwner(operations);
    unregisterRealmOwner = registerRealmBackupOwner(owner);
    const channel = createBrowserChannel(target);
    if (channel) {
      stopServer = serveBackupOwner({
        ownerId: `main:${target.crypto.randomUUID()}`,
        channel,
        owner
      });
    }
    return true;
  })();

  return {
    ready,
    stop() {
      stopPromise ??= (async () => {
        await ready.catch(() => false);
        unregisterRealmOwner?.();
        unregisterRealmOwner = null;
        await stopServer?.();
        stopServer = null;
        await owner?.flush();
        owner = null;
      })();
      return stopPromise;
    },
    async dispose() {
      if (disposeRequested) return;
      disposeRequested = true;
      await this.stop();
      await lease?.release();
      lease = null;
    }
  };
}

export { loadBrowserBackupOperations };
