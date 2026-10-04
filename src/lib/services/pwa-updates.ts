import { registerSW } from 'virtual:pwa-register';
import { isDesktop, nativeFilesystem } from '$platform';
import { writable } from 'svelte/store';
import { logDebug, logError, logInfo, logWarning } from '$lib/services/logging';
import type { PwaUpdateStatus } from '$lib/types';

export type { PwaUpdateStatus } from '$lib/types';

const LOCALHOST_UPDATE_INTERVAL_MS = 30_000;
const DEFAULT_UPDATE_INTERVAL_MS = 5 * 60_000;
const UPDATE_NOTICE_DURATION_MS = 2_000;
const UPDATE_NOTICE_SESSION_KEY = 'izci.pwa-update-completed';
const LAST_SUCCESSFUL_UPDATE_CHECK_KEY = 'izci.pwa-update-last-successful-check';
const WORKER_STATE_TIMEOUT_MS = 60_000;

let updateInFlight: Promise<void> | null = null;
let updateNoticeTimeout: number | null = null;

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
  updateNoticeTimeout = null;
  if (status === 'checking' || status === 'updating') return;

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
  await runManualUpdateCheck(true);
}

export async function checkServiceWorkerUpdate(): Promise<void> {
  await runManualUpdateCheck(false);
}

function updateRegistration(registration: ServiceWorkerRegistration): Promise<void> {
  // Manual checks must await a background check rather than silently skipping it.
  if (!updateInFlight) {
    updateInFlight = registration.update().then(() => undefined).finally(() => {
      updateInFlight = null;
    });
  }
  return updateInFlight;
}

async function runManualUpdateCheck(applyUpdate: boolean): Promise<void> {
  logInfo('system', 'Manual service-worker update check started');
  setUpdateCheckStatus('checking');
  showUpdateNotice('checking');

  try {
    if (!navigator.onLine) {
      throw new Error('Cannot check for an update while offline.');
    }

    const registration = await navigator.serviceWorker?.getRegistration();
    if (!registration) {
      throw new Error('No service worker registration is available.');
    }

    const controllerBeforeCheck = navigator.serviceWorker.controller;
    let updateWorker = registration.waiting ?? registration.installing;
    const onUpdateFound = () => {
      updateWorker = registration.installing ?? updateWorker;
    };
    registration.addEventListener('updatefound', onUpdateFound);
    try {
      await updateRegistration(registration);
      updateWorker = registration.waiting ?? registration.installing ?? updateWorker;
      if (updateWorker) {
        if (applyUpdate) showUpdateNotice('updating');
        // update() resolves before the new worker finishes precaching the app.
        await waitForWorkerStateChange(updateWorker);
      }
    } finally {
      registration.removeEventListener('updatefound', onUpdateFound);
    }

    const updateAvailable = Boolean(updateWorker || registration.waiting)
      || navigator.serviceWorker.controller !== controllerBeforeCheck;
    const checkedAt = Date.now();
    setUpdateCheckStatus(updateAvailable ? 'available' : 'up-to-date', checkedAt);
    logInfo('system', 'Service-worker update check completed', { updateAvailable });
    if (updateAvailable && applyUpdate) {
      showUpdateNotice('updating');
      await applyRegistrationUpdate(registration, updateWorker);
    } else {
      showUpdateNotice(updateAvailable ? 'available' : 'up-to-date');
    }
  } catch (error) {
    console.warn('Failed to force a service worker update check.', error);
    logError('system', 'Manual service-worker update check failed', error);
    setUpdateCheckStatus('failed');
    showUpdateNotice('failed');
  }
}

function waitForWorkerStateChange(worker: ServiceWorker): Promise<void> {
  if (worker.state === 'redundant') {
    return Promise.reject(new Error('Service worker installation failed.'));
  }
  if (worker.state === 'installed' || worker.state === 'activating' || worker.state === 'activated') {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timeout);
      worker.removeEventListener('statechange', onStateChange);
    };
    const onStateChange = () => {
      if (worker.state === 'redundant') {
        cleanup();
        reject(new Error('Service worker installation failed.'));
      } else if (worker.state === 'installed' || worker.state === 'activating' || worker.state === 'activated') {
        cleanup();
        resolve();
      }
    };
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error('Service worker installation timed out.'));
    }, WORKER_STATE_TIMEOUT_MS);
    worker.addEventListener('statechange', onStateChange);
  });
}

export async function applyAvailableServiceWorkerUpdate(): Promise<void> {
  logInfo('system', 'Applying available service-worker update');
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (!registration) {
      logWarning('system', 'Service-worker update could not be applied because registration is absent');
      throw new Error('No service worker registration is available.');
    }
    showUpdateNotice('updating');
    await applyRegistrationUpdate(registration);
  } catch (error) {
    logError('system', 'Service-worker update could not be applied', error);
    setUpdateCheckStatus('failed');
    showUpdateNotice('failed');
  }
}

async function applyRegistrationUpdate(
  registration: ServiceWorkerRegistration,
  updateWorker: ServiceWorker | null = registration.waiting ?? registration.installing
): Promise<void> {
  if (updateWorker) await waitForWorkerStateChange(updateWorker);

  const worker = registration.waiting ?? updateWorker;
  if (worker && navigator.serviceWorker.controller !== worker) {
    const controllerChanged = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        window.clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
      };
      const onControllerChange = () => {
        if (navigator.serviceWorker.controller !== worker) return;
        cleanup();
        resolve();
      };
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error('Service worker activation timed out.'));
      }, WORKER_STATE_TIMEOUT_MS);
      navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
      try {
        worker.postMessage({ type: 'SKIP_WAITING' });
      } catch (error) {
        cleanup();
        reject(error);
      }
    });

    await controllerChanged;
  }

  sessionStorage.setItem(UPDATE_NOTICE_SESSION_KEY, 'true');
  window.location.reload();
}

export function registerAppServiceWorker(): void {
  if (isDesktop || nativeFilesystem) return;
  logDebug('system', 'Service-worker registration started');
  let registration: ServiceWorkerRegistration | undefined;

  showCompletedUpdateNotice();

  const controlledByExistingServiceWorker = navigator.serviceWorker.controller !== null;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (controlledByExistingServiceWorker) {
      sessionStorage.setItem(UPDATE_NOTICE_SESSION_KEY, 'true');
    }
  });

  const checkForServiceWorkerUpdate = async () => {
    if (!registration || !navigator.onLine || document.visibilityState !== 'visible') {
      return;
    }

    try {
      await updateRegistration(registration);
    } catch (error) {
      console.debug('Failed to check for a service worker update.', error);
      logDebug('system', 'Background service-worker update check failed', error);
    }
  };

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, serviceWorkerRegistration) {
      if (!serviceWorkerRegistration) {
        return;
      }

      registration = serviceWorkerRegistration;
      logInfo('system', 'Service worker registered', { scope: registration.scope });

      const updateIntervalMs =
        window.location.hostname === 'localhost'
          ? LOCALHOST_UPDATE_INTERVAL_MS
          : DEFAULT_UPDATE_INTERVAL_MS;

      window.setInterval(() => {
        void checkForServiceWorkerUpdate();
      }, updateIntervalMs);

      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          void checkForServiceWorkerUpdate();
        }
      });

      window.addEventListener('focus', () => {
        void checkForServiceWorkerUpdate();
      });

      window.addEventListener('online', () => {
        void checkForServiceWorkerUpdate();
      });

      void checkForServiceWorkerUpdate();
    }
  });
}
