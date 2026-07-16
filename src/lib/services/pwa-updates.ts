import { registerSW } from 'virtual:pwa-register';
import { writable } from 'svelte/store';

const LOCALHOST_UPDATE_INTERVAL_MS = 30_000;
const DEFAULT_UPDATE_INTERVAL_MS = 5 * 60_000;
const UPDATE_NOTICE_DURATION_MS = 2_000;
const UPDATE_NOTICE_SESSION_KEY = 'izci.pwa-update-completed';
const LAST_SUCCESSFUL_UPDATE_CHECK_KEY = 'izci.pwa-update-last-successful-check';

let checkForServiceWorkerUpdate: ((force?: boolean) => Promise<void>) | null = null;
let updateNoticeTimeout: number | null = null;

export type PwaUpdateStatus = 'idle' | 'updated' | 'up-to-date' | 'failed';
export type PwaUpdateCheckStatus = 'idle' | 'checking' | 'available' | 'up-to-date' | 'failed';

export interface PwaUpdateCheckState {
  status: PwaUpdateCheckStatus;
  lastSuccessfulCheck: number | null;
}

function readLastSuccessfulUpdateCheck(): number | null {
  const storedValue = Number.parseInt(
    localStorage.getItem(LAST_SUCCESSFUL_UPDATE_CHECK_KEY) ?? '',
    10
  );

  return Number.isFinite(storedValue) ? storedValue : null;
}

export const pwaUpdateStatus = writable<PwaUpdateStatus>('idle');
export const pwaUpdateCheckState = writable<PwaUpdateCheckState>({
  status: 'idle',
  lastSuccessfulCheck: readLastSuccessfulUpdateCheck()
});

function setUpdateCheckStatus(status: PwaUpdateCheckStatus, checkedAt?: number): void {
  if (checkedAt !== undefined) {
    localStorage.setItem(LAST_SUCCESSFUL_UPDATE_CHECK_KEY, String(checkedAt));
  }

  pwaUpdateCheckState.update((state) => ({
    status,
    lastSuccessfulCheck: checkedAt ?? state.lastSuccessfulCheck
  }));
}

function showUpdateNotice(status: Exclude<PwaUpdateStatus, 'idle'>): void {
  if (updateNoticeTimeout !== null) {
    window.clearTimeout(updateNoticeTimeout);
  }

  pwaUpdateStatus.set(status);
  updateNoticeTimeout = window.setTimeout(() => {
    pwaUpdateStatus.set('idle');
    updateNoticeTimeout = null;
  }, UPDATE_NOTICE_DURATION_MS);
}

function showCompletedUpdateNotice(): void {
  if (sessionStorage.getItem(UPDATE_NOTICE_SESSION_KEY) !== 'true') {
    return;
  }

  sessionStorage.removeItem(UPDATE_NOTICE_SESSION_KEY);
  showUpdateNotice('updated');
}

export async function forceServiceWorkerUpdateCheck(): Promise<void> {
  setUpdateCheckStatus('checking');

  try {
    if (!navigator.onLine) {
      throw new Error('Cannot check for an update while offline.');
    }

    const registration = await navigator.serviceWorker?.getRegistration();
    const alreadyWaiting = Boolean(registration?.waiting);
    let updateFound = false;

    registration?.addEventListener('updatefound', () => {
      updateFound = true;
    }, { once: true });

    if (!checkForServiceWorkerUpdate) {
      if (!registration) {
        throw new Error('No service worker registration is available.');
      }

      await registration.update();
    } else {
      await checkForServiceWorkerUpdate(true);
    }

    const checkedAt = Date.now();
    const updateAvailable = alreadyWaiting || updateFound || Boolean(registration?.waiting);
    setUpdateCheckStatus(updateAvailable ? 'available' : 'up-to-date', checkedAt);
    showUpdateNotice('up-to-date');
  } catch (error) {
    console.warn('Failed to force a service worker update check.', error);
    setUpdateCheckStatus('failed');
    showUpdateNotice('failed');
  }
}

function waitForWorkerStateChange(worker: ServiceWorker): Promise<void> {
  if (worker.state === 'installed' || worker.state === 'activated' || worker.state === 'redundant') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' || worker.state === 'activated' || worker.state === 'redundant') {
        resolve();
      }
    });
  });
}

export async function applyAvailableServiceWorkerUpdate(): Promise<void> {
  const registration = await navigator.serviceWorker?.getRegistration();
  if (!registration) {
    setUpdateCheckStatus('failed');
    return;
  }

  if (registration.installing) {
    await waitForWorkerStateChange(registration.installing);
  }

  if (registration.waiting) {
    const controllerChanged = new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 5_000);
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
    });

    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    await controllerChanged;
  }

  window.location.reload();
}

export function registerAppServiceWorker(): void {
  let registration: ServiceWorkerRegistration | undefined;
  let updateInFlight = false;

  showCompletedUpdateNotice();

  const controlledByExistingServiceWorker = navigator.serviceWorker.controller !== null;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlledByExistingServiceWorker) {
      sessionStorage.setItem(UPDATE_NOTICE_SESSION_KEY, 'true');
    }
  });

  checkForServiceWorkerUpdate = async (force = false) => {
    if (!registration || updateInFlight) {
      return;
    }

    if (!force && (!navigator.onLine || document.visibilityState !== 'visible')) {
      return;
    }

    updateInFlight = true;

    try {
      await registration.update();
    } catch (error) {
      if (force) {
        throw error;
      }

      console.warn('Failed to check for a service worker update.', error);
    } finally {
      updateInFlight = false;
    }
  };

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, serviceWorkerRegistration) {
      if (!serviceWorkerRegistration) {
        return;
      }

      registration = serviceWorkerRegistration;

      const updateIntervalMs =
        window.location.hostname === 'localhost'
          ? LOCALHOST_UPDATE_INTERVAL_MS
          : DEFAULT_UPDATE_INTERVAL_MS;

      window.setInterval(() => {
        void checkForServiceWorkerUpdate?.();
      }, updateIntervalMs);

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          void checkForServiceWorkerUpdate?.();
        }
      });

      window.addEventListener('focus', () => {
        void checkForServiceWorkerUpdate?.();
      });

      window.addEventListener('online', () => {
        void checkForServiceWorkerUpdate?.();
      });

      void checkForServiceWorkerUpdate?.();
    }
  });
}
