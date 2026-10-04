import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogicalPosition, LogicalSize, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';

const native = vi.hoisted(() => ({
  scaleFactor: vi.fn(), outerSize: vi.fn(), innerSize: vi.fn(), outerPosition: vi.fn(),
  isMaximized: vi.fn(), isFullscreen: vi.fn(), setSize: vi.fn(), setPosition: vi.fn(),
  monitor: vi.fn()
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => native, currentMonitor: native.monitor
}));

import { applyWindowBounds, readWindowGeometry } from './window-sizing';

describe('desktop window sizing', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('window', {
      innerWidth: 500, innerHeight: 300, outerWidth: 500, outerHeight: 300,
      screenX: 0, screenY: 0, screen: { width: 1920, height: 1080 }
    });
    native.scaleFactor.mockResolvedValue(1.5);
    native.outerSize.mockResolvedValue(new PhysicalSize(774, 477));
    native.innerSize.mockResolvedValue(new PhysicalSize(750, 450));
    native.outerPosition.mockResolvedValue(new PhysicalPosition(-1800, 60));
    native.monitor.mockResolvedValue({
      size: new PhysicalSize(2880, 1620),
      workArea: { position: new PhysicalPosition(-2880, 0), size: new PhysicalSize(2880, 1560) }
    });
    native.isMaximized.mockResolvedValue(false);
    native.isFullscreen.mockResolvedValue(false);
    native.setPosition.mockResolvedValue(undefined);
    native.setSize.mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uses native bounds and monitor work area in logical pixels while retaining the CSS viewport', async () => {
    expect(await readWindowGeometry()).toEqual({
      innerWidth: 500, innerHeight: 300, outerWidth: 516, outerHeight: 318,
      screenX: -1200, screenY: 40,
      screen: { width: 1920, height: 1080, availLeft: -1920, availTop: 0, availWidth: 1920, availHeight: 1040 }
    });
  });

  it('converts an outer target to the native inner size and moves through Tauri', async () => {
    await applyWindowBounds({ left: -1200, top: 40, width: 1280, height: 800 });
    expect(native.setPosition).toHaveBeenCalledWith(new LogicalPosition(-1200, 40));
    expect(native.setSize).toHaveBeenCalledWith(new LogicalSize(1264, 782));
  });

  it('reads frame dimensions after moving to a different DPI monitor', async () => {
    native.setPosition.mockImplementation(async () => {
      native.scaleFactor.mockResolvedValue(2);
      native.outerSize.mockResolvedValue(new PhysicalSize(1032, 636));
      native.innerSize.mockResolvedValue(new PhysicalSize(1000, 600));
    });
    await applyWindowBounds({ left: 10, top: 20, width: 1280, height: 800 });
    expect(native.setSize).toHaveBeenCalledWith(new LogicalSize(1264, 782));
  });

  it.each(['isMaximized', 'isFullscreen'] as const)('preserves a window when %s is true', async (state) => {
    native[state].mockResolvedValue(true);
    expect(await readWindowGeometry()).toBeNull();
    await applyWindowBounds({ left: 0, top: 0, width: 1280, height: 800 });
    expect(native.setPosition).not.toHaveBeenCalled();
    expect(native.setSize).not.toHaveBeenCalled();
  });
});
