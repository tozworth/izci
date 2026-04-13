import { readable } from 'svelte/store';

export interface WindowControlsOverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowControlsOverlayState {
  supported: boolean;
  visible: boolean;
  titlebarAreaRect: WindowControlsOverlayRect;
}

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

const EMPTY_RECT: WindowControlsOverlayRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0
};

const DEFAULT_STATE: WindowControlsOverlayState = {
  supported: false,
  visible: false,
  titlebarAreaRect: EMPTY_RECT
};

function toRect(rect: DOMRectReadOnly): WindowControlsOverlayRect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
  };
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

  const updateState = (event?: WindowControlsOverlayGeometryChangeEvent) => {
    const titlebarAreaRect = event ? event.titlebarAreaRect : overlay.getTitlebarAreaRect();

    set({
      supported: true,
      visible: overlay.visible,
      titlebarAreaRect: toRect(titlebarAreaRect)
    });
  };

  const handleGeometryChange = (event: Event) => {
    updateState(event as WindowControlsOverlayGeometryChangeEvent);
  };

  updateState();
  overlay.addEventListener('geometrychange', handleGeometryChange);

  return () => {
    overlay.removeEventListener('geometrychange', handleGeometryChange);
  };
});
