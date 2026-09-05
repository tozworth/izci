import { popupWindows, type PopupWindowId } from '$lib/services/popup-windows';

const STORAGE_KEY = 'izci.popup-window-sizes';
const MIN_WIDTH = 320;
const MIN_HEIGHT = 240;

interface PopupWindowSize {
  width: number;
  height: number;
}

type StoredPopupWindowSizes = Partial<Record<PopupWindowId, Partial<PopupWindowSize>>>;

function defaultSize(id: PopupWindowId): PopupWindowSize {
  const { width, height } = popupWindows[id].features;
  return {
    width: typeof width === 'number' ? width : MIN_WIDTH,
    height: typeof height === 'number' ? height : MIN_HEIGHT
  };
}

function normalizeDimension(value: unknown, fallback: number, minimum: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum
    ? Math.round(value)
    : fallback;
}

function readStoredSizes(): StoredPopupWindowSizes {
  if (typeof window === 'undefined') return {};

  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
    return value && typeof value === 'object' ? value as StoredPopupWindowSizes : {};
  } catch {
    return {};
  }
}

export function getPopupWindowSize(id: PopupWindowId): PopupWindowSize {
  const fallback = defaultSize(id);
  const stored = readStoredSizes()[id];

  return {
    width: normalizeDimension(stored?.width, fallback.width, MIN_WIDTH),
    height: normalizeDimension(stored?.height, fallback.height, MIN_HEIGHT)
  };
}

export function rememberPopupWindowSize(id: PopupWindowId, width: number, height: number): void {
  if (typeof window === 'undefined') return;

  const fallback = defaultSize(id);
  const size = {
    width: normalizeDimension(width, fallback.width, MIN_WIDTH),
    height: normalizeDimension(height, fallback.height, MIN_HEIGHT)
  };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ...readStoredSizes(),
      [id]: size
    }));
  } catch {
    // Popup windows remain usable when lightweight size persistence is unavailable.
  }
}

export function initializePopupWindowSizePersistence(id: PopupWindowId): () => void {
  if (typeof window === 'undefined') return () => undefined;

  let pendingFrame: number | null = null;
  const persistCurrentSize = () => {
    if (pendingFrame !== null) {
      window.cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
    }
    rememberPopupWindowSize(id, window.outerWidth, window.outerHeight);
  };
  const schedulePersistence = () => {
    if (pendingFrame !== null) return;
    pendingFrame = window.requestAnimationFrame(() => {
      pendingFrame = null;
      rememberPopupWindowSize(id, window.outerWidth, window.outerHeight);
    });
  };

  window.addEventListener('resize', schedulePersistence);
  window.addEventListener('pagehide', persistCurrentSize);

  return () => {
    if (pendingFrame !== null) window.cancelAnimationFrame(pendingFrame);
    window.removeEventListener('resize', schedulePersistence);
    window.removeEventListener('pagehide', persistCurrentSize);
  };
}
