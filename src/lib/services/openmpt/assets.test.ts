import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('local WASM assets', () => {
  it('shares successful bytes across players and retries failed requests', async () => {
    vi.resetModules();
    const bytes = new ArrayBuffer(4);
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => bytes });
    vi.stubGlobal('fetch', fetch);
    const { loadOpenMptBytes } = await import('./assets');
    await expect(loadOpenMptBytes()).rejects.toThrow('404');
    const first = loadOpenMptBytes();
    const second = loadOpenMptBytes();
    expect(first).toBe(second);
    expect(await first).toBe(bytes);
    expect(await loadOpenMptBytes()).toBe(bytes);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('aborts stalled fetches so a later player can retry', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const fetch = vi.fn((_url, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    vi.stubGlobal('fetch', fetch);
    const { loadOpenMptBytes } = await import('./assets');
    const pending = loadOpenMptBytes();
    const failed = expect(pending).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
    const next = loadOpenMptBytes();
    const retried = expect(next).rejects.toThrow('aborted');
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(10_000);
    await retried;
  });
});
