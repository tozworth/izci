import { popupWindows, type PopupWindowDefinition, type PopupWindowId } from '$lib/services/popup-windows';

function isOpenWindow(windowRef: Window | null | undefined): windowRef is Window {
  return windowRef !== null && windowRef !== undefined && !windowRef.closed;
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

function openPopupWindow(id: PopupWindowId): Window | null {
  const existingWindow = popupRefs.get(id);

  if (isOpenWindow(existingWindow)) {
    existingWindow.focus();
    return existingWindow;
  }

  const definition = popupWindows[id];
  const nextWindow = window.open(definition.path, definition.name, buildWindowFeatures(definition.features));

  if (!nextWindow) {
    return null;
  }

  popupRefs.set(id, nextWindow);
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
  openOptions() {
    return openPopupWindow('options');
  },
  exit() {
    window.close();

    if (!window.closed) {
      window.location.replace('about:blank');
    }
  }
};
