import {
  resolveNowPlayingBrowserZoomScale,
  type NowPlayingWindowBounds,
  type NowPlayingWindowGeometry
} from './window-now-playing';

const VIDEO_MIN_VIEWPORT_WIDTH = 960;
const VIDEO_MIN_VIEWPORT_HEIGHT = 540;
export const VIDEO_WINDOW_WIDTH = 1280;
export const VIDEO_WINDOW_HEIGHT = 720;

const MIN_WINDOW_WIDTH = 320;
const MIN_WINDOW_HEIGHT = 240;

let videoRestoreBounds: NowPlayingWindowBounds | null = null;

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getPositive(value: number | undefined, fallback: number): number {
  return isFiniteNumber(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function resolveVideoWindowBounds(
  geometry: NowPlayingWindowGeometry
): NowPlayingWindowBounds | null {
  const zoomScale = resolveNowPlayingBrowserZoomScale(geometry);
  const targetWidth = VIDEO_WINDOW_WIDTH * zoomScale;
  const targetHeight = VIDEO_WINDOW_HEIGHT * zoomScale;
  const viewportEligible =
    geometry.innerWidth >= VIDEO_MIN_VIEWPORT_WIDTH &&
    geometry.innerHeight >= VIDEO_MIN_VIEWPORT_HEIGHT;
  const windowAlreadyComfortable =
    geometry.outerWidth >= targetWidth && geometry.outerHeight >= targetHeight;

  if (viewportEligible || windowAlreadyComfortable) {
    return null;
  }

  const screen = geometry.screen;
  const availLeft = isFiniteNumber(screen.availLeft) ? screen.availLeft : (screen.left ?? 0);
  const availTop = isFiniteNumber(screen.availTop) ? screen.availTop : (screen.top ?? 0);
  const availWidth = getPositive(screen.availWidth, getPositive(screen.width, targetWidth));
  const availHeight = getPositive(screen.availHeight, getPositive(screen.height, targetHeight));
  const width = Math.max(MIN_WINDOW_WIDTH, Math.round(Math.min(targetWidth, availWidth)));
  const height = Math.max(MIN_WINDOW_HEIGHT, Math.round(Math.min(targetHeight, availHeight)));
  const maxLeft = availLeft + Math.max(availWidth - width, 0);
  const maxTop = availTop + Math.max(availHeight - height, 0);

  return {
    left: clamp(Math.round(geometry.screenX), availLeft, maxLeft),
    top: clamp(Math.round(geometry.screenY), availTop, maxTop),
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

function readWindowBounds(geometry: NowPlayingWindowGeometry): NowPlayingWindowBounds {
  return {
    left: Math.round(geometry.screenX),
    top: Math.round(geometry.screenY),
    width: Math.round(geometry.outerWidth),
    height: Math.round(geometry.outerHeight)
  };
}

export function ensureComfortableVideoWindowSize(): void {
  const geometry = readWindowGeometry();

  if (!geometry) {
    return;
  }

  const bounds = resolveVideoWindowBounds(geometry);

  if (!bounds) {
    return;
  }

  videoRestoreBounds ??= readWindowBounds(geometry);
  window.moveTo(bounds.left, bounds.top);
  window.resizeTo(bounds.width, bounds.height);
}

export function restoreVideoWindowSize(): void {
  if (typeof window === 'undefined' || !videoRestoreBounds) {
    return;
  }

  const bounds = videoRestoreBounds;
  videoRestoreBounds = null;
  window.moveTo(bounds.left, bounds.top);
  window.resizeTo(bounds.width, bounds.height);
}
