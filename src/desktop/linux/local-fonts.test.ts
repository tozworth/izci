import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }));

import { localFonts } from './platform';

describe('Linux installed font access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('window', {});
    vi.stubGlobal('navigator', {});
  });
  afterEach(() => vi.unstubAllGlobals());

  it('enumerates installed families without browser font support or permissions', async () => {
    native.invoke.mockResolvedValue(['Noto Sans', ' DejaVu Sans ', '', 'Noto Sans']);

    expect(localFonts.supported()).toBe(true);
    await expect(localFonts.hasPermission()).resolves.toBe(true);
    await expect(localFonts.query()).resolves.toEqual(['DejaVu Sans', 'Noto Sans']);
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith('local_font_families');
  });
});
