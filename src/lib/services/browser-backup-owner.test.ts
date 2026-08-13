import { describe, expect, it } from 'vitest';
import {
  BACKUP_OWNERSHIP_LOCK_NAME
} from './backup-coordination';
import { tryAcquireBrowserBackupOwnerLease } from './browser-backup-owner';

describe('browser backup ownership leases', () => {
  it('keeps standalone non-blocking while main waits for the current realm to release', async () => {
    let held = true;
    let resumeMain!: () => void;
    const requestedOptions: LockOptions[] = [];
    const lock = { name: BACKUP_OWNERSHIP_LOCK_NAME, mode: 'exclusive' } as Lock;
    const manager = {
      request<T>(
        _name: string,
        options: LockOptions,
        callback: (lock: Lock | null) => T | PromiseLike<T>
      ): Promise<T> {
        requestedOptions.push(options);
        if (options.ifAvailable && held) return Promise.resolve(callback(null));
        return new Promise<T>((resolve, reject) => {
          const acquire = () => {
            held = true;
            Promise.resolve(callback(lock)).then(resolve, reject).finally(() => {
              held = false;
            });
          };
          if (held) resumeMain = acquire;
          else acquire();
        });
      }
    } as unknown as LockManager;
    const navigatorTarget = { locks: manager } as unknown as Navigator;

    const mainLeasePromise = tryAcquireBrowserBackupOwnerLease(navigatorTarget, {
      allowWithoutLocks: true,
      wait: true
    });
    let mainAcquired = false;
    void mainLeasePromise.then(() => (mainAcquired = true));
    await Promise.resolve();
    expect(mainAcquired).toBe(false);

    const standaloneLease = await tryAcquireBrowserBackupOwnerLease(navigatorTarget, {
      allowWithoutLocks: false
    });
    expect(standaloneLease).toBeNull();
    expect(requestedOptions).toEqual([
      { mode: 'exclusive' },
      { mode: 'exclusive', ifAvailable: true }
    ]);

    held = false;
    resumeMain();
    const mainLease = await mainLeasePromise;
    expect(mainLease).not.toBeNull();
    await mainLease?.release();
    expect(held).toBe(false);
  });
});
