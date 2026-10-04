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

export const EMPTY_RECT: WindowControlsOverlayRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0
};

export const DEFAULT_STATE: WindowControlsOverlayState = {
  supported: false,
  visible: false,
  titlebarAreaRect: EMPTY_RECT
};

export function resolveTitlebarAreaRect(
  rect: WindowControlsOverlayRect,
  fullscreen: boolean,
  viewportWidth: number
): WindowControlsOverlayRect {
  if (!fullscreen) {
    return rect;
  }

  return {
    x: 0,
    y: 0,
    width: Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : rect.width,
    height: rect.height
  };
}

