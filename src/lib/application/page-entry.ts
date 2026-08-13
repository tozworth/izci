import { initializeLocalization } from '$lib/i18n';
import { initializeLogging } from '$lib/logging/initialize';
import { bootstrapPage, type PageBootstrapHandle, type PageCleanup } from '$lib/runtime/page-bootstrap';
import { createBrowserRuntime } from '$lib/runtime/adapters/browser-runtime';
import { disposeSettingsStores, flushSettingsStores } from '$lib/settings/store';
import {
  disposeBrowserDatabases,
  disposeBrowserPersistenceOwners
} from '$lib/persistence/browser-indexed-db';
import { initializePopupWindowSizePersistence } from '$lib/services/popup-window-state';
import type { PopupWindowId } from '$lib/services/popup-windows';
import { registerAppServiceWorker } from '$lib/services/pwa-updates';
import {
  initializeScrollbarVisibility,
  type ScrollbarVisibilityOptions
} from '$lib/services/scrollbar-visibility';
import { initializeTheme } from '$lib/services/theme';
import {
  initializeWindowOrphanPolicy,
  type WindowOrphanPolicy
} from '$lib/services/window-orphan';
import { initializeMobileDocument } from '../../mobile/mobile-device';

export interface ApplicationPageEntryConfig {
  readonly pageId: string;
  readonly production: boolean;
  readonly mount: () => PageCleanup;
  readonly ready: () => void | Promise<void>;
  readonly readyMarker: string;
  readonly mobileDocument: boolean;
  readonly scrollbar?: ScrollbarVisibilityOptions;
  readonly popupWindow?: PopupWindowId;
  readonly orphanPolicy: WindowOrphanPolicy;
}

function lifecycleTarget(): Parameters<typeof bootstrapPage>[0]['lifecycle'] {
  return {
    addEventListener(_type, listener) {
      window.addEventListener('pagehide', listener as (event: PageTransitionEvent) => void);
    },
    removeEventListener(_type, listener) {
      window.removeEventListener('pagehide', listener as (event: PageTransitionEvent) => void);
    }
  };
}

function initializeMobilePageDocument(): PageCleanup {
  const root = document.documentElement;
  const previous = root.getAttribute('data-izci-mobile');
  initializeMobileDocument(navigator, root);
  return () => {
    if (previous === null) delete root.dataset.izciMobile;
    else root.setAttribute('data-izci-mobile', previous);
  };
}

function installReadyMarker(marker: string): PageCleanup {
  const root = document.documentElement;
  const previous = root.getAttribute('data-izci-ready');
  root.dataset.izciReady = marker;
  return () => {
    if (root.dataset.izciReady !== marker) return;
    if (previous === null) delete root.dataset.izciReady;
    else root.dataset.izciReady = previous;
  };
}

export function startApplicationPage(config: ApplicationPageEntryConfig): PageBootstrapHandle {
  const runtime = createBrowserRuntime(config.pageId);
  return bootstrapPage({
    pageId: config.pageId,
    runtime,
    lifecycle: lifecycleTarget(),
    production: config.production,
    logger: () => {
      const logging = initializeLogging({ runtime, context: config.pageId, target: window });
      return async () => { await logging.destroy(); };
    },
    settings: () => async () => {
      flushSettingsStores();
      disposeSettingsStores();
      try {
        await disposeBrowserPersistenceOwners();
      } finally {
        await disposeBrowserDatabases();
      }
    },
    serviceWorker: () => registerAppServiceWorker(),
    theme: () => initializeTheme(),
    ...(config.mobileDocument ? { mobileDocument: () => initializeMobilePageDocument() } : {}),
    scrollbar: () => initializeScrollbarVisibility(config.scrollbar),
    localization: () => initializeLocalization(),
    popupOrphan: () => {
      const cleanups: PageCleanup[] = [];
      if (config.popupWindow) cleanups.push(initializePopupWindowSizePersistence(config.popupWindow));
      cleanups.push(initializeWindowOrphanPolicy(config.orphanPolicy, window, document));
      return async () => {
        for (const cleanup of cleanups.reverse()) await cleanup();
      };
    },
    mount: () => config.mount(),
    readiness: async () => { await config.ready(); },
    marker: () => installReadyMarker(config.readyMarker)
  });
}
