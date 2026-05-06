import { writable } from 'svelte/store';

interface WindowBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface MiniModeState {
  active: boolean;
}

const MINI_MODE_WIDTH = 500;
const MIN_MINI_MODE_INNER_HEIGHT = 100;
const MINI_MODE_VERTICAL_PADDING = 0;
const MANUAL_EXIT_HEIGHT_DELTA = 2;
const AUTO_MINI_MODE_OUTER_HEIGHT = 150;
const NORMAL_BOUNDS_STORAGE_KEY = 'izci.window-mini-mode.normal-bounds';

function isUsableBounds(value: Partial<WindowBounds>): value is WindowBounds {
  return (
    typeof value.left === 'number'
    && typeof value.top === 'number'
    && typeof value.width === 'number'
    && typeof value.height === 'number'
    && isFinite(value.left)
    && isFinite(value.top)
    && isFinite(value.width)
    && isFinite(value.height)
    && value.width >= 320
    && value.height >= AUTO_MINI_MODE_OUTER_HEIGHT
  );
}

function readStoredNormalBounds(): WindowBounds | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(NORMAL_BOUNDS_STORAGE_KEY);
    const parsedValue = rawValue ? JSON.parse(rawValue) : null;

    return parsedValue && typeof parsedValue === 'object' && isUsableBounds(parsedValue)
      ? parsedValue
      : null;
  } catch {
    return null;
  }
}

function persistNormalBounds(bounds: WindowBounds): void {
  if (typeof window === 'undefined' || !isUsableBounds(bounds)) {
    return;
  }

  window.localStorage.setItem(NORMAL_BOUNDS_STORAGE_KEY, JSON.stringify(bounds));
}

function isAutoMiniModeSize(): boolean {
  return typeof window !== 'undefined' && window.outerHeight > 0 && window.outerHeight < AUTO_MINI_MODE_OUTER_HEIGHT;
}

const initialMiniModeActive = isAutoMiniModeSize();
const store = writable<MiniModeState>({ active: initialMiniModeActive });
let currentState: MiniModeState = { active: initialMiniModeActive };
let restoreBounds: WindowBounds | null = readStoredNormalBounds();
let targetMiniModeOuterHeight: number | null = initialMiniModeActive && typeof window !== 'undefined'
  ? Math.round(window.outerHeight)
  : null;
let isApplyingMiniModeBounds = false;

store.subscribe((value) => {
  currentState = value;
});

function getWindowBounds(): WindowBounds {
  return {
    left: Math.round(window.screenX),
    top: Math.round(window.screenY),
    width: Math.round(window.outerWidth),
    height: Math.round(window.outerHeight)
  };
}

function getChromeHeight(): number {
  return Math.max(0, window.outerHeight - window.innerHeight);
}

function getMiniModeInnerHeight(): number {
  const menuBar = document.querySelector<HTMLElement>('.menu-bar');
  const playerBar = document.querySelector<HTMLElement>('.player-bar');
  const menuHeight = menuBar?.getBoundingClientRect().height ?? 0;
  const playerHeight = playerBar?.getBoundingClientRect().height ?? 0;
  const measuredHeight = Math.ceil(menuHeight + playerHeight + MINI_MODE_VERTICAL_PADDING);

  return Math.max(MIN_MINI_MODE_INNER_HEIGHT, measuredHeight);
}

function setActive(active: boolean): void {
  if (currentState.active === active) {
    return;
  }

  store.set({ active });
}

function resizeWindow(width: number, height: number): void {
  window.resizeTo(Math.max(320, Math.round(width)), Math.max(120, Math.round(height)));
}

function enterMiniMode(): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (!restoreBounds) {
    restoreBounds = getWindowBounds();
  }

  persistNormalBounds(restoreBounds);
  isApplyingMiniModeBounds = true;
  setActive(true);

  requestAnimationFrame(() => {
    const bottom = window.screenY + window.outerHeight;
    const targetOuterHeight = getMiniModeInnerHeight() + getChromeHeight();

    targetMiniModeOuterHeight = Math.round(targetOuterHeight);
    resizeWindow(MINI_MODE_WIDTH, targetOuterHeight);
    requestAnimationFrame(() => {
      window.moveTo(window.screenX, Math.round(bottom - window.outerHeight));
      targetMiniModeOuterHeight = Math.round(window.outerHeight);
      isApplyingMiniModeBounds = false;
    });
  });
}

function exitMiniMode(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const bounds = restoreBounds;
  restoreBounds = null;
  targetMiniModeOuterHeight = null;
  isApplyingMiniModeBounds = false;

  if (bounds) {
    window.moveTo(bounds.left, bounds.top);
    resizeWindow(bounds.width, bounds.height);
    persistNormalBounds(bounds);
  }

  setActive(false);
}

function handleWindowResize(): void {
  if (!currentState.active) {
    if (isAutoMiniModeSize()) {
      restoreBounds = readStoredNormalBounds() ?? restoreBounds;
      targetMiniModeOuterHeight = Math.round(window.outerHeight);
      setActive(true);
      return;
    }

    persistNormalBounds(getWindowBounds());
    return;
  }

  if (isApplyingMiniModeBounds) {
    return;
  }

  const targetHeight = targetMiniModeOuterHeight;

  if (targetHeight === null) {
    targetMiniModeOuterHeight = Math.round(window.outerHeight);
    return;
  }

  if (Math.abs(Math.round(window.outerHeight) - targetHeight) <= MANUAL_EXIT_HEIGHT_DELTA) {
    return;
  }

  restoreBounds = readStoredNormalBounds();
  targetMiniModeOuterHeight = null;
  setActive(false);
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', handleWindowResize);
  window.addEventListener('beforeunload', () => {
    if (!currentState.active && !isAutoMiniModeSize()) {
      persistNormalBounds(getWindowBounds());
    }
  });
}

export const windowMiniMode = {
  subscribe: store.subscribe,
  getSnapshot(): MiniModeState {
    return currentState;
  },
  enter: enterMiniMode,
  exit: exitMiniMode,
  toggle(): void {
    if (currentState.active) {
      exitMiniMode();
      return;
    }

    enterMiniMode();
  }
};
