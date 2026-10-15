import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ setZoom: vi.fn(), label: 'main' }));
const { setZoom } = native;
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => native }));

describe('desktop zoom', () => {
  beforeEach(() => { vi.resetModules(); native.label = 'main'; setZoom.mockReset().mockResolvedValue(undefined); });
  afterEach(() => vi.restoreAllMocks());

  it('applies saved zoom before readiness, follows settings, and ignores unrelated changes', async () => {
    const { desktopSettings, resetDesktopAppearance } = await import('./settings');
    desktopSettings.update({ zoomPercent: 125 });
    const { initializeDesktopZoom } = await import('./zoom');
    await initializeDesktopZoom();
    await initializeDesktopZoom();
    expect(setZoom).toHaveBeenCalledExactlyOnceWith(1.25);
    desktopSettings.update({ trayIcon: 'dark' });
    await vi.waitFor(() => expect(setZoom).toHaveBeenCalledTimes(1));
    desktopSettings.update({ zoomPercent: 150 });
    await vi.waitFor(() => expect(setZoom).toHaveBeenLastCalledWith(1.5));
    resetDesktopAppearance();
    await vi.waitFor(() => expect(setZoom).toHaveBeenLastCalledWith(1));
  });

  it('recovers from native failures for subsequent changes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setZoom.mockRejectedValueOnce(new Error('Unavailable'));
    const { desktopSettings } = await import('./settings');
    const { initializeDesktopZoom } = await import('./zoom');
    await initializeDesktopZoom();
    desktopSettings.update({ zoomPercent: 120 });
    await vi.waitFor(() => expect(setZoom).toHaveBeenLastCalledWith(1.2));
  });

  it('preserves the fixed mini player layout', async () => {
    native.label = 'mini-player';
    const { initializeDesktopZoom } = await import('./zoom');
    await initializeDesktopZoom();
    expect(setZoom).not.toHaveBeenCalled();
  });

  it('bounds persisted zoom and preserves it when Tracks is reset', async () => {
    const { normalizeDesktopSettings, desktopSettings, resetDesktopTracks } = await import('./settings');
    for (const value of [undefined, '125', NaN, Infinity]) {
      expect(normalizeDesktopSettings({ zoomPercent: value }).zoomPercent).toBe(100);
    }
    expect(normalizeDesktopSettings({ zoomPercent: 0 }).zoomPercent).toBe(50);
    expect(normalizeDesktopSettings({ zoomPercent: 999 }).zoomPercent).toBe(200);
    desktopSettings.update({ zoomPercent: 125 });
    resetDesktopTracks();
    expect(desktopSettings.getSnapshot().zoomPercent).toBe(125);
  });
});
