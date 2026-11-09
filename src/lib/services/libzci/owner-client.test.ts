import { describe, expect, it, vi } from 'vitest';
import { CoreOwnerClient, OWNER_MAX_IN_FLIGHT, type OwnerOutgoingMessage } from './owner-client';
import { createCoreCatalogFacade } from './catalog-facade';
import { createCoreQueueFacade } from './queue-facade';
import { get } from 'svelte/store';
import type { CoreCatalogPage } from './catalog-snapshot';
import type { CoreProfileQueueState } from './queue-snapshot';

function profile(revision: number): CoreProfileQueueState {
  return {
    revision,
    sources: [{ key: 'a', kind: 'browser_handle', locator: 'fs:a', display_path: '/music/one.mp3' }],
    queue: { items: [{ id: 1, source_key: 'a', subsong: null }], current: 1, up_next: [] },
    position_seconds: 0
  };
}

describe('core owner client', () => {
  it('multiplexes queue results and feeds the facade from snapshots', async () => {
    const posted: OwnerOutgoingMessage[] = [];
    const facade = createCoreQueueFacade();
    const errors: Error[] = [];
    const client = new CoreOwnerClient({
      post: (message) => posted.push(message),
      queueFacade: facade,
      onError: (error) => errors.push(error)
    });

    const pending = client.queue({ kind: 'clear_up_next' }, 'test');
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('queue');
    expect(posted[0].request.endsWith('/test')).toBe(true);
    expect(client.pending).toBe(1);

    // Snapshots apply through the facade revision guard.
    client.handleMessage({ type: 'snapshot', profile: profile(4) });
    expect(get(facade.revision)).toBe(4);
    client.handleMessage({ type: 'snapshot', profile: profile(3) });
    expect(get(facade.revision)).toBe(4);

    // Unknown result ids stay harmless; the pending request is unaffected.
    client.handleMessage({ type: 'result', request: 'stale', value: null });
    expect(client.pending).toBe(1);

    client.handleMessage({
      type: 'result',
      request: posted[0].request,
      value: { duplicate: false, appended: [], revision: 5, load: null, stop: false }
    });
    await expect(pending).resolves.toEqual({
      duplicate: false,
      appended: [],
      revision: 5,
      load: null,
      stop: false
    });
    expect(client.pending).toBe(0);

    client.handleMessage({ type: 'error', detail: 'owner hiccup' });
    expect(errors).toHaveLength(1);
  });

  it('rejects results with errors and enforces the in-flight budget', async () => {
    const posted: OwnerOutgoingMessage[] = [];
    const client = new CoreOwnerClient({ post: (message) => posted.push(message) });
    const failing = client.queue({ kind: 'clear_up_next' }, 'fail');
    client.handleMessage({ type: 'result', request: posted[0].request, error: 'queue full' });
    await expect(failing).rejects.toThrow('queue full');

    // Fill the budget with never-resolved requests, then overflow once.
    const pendings: Array<Promise<unknown>> = [];
    for (let index = 0; index < OWNER_MAX_IN_FLIGHT; index += 1) {
      pendings.push(client.queue({ kind: 'clear_up_next' }, `fill-${index}`).catch(() => null));
    }
    expect(client.pending).toBe(OWNER_MAX_IN_FLIGHT);
    expect(() => client.queue({ kind: 'clear_up_next' }, 'overflow')).toThrow(
      'Owner request budget exhausted'
    );
    client.close('owner lost');
    await Promise.all(pendings);
    expect(client.pending).toBe(0);
  });

  it('rejects all outstanding requests on close', async () => {
    const posted: OwnerOutgoingMessage[] = [];
    const client = new CoreOwnerClient({ post: (message) => posted.push(message) });
    const first = client.queue({ kind: 'clear_up_next' }, 'a');
    const second = client.queue({ kind: 'clear_up_next' }, 'b');
    expect(client.pending).toBe(2);
    client.close('owner lost');
    await expect(first).rejects.toThrow('owner lost');
    await expect(second).rejects.toThrow('owner lost');
    expect(client.pending).toBe(0);
    expect(vi.fn()).toBeDefined();
  });

  it('multiplexes catalog mutations through the shared budget', async () => {
    const posted: OwnerOutgoingMessage[] = [];
    const client = new CoreOwnerClient({ post: (message) => posted.push(message) });
    const pending = client.catalog({ kind: 'favorite', media: 7, subsong: null, favorite: true }, 'fav');
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('catalog');
    expect(posted[0].request.endsWith('/fav')).toBe(true);
    expect(client.pending).toBe(1);

    client.handleMessage({
      type: 'result',
      request: posted[0].request,
      value: { duplicate: false, revision: 9, media: [7], bookmark: null, root: null, scan: null }
    });
    await expect(pending).resolves.toEqual({
      duplicate: false,
      revision: 9,
      media: [7],
      bookmark: null,
      root: null,
      scan: null
    });

    // Queue and catalog share the 32-request budget.
    const pendings: Array<Promise<unknown>> = [];
    for (let index = 0; index < OWNER_MAX_IN_FLIGHT; index += 1) {
      const command =
        index % 2 === 0
          ? client.queue({ kind: 'clear_up_next' }, `q-${index}`)
          : client.catalog({ kind: 'remove', media: [index + 1] }, `c-${index}`);
      pendings.push(command.catch(() => null));
    }
    expect(client.pending).toBe(OWNER_MAX_IN_FLIGHT);
    expect(() => client.catalog({ kind: 'remove', media: [1] }, 'overflow')).toThrow(
      'Owner request budget exhausted'
    );
    client.close('owner lost');
    await Promise.all(pendings);
    expect(client.pending).toBe(0);
  });

  it('queries catalog pages into the catalog facade', async () => {
    const posted: OwnerOutgoingMessage[] = [];
    const catalogFacade = createCoreCatalogFacade();
    const client = new CoreOwnerClient({
      post: (message) => posted.push(message),
      catalogFacade
    });
    const page: CoreCatalogPage = {
      revision: 21,
      total: 1,
      rows: [
        {
          id: 1,
          kind: 'audio',
          in_library: true,
          source: { key: 'a', kind: 'browser_handle', locator: 'fs:a', display_path: '/music/one.mp3' },
          metadata: { title: 'One', artist: 'Artist', album: 'Album', duration_seconds: 180 },
          facts: { favorite: true, rating: 8, play_count: 2, last_played_ms: null }
        }
      ]
    };
    const pending = client.queryCatalog({ collection: 'library', search: '', sort: 'title', descending: false, offset: 0, limit: 100 }, 'lib');
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('catalog_query');
    client.handleMessage({ type: 'result', request: posted[0].request, value: page });
    await expect(pending).resolves.toEqual(page);
    expect(get(catalogFacade.revision)).toBe(21);
    expect(get(catalogFacade.view)?.rows[0].rating).toBe(4);

    // Late pages with stale revisions stay harmless through the facade guard.
    const stale = client.queryCatalog({ collection: 'library', search: '', sort: 'title', descending: false, offset: 0, limit: 100 }, 'stale');
    client.handleMessage({ type: 'result', request: posted[1].request, value: { ...page, revision: 20, total: 99 } });
    await stale;
    expect(get(catalogFacade.revision)).toBe(21);
    expect(get(catalogFacade.view)?.total).toBe(1);
  });

  it('queries catalog groups with validation', async () => {
    const posted: OwnerOutgoingMessage[] = [];
    const client = new CoreOwnerClient({ post: (message) => posted.push(message) });
    const pending = client.queryGroups(
      'artist',
      { collection: 'library', search: '', sort: 'title', descending: false, offset: 0, limit: 100 },
      'groups'
    );
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('catalog_groups');
    const page = { revision: 41, total: 1, groups: [{ key: ['Artist A'], count: 12 }] };
    client.handleMessage({ type: 'result', request: posted[0].request, value: page });
    await expect(pending).resolves.toEqual(page);

    const invalid = client.queryGroups(
      'album',
      { collection: 'library', search: '', sort: 'title', descending: false, offset: 0, limit: 100 },
      'bad'
    );
    client.handleMessage({
      type: 'result',
      request: posted[1].request,
      value: { revision: -1, total: 0, groups: [] }
    });
    await expect(invalid).rejects.toThrow();
  });

  it('queries bookmarks with validation and core ordering', async () => {
    const posted: OwnerOutgoingMessage[] = [];
    const client = new CoreOwnerClient({ post: (message) => posted.push(message) });
    const pending = client.queryBookmarks(7, null, 'marks');
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('bookmarks');
    client.handleMessage({
      type: 'result',
      request: posted[0].request,
      value: [
        { id: 9, media: 7, subsong: null, position_seconds: 20, label: 'B' },
        { id: 8, media: 7, subsong: null, position_seconds: 5, label: 'A' }
      ]
    });
    await expect(pending).resolves.toEqual([
      { id: 8, media: 7, subsong: null, position_seconds: 5, label: 'A' },
      { id: 9, media: 7, subsong: null, position_seconds: 20, label: 'B' }
    ]);

    await expect(client.queryBookmarks(0, null, 'bad')).rejects.toThrow();
    const invalid = client.queryBookmarks(7, null, 'invalid-rows');
    client.handleMessage({
      type: 'result',
      request: posted[1].request,
      value: [{ id: 0, media: 7, subsong: null, position_seconds: 1, label: 'x' }]
    });
    await expect(invalid).rejects.toThrow();
  });
});
