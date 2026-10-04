import { DEFAULT_STATE, resolveTitlebarAreaRect, type WindowControlsOverlayState, type WindowControlsOverlayRect } from '../window-controls-overlay-types';
import { readable } from 'svelte/store';

interface WindowControlsOverlayGeometryChangeEvent extends Event {
  titlebarAreaRect: DOMRectReadOnly;
  visible: boolean;
}

interface WindowControlsOverlayLike {
  visible: boolean;
  getTitlebarAreaRect(): DOMRectReadOnly;
  addEventListener(
    type: 'geometrychange',
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: 'geometrychange',
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ): void;
}

interface NavigatorWithWindowControlsOverlay extends Navigator {
  windowControlsOverlay?: WindowControlsOverlayLike;
}

const FULLSCREEN_BOUNDS_TOLERANCE = 16;

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isClose(left: number, right: number): boolean {
  return Math.abs(left - right) <= FULLSCREEN_BOUNDS_TOLERANCE;
}

function toRect(rect: DOMRectReadOnly): WindowControlsOverlayRect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
  };
}

function isFullscreenLikeWindow(): boolean {
  const screenWithOffsets = window.screen as Screen & {
    left?: number;
    top?: number;
  };
  const fullscreenQuery = window.matchMedia('(display-mode: fullscreen)');
  const screenLeft = screenWithOffsets.left ?? 0;
  const screenTop = screenWithOffsets.top ?? 0;

  if (document.fullscreenElement || fullscreenQuery.matches) {
    return true;
  }

  return (
    isFinitePositive(screenWithOffsets.width) &&
    isFinitePositive(screenWithOffsets.height) &&
    isClose(window.screenX, screenLeft) &&
    isClose(window.screenY, screenTop) &&
    isClose(window.outerWidth, screenWithOffsets.width) &&
    isClose(window.outerHeight, screenWithOffsets.height)
  );
}

export const windowControlsOverlayState = readable<WindowControlsOverlayState>(DEFAULT_STATE, (set) => {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const overlay = (navigator as NavigatorWithWindowControlsOverlay).windowControlsOverlay;

  if (!overlay) {
    set(DEFAULT_STATE);
    return undefined;
  }

  let animationFrame = 0;

  const updateState = (event?: WindowControlsOverlayGeometryChangeEvent) => {
    animationFrame = 0;
    const rawTitlebarAreaRect = event ? event.titlebarAreaRect : overlay.getTitlebarAreaRect();
    const titlebarAreaRect = resolveTitlebarAreaRect(
      toRect(rawTitlebarAreaRect),
      isFullscreenLikeWindow(),
      window.innerWidth
    );

    set({
      supported: true,
      visible: overlay.visible,
      titlebarAreaRect
    });
  };

  const scheduleUpdate = () => {
    if (animationFrame !== 0) {
      return;
    }

    animationFrame = window.requestAnimationFrame(() => updateState());
  };

  const handleGeometryChange = (event: Event) => {
    updateState(event as WindowControlsOverlayGeometryChangeEvent);
  };

  const fullscreenQuery = window.matchMedia('(display-mode: fullscreen)');

  updateState();
  overlay.addEventListener('geometrychange', handleGeometryChange);
  window.addEventListener('resize', scheduleUpdate);
  window.addEventListener('focus', scheduleUpdate);
  document.addEventListener('fullscreenchange', scheduleUpdate);
  document.addEventListener('visibilitychange', scheduleUpdate);
  fullscreenQuery.addEventListener('change', scheduleUpdate);

  return () => {
    if (animationFrame !== 0) {
      window.cancelAnimationFrame(animationFrame);
    }

    overlay.removeEventListener('geometrychange', handleGeometryChange);
    window.removeEventListener('resize', scheduleUpdate);
    window.removeEventListener('focus', scheduleUpdate);
    document.removeEventListener('fullscreenchange', scheduleUpdate);
    document.removeEventListener('visibilitychange', scheduleUpdate);
    fullscreenQuery.removeEventListener('change', scheduleUpdate);
  };
});
