interface WindowScreenGeometry {
  width?: number;
  height?: number;
  availWidth?: number;
  availHeight?: number;
  availLeft?: number;
  availTop?: number;
  left?: number;
  top?: number;
}

/** Window bounds use outer dimensions in logical screen pixels, not viewport CSS pixels. */
export interface WindowGeometry {
  innerWidth: number;
  innerHeight: number;
  outerWidth: number;
  outerHeight: number;
  screenX: number;
  screenY: number;
  screen: WindowScreenGeometry;
}

export interface WindowBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function readBrowserWindowGeometry(): WindowGeometry | null {
  if (typeof window === 'undefined') return null;
  const screen = window.screen as Screen & WindowScreenGeometry;
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    screenX: window.screenX,
    screenY: window.screenY,
    screen: {
      width: screen.width, height: screen.height,
      availWidth: screen.availWidth, availHeight: screen.availHeight,
      availLeft: screen.availLeft, availTop: screen.availTop,
      left: screen.left, top: screen.top
    }
  };
}

export function applyBrowserWindowBounds(bounds: WindowBounds): void {
  if (typeof window === 'undefined') return;
  window.moveTo(bounds.left, bounds.top);
  window.resizeTo(bounds.width, bounds.height);
}
