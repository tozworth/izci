import { popupWindows, type PopupWindowDefinition, type PopupWindowId } from '$lib/services/popup-windows';
import { buildOptionsWindowPath, type OptionsViewName } from '../../options/views';

function isOpenWindow(windowRef: Window | null | undefined): windowRef is Window {
  return windowRef !== null && windowRef !== undefined && !windowRef.closed;
}

function getNumericFeature(features: PopupWindowDefinition['features'], key: string): number | null {
  const value = features[key];
  return typeof value === 'number' && isFinite(value) ? value : null;
}

function getCenteredPopupPosition(definition: PopupWindowDefinition): { left: number; top: number } | null {
  const popupWidth = getNumericFeature(definition.features, 'width');
  const popupHeight = getNumericFeature(definition.features, 'height');

  if (popupWidth === null || popupHeight === null) {
    return null;
  }

  const screen = window.screen as Screen & { availLeft?: number; availTop?: number };
  const screenLeft = typeof window.screenX === 'number' ? window.screenX : window.screenLeft;
  const screenTop = typeof window.screenY === 'number' ? window.screenY : window.screenTop;
  const viewportWidth = typeof window.outerWidth === 'number' && window.outerWidth > 0 ? window.outerWidth : window.innerWidth;
  const viewportHeight = typeof window.outerHeight === 'number' && window.outerHeight > 0 ? window.outerHeight : window.innerHeight;
  const fallbackLeft = screen.availLeft ?? 0;
  const fallbackTop = screen.availTop ?? 0;
  const fallbackWidth = screen.availWidth || screen.width;
  const fallbackHeight = screen.availHeight || screen.height;

  const baseLeft = typeof screenLeft === 'number' && isFinite(screenLeft) ? screenLeft : fallbackLeft;
  const baseTop = typeof screenTop === 'number' && isFinite(screenTop) ? screenTop : fallbackTop;
  const anchorWidth = viewportWidth > 0 ? viewportWidth : fallbackWidth;
  const anchorHeight = viewportHeight > 0 ? viewportHeight : fallbackHeight;
  const maxLeft = fallbackLeft + Math.max(fallbackWidth - popupWidth, 0);
  const maxTop = fallbackTop + Math.max(fallbackHeight - popupHeight, 0);
  const left = Math.min(Math.max(Math.round(baseLeft + (anchorWidth - popupWidth) / 2), fallbackLeft), maxLeft);
  const top = Math.min(Math.max(Math.round(baseTop + (anchorHeight - popupHeight) / 2), fallbackTop), maxTop);

  return { left, top };
}

function getPopupFeatures(definition: PopupWindowDefinition): PopupWindowDefinition['features'] {
  const position = getCenteredPopupPosition(definition);

  if (!position) {
    return definition.features;
  }

  return {
    ...definition.features,
    left: position.left,
    top: position.top
  };
}

function buildWindowFeatures(features: PopupWindowDefinition['features']): string {
  return Object.entries(features)
    .map(([key, value]) => {
      if (typeof value === 'boolean') {
        return `${key}=${value ? 'yes' : 'no'}`;
      }

      return `${key}=${String(value)}`;
    })
    .join(',');
}

const popupRefs = new Map<PopupWindowId, Window | null>();
let hasMainWindowLifecycleListeners = false;

function getPopupWindowIds(): PopupWindowId[] {
  return Object.keys(popupWindows) as PopupWindowId[];
}

function closePopupWindow(id: PopupWindowId): void {
  const windowRef = popupRefs.get(id);

  if (isOpenWindow(windowRef)) {
    windowRef.close();
  }

  popupRefs.set(id, null);
}

function closeAllPopupWindows(): void {
  for (const id of getPopupWindowIds()) {
    closePopupWindow(id);
  }
}

function attachMainWindowLifecycleListeners(): void {
  if (hasMainWindowLifecycleListeners) {
    return;
  }

  hasMainWindowLifecycleListeners = true;
  window.addEventListener('pagehide', closeAllPopupWindows);
  window.addEventListener('beforeunload', closeAllPopupWindows);
}

function openPopupWindow(id: PopupWindowId, pathOverride?: string): Window | null {
  const existingWindow = popupRefs.get(id);
  const definition = popupWindows[id];
  const popupPath = pathOverride ?? definition.path;
  const popupUrl = new URL(popupPath, window.location.href);

  if (isOpenWindow(existingWindow)) {
    if (
      existingWindow.location.pathname !== popupUrl.pathname
      || existingWindow.location.search !== popupUrl.search
    ) {
      existingWindow.location.replace(popupUrl.href);
    }

    existingWindow.focus();
    return existingWindow;
  }

  const nextWindow = window.open(
    popupUrl.href,
    definition.name,
    buildWindowFeatures(getPopupFeatures(definition))
  );

  if (!nextWindow) {
    return null;
  }

  popupRefs.set(id, nextWindow);
  attachMainWindowLifecycleListeners();
  nextWindow.addEventListener('beforeunload', () => {
    if (popupRefs.get(id) === nextWindow) {
      popupRefs.set(id, null);
    }
  });
  nextWindow.focus();

  return nextWindow;
}

export const windowManager = {
  openPopup(id: PopupWindowId) {
    return openPopupWindow(id);
  },
  openOptions(view?: OptionsViewName) {
    const existingWindow = popupRefs.get('options');

    if (isOpenWindow(existingWindow)) {
      if (view) {
        existingWindow.postMessage({ type: 'izci:open-options-view', view }, window.location.origin);
      }

      existingWindow.focus();
      return existingWindow;
    }

    return openPopupWindow('options', view ? buildOptionsWindowPath(view) : undefined);
  },
  exit() {
    closeAllPopupWindows();
    window.close();

    if (!window.closed) {
      window.location.replace('about:blank');
    }
  },
  closePopups: closeAllPopupWindows
};
