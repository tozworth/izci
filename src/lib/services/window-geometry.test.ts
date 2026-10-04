import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyBrowserWindowBounds, readBrowserWindowGeometry } from './window-geometry';

describe('browser window sizing', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('retains browser move/resize behavior and screen geometry', () => {
    const browser = {
      innerWidth: 500, innerHeight: 300, outerWidth: 516, outerHeight: 338,
      screenX: -600, screenY: 50,
      screen: { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, availLeft: -1920, availTop: 0 },
      moveTo: vi.fn(), resizeTo: vi.fn()
    };
    vi.stubGlobal('window', browser);
    expect(readBrowserWindowGeometry()).toMatchObject({
      innerWidth: 500, outerWidth: 516, screenX: -600, screen: browser.screen
    });
    applyBrowserWindowBounds({ left: -1280, top: 50, width: 1280, height: 800 });
    expect(browser.moveTo).toHaveBeenCalledWith(-1280, 50);
    expect(browser.resizeTo).toHaveBeenCalledWith(1280, 800);
  });
});
