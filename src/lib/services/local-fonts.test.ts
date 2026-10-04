import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ desktop: true, queryDesktopFontFamilies: vi.fn() }));
vi.mock('../../desktop/window-lifecycle', () => ({ queryDesktopFontFamilies: platform.queryDesktopFontFamilies }));
vi.mock('$platform', async () => {
  const { localFonts: desktop } = await import('../../desktop/local-fonts');
  const { localFonts: pwa } = await import('../../platform/pwa/local-fonts');
  return { localFonts: { supported: () => (platform.desktop ? desktop : pwa).supported(),
    hasPermission: () => (platform.desktop ? desktop : pwa).hasPermission(),
    query: () => (platform.desktop ? desktop : pwa).query() } };
});

import { hasLocalFontAccessPermission, queryLocalFontFamilies, supportsLocalFontAccess } from './local-fonts';

describe('font access', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    platform.desktop = true;
    vi.stubGlobal('window', { queryLocalFonts: vi.fn() });
    vi.stubGlobal('navigator', { permissions: { query: vi.fn() } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('uses installed Windows families without invoking browser permission or font APIs', async () => {
    platform.queryDesktopFontFamilies.mockResolvedValue(['Segoe UI', ' Consolas ', '', 'Segoe UI']);
    expect(supportsLocalFontAccess()).toBe(true);
    await expect(hasLocalFontAccessPermission()).resolves.toBe(true);
    await expect(queryLocalFontFamilies()).resolves.toEqual(['Consolas', 'Segoe UI']);
    expect(navigator.permissions.query).not.toHaveBeenCalled();
    expect((window as unknown as { queryLocalFonts: () => void }).queryLocalFonts).not.toHaveBeenCalled();
  });

  it('retains Chromium permission checks and enumeration in the PWA', async () => {
    platform.desktop = false;
    vi.mocked(navigator.permissions.query).mockResolvedValue({ state: 'granted' } as PermissionStatus);
    (window as unknown as { queryLocalFonts: ReturnType<typeof vi.fn> }).queryLocalFonts
      .mockResolvedValue([{ family: 'Segoe UI' }, { family: 'Consolas' }]);
    await expect(hasLocalFontAccessPermission()).resolves.toBe(true);
    await expect(queryLocalFontFamilies()).resolves.toEqual(['Consolas', 'Segoe UI']);
    expect(navigator.permissions.query).toHaveBeenCalledWith({ name: 'local-fonts' });
    expect(platform.queryDesktopFontFamilies).not.toHaveBeenCalled();
  });
});
