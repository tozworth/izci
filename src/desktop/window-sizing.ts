import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi';
import {
  readBrowserWindowGeometry,
  type WindowBounds,
  type WindowGeometry
} from '$lib/services/window-geometry';

export async function readWindowGeometry(): Promise<WindowGeometry | null> {
  const geometry = readBrowserWindowGeometry();
  if (!geometry) return null;
  const native = getCurrentWindow();
  const [scale, outer, position, monitor, maximized, fullscreen] = await Promise.all([
    native.scaleFactor(), native.outerSize(), native.outerPosition(), currentMonitor(),
    native.isMaximized(), native.isFullscreen()
  ]);
  if (maximized || fullscreen) return null;

  const size = outer.toLogical(scale);
  const origin = position.toLogical(scale);
  // WebView2's screen/outer geometry is not the native HWND's geometry. Keep
  // only the CSS viewport; native logical pixels also preserve browser zoom.
  return {
    ...geometry,
    outerWidth: size.width, outerHeight: size.height,
    screenX: origin.x, screenY: origin.y,
    screen: monitor ? {
      width: monitor.size.width / scale,
      height: monitor.size.height / scale,
      availLeft: monitor.workArea.position.x / scale,
      availTop: monitor.workArea.position.y / scale,
      availWidth: monitor.workArea.size.width / scale,
      availHeight: monitor.workArea.size.height / scale
    } : geometry.screen
  };
}

export async function applyWindowBounds(bounds: WindowBounds): Promise<void> {
  const native = getCurrentWindow();
  const [maximized, fullscreen] = await Promise.all([native.isMaximized(), native.isFullscreen()]);
  if (maximized || fullscreen) return;

  await native.setPosition(new LogicalPosition(bounds.left, bounds.top));
  // setSize takes inner dimensions; our shared browser contract takes outer
  // dimensions. Read the frame after moving in case the monitor DPI changed.
  const [scale, outer, inner] = await Promise.all([
    native.scaleFactor(), native.outerSize(), native.innerSize()
  ]);
  await native.setSize(new LogicalSize(
    Math.max(1, bounds.width - (outer.width - inner.width) / scale),
    Math.max(1, bounds.height - (outer.height - inner.height) / scale)
  ));
}
