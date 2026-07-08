export interface NowPlayingScreenGeometry {
  width?: number;
  height?: number;
  availWidth?: number;
  availHeight?: number;
  availLeft?: number;
  availTop?: number;
  left?: number;
  top?: number;
}

export interface NowPlayingWindowGeometry {
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  screenX: number;
  screenY: number;
  screen: NowPlayingScreenGeometry;
}

export interface NowPlayingWindowBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const NOW_PLAYING_MIN_VIEWPORT_WIDTH = 901;
export const NOW_PLAYING_MIN_VIEWPORT_HEIGHT = 721;
export const NOW_PLAYING_COMFORTABLE_VIEWPORT_WIDTH = 1280;
export const NOW_PLAYING_COMFORTABLE_VIEWPORT_HEIGHT = 800;

const MIN_WINDOW_WIDTH = 320;
const MIN_WINDOW_HEIGHT = 240;

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getPositive(value: number | undefined, fallback: number): number {
  return isFiniteNumber(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function resolveNowPlayingWindowBounds(
  geometry: NowPlayingWindowGeometry,
  targetInnerWidth = NOW_PLAYING_COMFORTABLE_VIEWPORT_WIDTH,
  targetInnerHeight = NOW_PLAYING_COMFORTABLE_VIEWPORT_HEIGHT
): NowPlayingWindowBounds | null {
  const chromeWidth = Math.max(0, geometry.outerWidth - geometry.innerWidth);
  const chromeHeight = Math.max(0, geometry.outerHeight - geometry.innerHeight);
  const targetOuterWidth = Math.max(geometry.outerWidth, targetInnerWidth + chromeWidth);
  const targetOuterHeight = Math.max(geometry.outerHeight, targetInnerHeight + chromeHeight);
  const shouldGrowWidth = geometry.innerWidth < targetInnerWidth;
  const shouldGrowHeight = geometry.innerHeight < targetInnerHeight;

  if (!shouldGrowWidth && !shouldGrowHeight) {
    return null;
  }

  const screen = geometry.screen;
  const availLeft = isFiniteNumber(screen.availLeft) ? screen.availLeft : (screen.left ?? 0);
  const availTop = isFiniteNumber(screen.availTop) ? screen.availTop : (screen.top ?? 0);
  const availWidth = getPositive(screen.availWidth, getPositive(screen.width, targetOuterWidth));
  const availHeight = getPositive(screen.availHeight, getPositive(screen.height, targetOuterHeight));
  const nextWidth = shouldGrowWidth
    ? Math.max(geometry.outerWidth, Math.min(targetOuterWidth, availWidth))
    : geometry.outerWidth;
  const nextHeight = shouldGrowHeight
    ? Math.max(geometry.outerHeight, Math.min(targetOuterHeight, availHeight))
    : geometry.outerHeight;
  const width = Math.max(MIN_WINDOW_WIDTH, Math.round(nextWidth));
  const height = Math.max(MIN_WINDOW_HEIGHT, Math.round(nextHeight));
  const maxLeft = availLeft + Math.max(availWidth - width, 0);
  const maxTop = availTop + Math.max(availHeight - height, 0);
  const left = clamp(Math.round(geometry.screenX), availLeft, maxLeft);
  const top = clamp(Math.round(geometry.screenY), availTop, maxTop);

  return {
    left,
    top,
    width,
    height
  };
}

function readWindowGeometry(): NowPlayingWindowGeometry | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const screen = window.screen as Screen & {
    availLeft?: number;
    availTop?: number;
    left?: number;
    top?: number;
  };

  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    screenX: window.screenX,
    screenY: window.screenY,
    screen: {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      availLeft: screen.availLeft,
      availTop: screen.availTop,
      left: screen.left,
      top: screen.top
    }
  };
}

function applyNowPlayingWindowBounds(): boolean {
  const geometry = readWindowGeometry();
  const bounds = geometry ? resolveNowPlayingWindowBounds(geometry) : null;

  if (!bounds) {
    return false;
  }

  window.moveTo(bounds.left, bounds.top);
  window.resizeTo(bounds.width, bounds.height);
  return true;
}

export function ensureComfortableNowPlayingWindowSize(): void {
  if (typeof window === 'undefined') {
    return;
  }

  applyNowPlayingWindowBounds();
  window.requestAnimationFrame(() => {
    applyNowPlayingWindowBounds();
  });
}
