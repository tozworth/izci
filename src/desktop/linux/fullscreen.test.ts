import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => native);

import { platformFullscreen } from './fullscreen';

describe('Linux Oda fullscreen', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('enters and exits natively without a document or DOM user gesture', async () => {
    native.invoke.mockResolvedValue(undefined);
    expect(await platformFullscreen.enter()).toBe(true);
    expect(native.invoke).toHaveBeenLastCalledWith('set_desktop_fullscreen', { enabled: true });
    expect(await platformFullscreen.exit()).toBe(true);
    expect(native.invoke).toHaveBeenLastCalledWith('set_desktop_fullscreen', { enabled: false });
  });

  it('reads actual native fullscreen for Oda entry and restoration', async () => {
    native.invoke.mockResolvedValueOnce(true);
    expect(await platformFullscreen.isFullscreen()).toBe(true);
    expect(native.invoke).toHaveBeenCalledWith('read_desktop_fullscreen');
  });

  it('releases DOM fullscreen started during Oda before returning windowed', async () => {
    const exitFullscreen = vi.fn(async () => undefined);
    vi.stubGlobal('document', { fullscreenElement: {}, exitFullscreen });
    native.invoke.mockResolvedValue(undefined);
    expect(await platformFullscreen.exit()).toBe(true);
    expect(exitFullscreen).toHaveBeenCalledOnce();
    expect(native.invoke).toHaveBeenCalledWith('set_desktop_fullscreen', { enabled: false });
    expect(exitFullscreen.mock.invocationCallOrder[0]).toBeLessThan(native.invoke.mock.invocationCallOrder[0]);
  });

  it('does not leave a DOM session active if its exit is refused', async () => {
    vi.stubGlobal('document', { fullscreenElement: {}, exitFullscreen: vi.fn(async () => { throw new Error('denied'); }) });
    expect(await platformFullscreen.exit()).toBe(false);
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it('reports native fullscreen refusal without throwing', async () => {
    native.invoke.mockRejectedValue(new Error('denied'));
    expect(await platformFullscreen.enter()).toBe(false);
    expect(await platformFullscreen.exit()).toBe(false);
  });
});
