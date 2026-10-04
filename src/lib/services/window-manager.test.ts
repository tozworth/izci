import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({
  desktop: true, presentPlatformPopup: vi.fn(), exitPlatform: vi.fn()
}));
vi.mock('$platform', () => ({
  platformCapabilities: { get directPopupNavigation() { return platform.desktop; }, get warmOptionsWindow() { return platform.desktop; } },
  presentPlatformPopup: platform.presentPlatformPopup,
  exitPlatform: platform.exitPlatform
}));
vi.mock('$lib/services/options-window-state', () => ({
  getOptionsWindowState: () => ({ activeView: 'appearance', showAdvancedTweaks: false })
}));
vi.mock('$lib/services/popup-window-state', () => ({ getPopupWindowSize: () => ({}) }));
vi.mock('$lib/services/logging', () => ({ logDebug: vi.fn(), logInfo: vi.fn(), logWarning: vi.fn() }));
vi.mock('$lib/services/tool-track-context', () => ({ OPEN_CURRENT_TOOL_TRACK_MESSAGE: 'track' }));
vi.mock('$lib/services/troubadour-sync', () => ({ OPEN_TROUBADOUR_BATCH_CONTEXT_MESSAGE: 'batch' }));

describe('popup windows', () => {
  let popup: Window;
  let listeners: Map<string, EventListener>;

  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
    platform.desktop = true;
    platform.presentPlatformPopup.mockReturnValue(true);
    listeners = new Map();
    popup = {
      closed: false, close: vi.fn(), focus: vi.fn(), postMessage: vi.fn(),
      location: { pathname: '/options.html', search: '', replace: vi.fn() },
      document: { documentElement: { style: {} }, body: { style: {} } },
      requestAnimationFrame: (callback: FrameRequestCallback) => callback(0),
      setTimeout: (callback: () => void) => callback()
    } as unknown as Window;
    vi.stubGlobal('window', {
      open: vi.fn(() => popup),
      location: { href: 'https://tauri.localhost/index.html', origin: 'https://tauri.localhost', pathname: '/' },
      screen: { availWidth: 1920, availHeight: 1080 },
      outerWidth: 1120, outerHeight: 760, screenX: 50, screenY: 50,
      requestIdleCallback: vi.fn((callback: () => void) => callback()),
      addEventListener: vi.fn((name: string, callback: EventListener) => listeners.set(name, callback))
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('warms Options in a hidden direct navigation and reuses it without reloading', async () => {
    const { warmOptionsWindow, windowManager } = await import('./window-manager');
    warmOptionsWindow();
    warmOptionsWindow();
    expect(window.open).toHaveBeenCalledOnce();
    const openedUrl = new URL(vi.mocked(window.open).mock.calls[0][0] as string);
    expect(openedUrl.pathname).toBe('/options.html');
    expect(openedUrl.searchParams.has('desktop-prewarm')).toBe(true);
    expect(popup.focus).not.toHaveBeenCalled();
    windowManager.openOptions('playback');
    expect(window.open).toHaveBeenCalledOnce();
    expect(popup.location.replace).not.toHaveBeenCalled();
    expect(platform.presentPlatformPopup).toHaveBeenCalledWith('/options.html');
    expect(popup.postMessage).toHaveBeenCalledWith(
      { type: 'izci:open-options-view', view: 'playback' }, window.location.origin
    );
  });

  it('redelivers a view requested during warmup only to the expected ready window', async () => {
    const { warmOptionsWindow, windowManager } = await import('./window-manager');
    warmOptionsWindow();
    windowManager.openOptions('tracks');
    vi.mocked(popup.postMessage).mockClear();
    const ready = { origin: window.location.origin, source: popup, data: { type: 'izci:popup-ready' } };
    listeners.get('message')?.({ ...ready, source: {} } as unknown as Event);
    expect(popup.postMessage).not.toHaveBeenCalled();
    listeners.get('message')?.(ready as unknown as Event);
    expect(popup.postMessage).toHaveBeenCalledExactlyOnceWith(
      { type: 'izci:open-options-view', view: 'tracks' }, window.location.origin
    );
  });

  it('keeps the selected Troubadour Options page when reopening a retained window', async () => {
    const { windowManager } = await import('./window-manager');
    windowManager.openPopup('troubadourOptions');
    Object.assign(popup.location, { pathname: '/troubadour-options.html', search: '?view=metadata' });
    windowManager.openPopup('troubadourOptions');
    expect(window.open).toHaveBeenCalledOnce();
    expect(popup.location.replace).not.toHaveBeenCalled();
    expect(platform.presentPlatformPopup).toHaveBeenCalledWith('/troubadour-options.html');
  });

  it('preserves background priming and normal focus in browser popups', async () => {
    platform.desktop = false;
    platform.presentPlatformPopup.mockReturnValue(false);
    vi.stubGlobal('document', { documentElement: {} });
    vi.stubGlobal('getComputedStyle', () => ({ backgroundColor: '#18191b' }));
    const { warmOptionsWindow, windowManager } = await import('./window-manager');
    warmOptionsWindow();
    expect(window.open).not.toHaveBeenCalled();
    windowManager.openOptions();
    expect(vi.mocked(window.open).mock.calls[0][0]).toBe('');
    expect(popup.location.replace).toHaveBeenCalledWith('https://tauri.localhost/options.html');
    expect(popup.focus).toHaveBeenCalledOnce();
  });
});
