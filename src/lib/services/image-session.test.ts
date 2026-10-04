import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackItem } from '$lib/types';
import { createImageSession } from './image-session';
import { buildLibraryGroups } from '$lib/components/track-list-panel/library-views';

function photo(id: string, folder = 'Photos/Trip'): TrackItem {
  return { id, name: `${id}.png`, extension: 'png', kind: 'image', path: `${folder}/${id}.png`, size: 1, lastModified: 1 };
}

function createSession(overrides: Parameters<typeof createImageSession>[0] = {}) {
  const revokeUrl = vi.fn();
  const session = createImageSession({
    resolveFile: vi.fn(async (item) => new File(['image'], item.name)),
    createUrl: vi.fn(async (file) => `blob:${file.name}`),
    revokeUrl,
    ...overrides
  });
  return { session, revokeUrl };
}

beforeEach(() => {
  vi.stubGlobal('Image', class extends EventTarget {
    naturalWidth = 800;
    naturalHeight = 600;
    set src(_url: string) { queueMicrotask(() => this.dispatchEvent(new Event('load'))); }
    removeAttribute() {}
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('independent image viewing', () => {
  it('captures the originating folder and ignores audio and other folders', async () => {
    const items = [photo('a'), photo('b'), photo('elsewhere', 'Photos/Home'), { ...photo('song'), kind: 'stream' as const }];
    const folder = buildLibraryGroups(items, 'folders').find((group) => group.label === 'Trip')!;
    const { session } = createSession();
    await session.open(items[0], folder.items);
    folder.items.splice(0);
    expect(session.getSnapshot().items.map((item) => item.id)).toEqual(['a', 'b']);
    await session.step(1);
    expect(session.getSnapshot().item?.id).toBe('b');
    await session.step(1);
    expect(session.getSnapshot().item?.id).toBe('b');
    await session.step(-1);
    expect(session.getSnapshot().item?.id).toBe('a');
    expect(session.getSnapshot().item?.metadata).toMatchObject({ width: 800, height: 600 });
    session.close();
  });

  it('can browse every image from the Images category and wrap independently', async () => {
    const items = [photo('a'), photo('b', 'Photos/Home'), photo('c', 'Photos/Other')];
    const { session } = createSession();
    await session.open(items[2], items);
    session.cycleRepeat();
    await session.step(1);
    expect(session.getSnapshot().item?.id).toBe('a');
    session.close();
  });

  it('shuffles only the captured images without repetitions and Previous follows history', async () => {
    const items = [photo('a'), photo('b'), photo('c'), photo('d')];
    const { session } = createSession();
    await session.open(items[0], items);
    session.toggleShuffle();
    const seen = ['a'];
    for (let index = 1; index < items.length; index += 1) {
      await session.step(1);
      seen.push(session.getSnapshot().item!.id);
    }
    expect(new Set(seen).size).toBe(4);
    await session.step(-1);
    expect(session.getSnapshot().item?.id).toBe(seen[2]);
    await session.step(1);
    expect(session.getSnapshot().item?.id).toBe(seen[3]);
    session.close();
  });

  it('owns and releases only its own URLs, leaving library URLs alone', async () => {
    const original = { ...photo('a'), objectUrl: 'blob:library' };
    const { session, revokeUrl } = createSession();
    await session.open(original, [original, photo('b')]);
    await session.step(1);
    session.close();
    expect(revokeUrl.mock.calls).toEqual([['blob:a.png'], ['blob:b.png']]);
    expect(session.getSnapshot()).toMatchObject({ item: null, element: null, items: [], state: 'idle' });
  });

  it('discards a late URL when another image opens or the viewer closes', async () => {
    let resolveUrl!: (url: string) => void;
    const pendingUrl = new Promise<string>((resolve) => { resolveUrl = resolve; });
    const { session, revokeUrl } = createSession({ createUrl: () => pendingUrl });
    const opening = session.open(photo('a'));
    await Promise.resolve();
    session.close();
    resolveUrl('blob:late');
    await opening;
    expect(revokeUrl).toHaveBeenCalledWith('blob:late');
    expect(session.getSnapshot().item).toBeNull();
  });

  it('contains access errors within the viewer and remains navigable', async () => {
    const { session } = createSession({ resolveFile: async (item) => item.id === 'bad' ? null : new File([], item.name) });
    await session.open(photo('bad'), [photo('bad'), photo('good')]);
    expect(session.getSnapshot().state).toBe('error');
    await session.step(1);
    expect(session.getSnapshot()).toMatchObject({ state: 'ready', error: undefined });
    session.close();
  });
});
