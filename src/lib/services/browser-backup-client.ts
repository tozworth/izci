import {
  BACKUP_COORDINATION_CHANNEL_NAME,
  createBackupCoordinationClient,
  getRealmBackupOwner,
  type BackupCoordinationChannel
} from '$lib/services/backup-coordination';
import {
  loadBrowserBackupOperations,
  tryAcquireBrowserBackupOwnerLease
} from '$lib/services/browser-backup-owner';

function createBrowserChannel(): BackupCoordinationChannel | null {
  if (typeof BroadcastChannel !== 'function') return null;
  return new BroadcastChannel(BACKUP_COORDINATION_CHANNEL_NAME);
}

export const backupCoordinator = createBackupCoordinationClient({
  clientId: crypto.randomUUID(),
  createId: () => crypto.randomUUID(),
  scheduler: {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle as number)
  },
  createChannel: createBrowserChannel,
  createStandaloneOperations: loadBrowserBackupOperations,
  acquireStandaloneLease: () => tryAcquireBrowserBackupOwnerLease(navigator, {
    // Refuse an unsafe second catalog owner when the browser cannot provide
    // cross-realm exclusion.
    allowWithoutLocks: false
  }),
  getRealmOwner: getRealmBackupOwner
});

// Pending restore presentation should hydrate even before the user presses a
// backup action. A later owner announcement repairs a startup-time busy result.
void backupCoordinator.ready().catch(() => undefined);
