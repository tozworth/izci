import { readable } from 'svelte/store';

export interface WindowDisplayState {
  maximized: boolean;
  fullscreen: boolean;
  prefersNowPlaying: boolean;
}

interface WindowScreenGeometry {
  width: number;
  height: number;
  availWidth: number;
  availHeight: number;
  availLeft?: number;
  availTop?: number;
  left?: number;
  top?: number;
}

export interface WindowGeometry {
  outerWidth: number;
  outerHeight: number;
  screenX: number;
  screenY: number;
  screen: WindowScreenGeometry;
  fullscreenElement: boolean;
  fullscreenDisplayMode: boolean;
}

const WINDOW_BOUNDS_TOLERANCE = 16;
const DEFAULT_STATE: WindowDisplayState = {
  maximized: false,
  fullscreen: false,
  prefersNowPlaying: false
};

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isClose(left: number, right: number): boolean {
  return Math.abs(left - right) <= WINDOW_BOUNDS_TOLERANCE;
}

function matchesBounds(
  geometry: WindowGeometry,
  bounds: { left: number; top: number; width: number; height: number }
): boolean {
  return (
    isFinitePositive(bounds.width) &&
    isFinitePositive(bounds.height) &&
    isClose(geometry.screenX, bounds.left) &&
    isClose(geometry.screenY, bounds.top) &&
    isClose(geometry.outerWidth, bounds.width) &&
    isClose(geometry.outerHeight, bounds.height)
  );
}

export function detectWindowDisplayState(geometry: WindowGeometry): WindowDisplayState {
  const screenLeft = geometry.screen.left ?? 0;
  const screenTop = geometry.screen.top ?? 0;
  const availLeft = geometry.screen.availLeft ?? screenLeft;
  const availTop = geometry.screen.availTop ?? screenTop;
  const fullscreen = Boolean(geometry.fullscreenElement || geometry.fullscreenDisplayMode) ||
    matchesBounds(geometry, {
      left: screenLeft,
      top: screenTop,
      width: geometry.screen.width,
      height: geometry.screen.height
    });
  const maximized = matchesBounds(geometry, {
    left: availLeft,
    top: availTop,
    width: geometry.screen.availWidth,
    height: geometry.screen.availHeight
  });

  return {
    maximized,
    fullscreen,
    prefersNowPlaying: maximized || fullscreen
  };
}

function getWindowGeometry(): WindowGeometry {
  const screenWithOffsets = window.screen as Screen & {
    availLeft?: number;
    availTop?: number;
    left?: number;
    top?: number;
  };
  const fullscreenQuery = window.matchMedia('(display-mode: fullscreen)');

  return {
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    screenX: window.screenX,
    screenY: window.screenY,
    screen: {
      width: screenWithOffsets.width,
      height: screenWithOffsets.height,
      availWidth: screenWithOffsets.availWidth,
      availHeight: screenWithOffsets.availHeight,
      availLeft: screenWithOffsets.availLeft,
      availTop: screenWithOffsets.availTop,
      left: screenWithOffsets.left,
      top: screenWithOffsets.top
    },
    fullscreenElement: Boolean(document.fullscreenElement),
    fullscreenDisplayMode: fullscreenQuery.matches
  };
}

function readWindowDisplayState(): WindowDisplayState {
  if (typeof window === 'undefined') {
    return DEFAULT_STATE;
  }

  return detectWindowDisplayState(getWindowGeometry());
}

export const windowDisplayState = readable<WindowDisplayState>(DEFAULT_STATE, (set) => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  let animationFrame = 0;

  const updateState = () => {
    animationFrame = 0;
    set(readWindowDisplayState());
  };

  const scheduleUpdate = () => {
    if (animationFrame !== 0) {
      return;
    }

    animationFrame = window.requestAnimationFrame(updateState);
  };

  const fullscreenQuery = window.matchMedia('(display-mode: fullscreen)');

  set(readWindowDisplayState());
  window.addEventListener('resize', scheduleUpdate);
  window.addEventListener('focus', scheduleUpdate);
  document.addEventListener('fullscreenchange', scheduleUpdate);
  document.addEventListener('visibilitychange', scheduleUpdate);
  fullscreenQuery.addEventListener('change', scheduleUpdate);

  return () => {
    if (animationFrame !== 0) {
      window.cancelAnimationFrame(animationFrame);
    }

    window.removeEventListener('resize', scheduleUpdate);
    window.removeEventListener('focus', scheduleUpdate);
    document.removeEventListener('fullscreenchange', scheduleUpdate);
    document.removeEventListener('visibilitychange', scheduleUpdate);
    fullscreenQuery.removeEventListener('change', scheduleUpdate);
  };
});
