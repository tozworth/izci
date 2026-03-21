import { registerSW } from 'virtual:pwa-register';

const LOCALHOST_UPDATE_INTERVAL_MS = 30_000;
const DEFAULT_UPDATE_INTERVAL_MS = 5 * 60_000;

export function registerAppServiceWorker(): void {
  let registration: ServiceWorkerRegistration | undefined;
  let updateInFlight = false;

  const checkForServiceWorkerUpdate = async () => {
    if (!registration || updateInFlight) {
      return;
    }

    if (!navigator.onLine || document.visibilityState !== 'visible') {
      return;
    }

    updateInFlight = true;

    try {
      await registration.update();
    } catch (error) {
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
