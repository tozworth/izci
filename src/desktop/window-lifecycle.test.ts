import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

describe('desktop window lifecycle', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.useFakeTimers();
    invoke.mockResolvedValue(undefined);
    vi.stubGlobal('window', {
      setTimeout, clearTimeout,
      requestAnimationFrame: vi.fn(),
      location: { origin: 'https://tauri.localhost' },
      opener: { postMessage: vi.fn() }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('releases a mounted window even when hidden WebView2 throttles frames', async () => {
    const { initializeDesktopWindow } = await import('./window-lifecycle');
    const ready = initializeDesktopWindow();
    await vi.advanceTimersByTimeAsync(99);
    expect(invoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await ready;
    expect(invoke).toHaveBeenCalledWith('desktop_window_ready');
    expect(window.opener.postMessage).toHaveBeenCalledWith(
      { type: 'izci:popup-ready' }, 'https://tauri.localhost'
    );
  });

  it('presents already loaded windows through the native shell', async () => {
    const { presentDesktopPopup } = await import('./window-lifecycle');
    expect(presentDesktopPopup('/options.html')).toBe(true);
    expect(invoke).toHaveBeenCalledWith('present_desktop_popup', { path: '/options.html' });
  });

  it('shares native font enumeration across repeated settings mounts', async () => {
    invoke.mockResolvedValue(['Segoe UI', 'Consolas']);
    const { queryDesktopFontFamilies } = await import('./window-lifecycle');
    const fonts = await Promise.all([queryDesktopFontFamilies(), queryDesktopFontFamilies()]);
    expect(fonts).toEqual([['Segoe UI', 'Consolas'], ['Segoe UI', 'Consolas']]);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('local_font_families');
  });

  it('allows native font enumeration to be retried after a failure', async () => {
    invoke.mockRejectedValueOnce(new Error('Font enumeration failed'));
    const { queryDesktopFontFamilies } = await import('./window-lifecycle');
    await expect(queryDesktopFontFamilies()).rejects.toThrow('Font enumeration failed');
    invoke.mockResolvedValue(['Segoe UI']);
    await expect(queryDesktopFontFamilies()).resolves.toEqual(['Segoe UI']);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});
