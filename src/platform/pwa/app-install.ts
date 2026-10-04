import { writable, type Readable } from 'svelte/store';
import type { BeforeInstallPromptEvent, AppInstallState, AppInstallEnvironment } from '../app-install-types';

const INSTALL_HINT_ACKNOWLEDGED_KEY = 'izci-install-hint-acknowledged';

function isInstalledDisplayMode(targetWindow: Window): boolean {
  return ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].some((mode) =>
    targetWindow.matchMedia(`(display-mode: ${mode})`).matches
  );
}

export function createAppInstallService(
  environment: AppInstallEnvironment = {}
): Readable<AppInstallState> & {
  markEngaged(): void;
  acknowledgeHint(): void;
  prompt(): Promise<'accepted' | 'dismissed' | 'unavailable'>;
  destroy(): void;
} {
  const targetWindow = environment.window ?? (typeof window !== 'undefined' ? window : undefined);
  const isInstalled = environment.isInstalled ?? (() => Boolean(targetWindow && isInstalledDisplayMode(targetWindow)));
  let deferredPrompt: BeforeInstallPromptEvent | null = null;
  let engaged = false;
  let hintAcknowledged = targetWindow?.localStorage?.getItem(INSTALL_HINT_ACKNOWLEDGED_KEY) === 'true';
  const store = writable<AppInstallState>({ available: false, showHint: false });

  function publish(): void {
    const available = Boolean(deferredPrompt) && !isInstalled();
    store.set({ available, showHint: available && engaged && !hintAcknowledged });
  }

  function handleBeforeInstallPrompt(event: Event): void {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    publish();
  }

  function handleAppInstalled(): void {
    deferredPrompt = null;
    publish();
  }

  targetWindow?.addEventListener?.('beforeinstallprompt', handleBeforeInstallPrompt);
  targetWindow?.addEventListener?.('appinstalled', handleAppInstalled);

  return {
    subscribe: store.subscribe,
    markEngaged() {
      engaged = true;
      publish();
    },
    acknowledgeHint() {
      if (hintAcknowledged) return;
      hintAcknowledged = true;
      targetWindow?.localStorage?.setItem(INSTALL_HINT_ACKNOWLEDGED_KEY, 'true');
      publish();
    },
    async prompt() {
      const promptEvent = deferredPrompt;
      if (!promptEvent || isInstalled()) return 'unavailable';
      deferredPrompt = null;
      publish();
      await promptEvent.prompt();
      return (await promptEvent.userChoice).outcome;
    },
    destroy() {
      targetWindow?.removeEventListener?.('beforeinstallprompt', handleBeforeInstallPrompt);
      targetWindow?.removeEventListener?.('appinstalled', handleAppInstalled);
    }
  };
}

export const appInstallService = createAppInstallService();
