import { registerSW } from 'virtual:pwa-register';
import { writable } from 'svelte/store';
import { logDebug, logError, logInfo, logWarning } from '$lib/logging/api';

const LOCALHOST_UPDATE_INTERVAL_MS = 30_000;
const DEFAULT_UPDATE_INTERVAL_MS = 5 * 60_000;
const UPDATE_NOTICE_DURATION_MS = 2_000;
const UPDATE_NOTICE_SESSION_KEY = 'izci.pwa-update-completed';
const LAST_SUCCESSFUL_UPDATE_CHECK_KEY = 'izci.pwa-update-last-successful-check';

let checkForServiceWorkerUpdate: ((force?: boolean) => Promise<void>) | null = null;
let updateNoticeTimeout: number | null = null;
let serviceWorkerCleanup: (() => void) | null = null;

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
  logInfo('system', 'Manual service-worker update check started');
  setUpdateCheckStatus('checking');

  try {
    if (!navigator.onLine) {
      throw new Error('Cannot check for an update while offline.');
    }

    const registration = await navigator.serviceWorker?.getRegistration();
    const alreadyWaiting = Boolean(registration?.waiting);
    let updateFound = false;
    const handleUpdateFound = () => {
      updateFound = true;
    };
    registration?.addEventListener('updatefound', handleUpdateFound);
    try {
      if (!checkForServiceWorkerUpdate) {
        if (!registration) {
          throw new Error('No service worker registration is available.');
        }

        await registration.update();
      } else {
        await checkForServiceWorkerUpdate(true);
      }
    } finally {
      registration?.removeEventListener('updatefound', handleUpdateFound);
    }

    const checkedAt = Date.now();
    const updateAvailable = alreadyWaiting || updateFound || Boolean(registration?.waiting);
    setUpdateCheckStatus(updateAvailable ? 'available' : 'up-to-date', checkedAt);
    logInfo('system', 'Service-worker update check completed', { updateAvailable });
    showUpdateNotice('up-to-date');
  } catch (error) {
    console.warn('Failed to force a service worker update check.', error);
    logError('system', 'Manual service-worker update check failed', error);
    setUpdateCheckStatus('failed');
    showUpdateNotice('failed');
  }
}

function waitForWorkerStateChange(worker: ServiceWorker): Promise<void> {
  if (worker.state === 'installed' || worker.state === 'activated' || worker.state === 'redundant') {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const handleStateChange = () => {
      if (worker.state === 'installed' || worker.state === 'activated' || worker.state === 'redundant') {
        worker.removeEventListener('statechange', handleStateChange);
        resolve();
      }
    };
    worker.addEventListener('statechange', handleStateChange);
  });
}

export async function applyAvailableServiceWorkerUpdate(): Promise<void> {
  logInfo('system', 'Applying available service-worker update');
  const registration = await navigator.serviceWorker?.getRegistration();
  if (!registration) {
    logWarning('system', 'Service-worker update could not be applied because registration is absent');
    setUpdateCheckStatus('failed');
    return;
  }

  if (registration.installing) {
    await waitForWorkerStateChange(registration.installing);
  }

  if (registration.waiting) {
    const controllerChanged = new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        navigator.serviceWorker.removeEventListener('controllerchange', finish);
        resolve();
      };
      const timeout = window.setTimeout(finish, 5_000);
      navigator.serviceWorker.addEventListener('controllerchange', finish);
    });

    registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    await controllerChanged;
  }

  window.location.reload();
}

export function registerAppServiceWorker(): () => void {
  if (serviceWorkerCleanup) return serviceWorkerCleanup;
  logDebug('system', 'Service-worker registration started');
  let registration: ServiceWorkerRegistration | undefined;
  let updateInFlight = false;
  let updateInterval: number | null = null;
  let destroyed = false;
  let handleVisibilityChange: (() => void) | null = null;
  let handleFocus: (() => void) | null = null;
  let handleOnline: (() => void) | null = null;

  const clearRegistrationTriggers = () => {
    if (updateInterval !== null) window.clearInterval(updateInterval);
    updateInterval = null;
    if (handleVisibilityChange) document.removeEventListener('visibilitychange', handleVisibilityChange);
    if (handleFocus) window.removeEventListener('focus', handleFocus);
    if (handleOnline) window.removeEventListener('online', handleOnline);
    handleVisibilityChange = null;
    handleFocus = null;
    handleOnline = null;
  };

  showCompletedUpdateNotice();

  const controlledByExistingServiceWorker = navigator.serviceWorker.controller !== null;
  const handleControllerChange = () => {
    if (controlledByExistingServiceWorker) {
      sessionStorage.setItem(UPDATE_NOTICE_SESSION_KEY, 'true');
    }
  };
  navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

  checkForServiceWorkerUpdate = async (force = false) => {
    if (destroyed || !registration || updateInFlight) {
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
      logWarning('system', 'Background service-worker update check failed', error);
    } finally {
      updateInFlight = false;
    }
  };

  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, serviceWorkerRegistration) {
      if (destroyed || !serviceWorkerRegistration) {
        return;
      }

      registration = serviceWorkerRegistration;
      logInfo('system', 'Service worker registered', { scope: registration.scope });
      clearRegistrationTriggers();

      const updateIntervalMs =
        window.location.hostname === 'localhost'
          ? LOCALHOST_UPDATE_INTERVAL_MS
          : DEFAULT_UPDATE_INTERVAL_MS;

      handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          void checkForServiceWorkerUpdate?.();
        }
      };
      handleFocus = () => {
        void checkForServiceWorkerUpdate?.();
      };
      handleOnline = () => {
        void checkForServiceWorkerUpdate?.();
      };
      updateInterval = window.setInterval(handleFocus, updateIntervalMs);
      document.addEventListener('visibilitychange', handleVisibilityChange);
      window.addEventListener('focus', handleFocus);
      window.addEventListener('online', handleOnline);

      void checkForServiceWorkerUpdate?.();
    }
  });

  let active = true;
  const cleanup = () => {
    if (!active) return;
    active = false;
    destroyed = true;
    navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    clearRegistrationTriggers();
    checkForServiceWorkerUpdate = null;
    if (updateNoticeTimeout !== null) window.clearTimeout(updateNoticeTimeout);
    updateNoticeTimeout = null;
    pwaUpdateStatus.set('idle');
    serviceWorkerCleanup = null;
  };
  serviceWorkerCleanup = cleanup;
  return cleanup;
}
