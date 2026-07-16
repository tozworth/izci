import { registerSW } from 'virtual:pwa-register';
import { writable } from 'svelte/store';

const LOCALHOST_UPDATE_INTERVAL_MS = 30_000;
const DEFAULT_UPDATE_INTERVAL_MS = 5 * 60_000;
const UPDATE_NOTICE_DURATION_MS = 2_000;
const UPDATE_NOTICE_SESSION_KEY = 'izci.pwa-update-completed';

let checkForServiceWorkerUpdate: ((force?: boolean) => Promise<void>) | null = null;
let updateNoticeTimeout: number | null = null;

export type PwaUpdateStatus = 'idle' | 'updated' | 'up-to-date' | 'failed';

export const pwaUpdateStatus = writable<PwaUpdateStatus>('idle');

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
  try {
    if (!navigator.onLine) {
      throw new Error('Cannot check for an update while offline.');
    }

    if (!checkForServiceWorkerUpdate) {
      const registration = await navigator.serviceWorker?.getRegistration();
      if (!registration) {
        throw new Error('No service worker registration is available.');
      }

      await registration.update();
    } else {
      await checkForServiceWorkerUpdate(true);
    }

    showUpdateNotice('up-to-date');
  } catch (error) {
    console.warn('Failed to force a service worker update check.', error);
    showUpdateNotice('failed');
  }
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
