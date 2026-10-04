import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { createThumbnailPresentation } from './thumbnail-presentation';

afterEach(() => vi.unstubAllGlobals());
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const rendition = { blob: new Blob(['image']), width: 160, height: 90 };

describe('thumbnail presentation lifecycle', () => {
  it('publishes dimensions and releases the transient object URL on destruction', async () => {
    const createObjectURL = vi.fn(() => 'blob:thumbnail');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const resolved = vi.fn();
    const thumbnail = createThumbnailPresentation(async () => rendition, resolved);
    thumbnail.observe(null);
    await flush();
    expect(get(thumbnail)).toEqual({ url: 'blob:thumbnail', aspectRatio: 16 / 9 });
    expect(resolved).toHaveBeenCalledWith(true);
    thumbnail.destroy();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:thumbnail');
  });

  it('does not publish or create URLs after an in-flight component is destroyed', async () => {
    let finish!: (value: typeof rendition) => void;
    const createObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL });
    const thumbnail = createThumbnailPresentation(() => new Promise((resolve) => { finish = resolve; }));
    thumbnail.observe(null);
    await Promise.resolve();
    thumbnail.destroy();
    finish(rendition);
    await flush();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(get(thumbnail).url).toBeNull();
  });

  it('waits until near the viewport and cancels pending work on destruction', async () => {
    let visibility!: IntersectionObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { visibility = callback; }
      observe() {}
      disconnect = disconnect;
    });
    const load = vi.fn(async () => null);
    const thumbnail = createThumbnailPresentation(load);
    thumbnail.observe({} as HTMLElement);
    await flush();
    expect(load).not.toHaveBeenCalled();
    visibility([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    thumbnail.destroy();
    await flush();
    expect(load).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
  });
});
