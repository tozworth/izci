import { createTemporaryWindowSizer } from './window-sizing';
import type { WindowBounds, WindowGeometry } from './window-geometry';

export type NowPlayingWindowGeometry = WindowGeometry;
export type NowPlayingWindowBounds = WindowBounds;

export const NOW_PLAYING_MIN_VIEWPORT_WIDTH = 901;
export const NOW_PLAYING_MIN_VIEWPORT_HEIGHT = 721;
export const NOW_PLAYING_COMFORTABLE_WINDOW_WIDTH = 1280;
export const NOW_PLAYING_COMFORTABLE_WINDOW_HEIGHT = 800;

const MIN_WINDOW_WIDTH = 320;
const MIN_WINDOW_HEIGHT = 240;
const MIN_BROWSER_ZOOM_SCALE = 1.075;
const MAX_BROWSER_ZOOM_SCALE = 3;

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getPositive(value: number | undefined, fallback: number): number {
  return isFiniteNumber(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function resolveNowPlayingBrowserZoomScale(
  geometry: NowPlayingWindowGeometry
): number {
  if (
    geometry.innerWidth <= 0 ||
    geometry.innerHeight <= 0 ||
    geometry.outerWidth <= 0 ||
    geometry.outerHeight <= 0
  ) {
    return 1;
  }

  const widthScale = geometry.outerWidth / geometry.innerWidth;
  const heightScale = geometry.outerHeight / geometry.innerHeight;
  const scale = Math.min(widthScale, heightScale);

  if (!Number.isFinite(scale) || scale < MIN_BROWSER_ZOOM_SCALE) {
    return 1;
  }

  return clamp(scale, 1, MAX_BROWSER_ZOOM_SCALE);
}

export function resolveNowPlayingWindowBounds(
  geometry: NowPlayingWindowGeometry,
  targetWindowWidth = NOW_PLAYING_COMFORTABLE_WINDOW_WIDTH,
  targetWindowHeight = NOW_PLAYING_COMFORTABLE_WINDOW_HEIGHT
): NowPlayingWindowBounds | null {
  const browserZoomScale = resolveNowPlayingBrowserZoomScale(geometry);
  const scaledTargetWindowWidth = targetWindowWidth * browserZoomScale;
  const scaledTargetWindowHeight = targetWindowHeight * browserZoomScale;
  const viewportEligible =
    geometry.innerWidth >= NOW_PLAYING_MIN_VIEWPORT_WIDTH &&
    geometry.innerHeight >= NOW_PLAYING_MIN_VIEWPORT_HEIGHT;
  const shouldGrowWidth = geometry.outerWidth < scaledTargetWindowWidth;
  const shouldGrowHeight = geometry.outerHeight < scaledTargetWindowHeight;

  if (viewportEligible || (!shouldGrowWidth && !shouldGrowHeight)) {
    return null;
  }

  const screen = geometry.screen;
  const availLeft = isFiniteNumber(screen.availLeft) ? screen.availLeft : (screen.left ?? 0);
  const availTop = isFiniteNumber(screen.availTop) ? screen.availTop : (screen.top ?? 0);
  const availWidth = getPositive(
    screen.availWidth,
    getPositive(screen.width, scaledTargetWindowWidth)
  );
  const availHeight = getPositive(
    screen.availHeight,
    getPositive(screen.height, scaledTargetWindowHeight)
  );
  const nextWidth = shouldGrowWidth
    ? Math.max(geometry.outerWidth, Math.min(scaledTargetWindowWidth, availWidth))
    : geometry.outerWidth;
  const nextHeight = shouldGrowHeight
    ? Math.max(geometry.outerHeight, Math.min(scaledTargetWindowHeight, availHeight))
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

const windowSizer = createTemporaryWindowSizer(resolveNowPlayingWindowBounds);

export function ensureComfortableNowPlayingWindowSize(): Promise<void> {
  return windowSizer.ensure();
}

export function restoreNowPlayingWindowSize(): Promise<void> {
  return windowSizer.restore();
}
