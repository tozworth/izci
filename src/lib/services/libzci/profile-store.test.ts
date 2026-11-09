import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { createCoreProfileStore } from './profile-store';
import type { OwnerOutgoingMessage } from './owner-client';

describe('core profile store', () => {
  it('wires snapshots and queries through shared facades', async () => {
    const posted: OwnerOutgoingMessage[] = [];
    const errors: Error[] = [];
    const store = createCoreProfileStore({
      post: (message) => posted.push(message),
      onError: (error) => errors.push(error)
    });
    expect(store.client.pending).toBe(0);
    expect(get(store.queueFacade.view)).toBeNull();
    expect(get(store.catalogFacade.view)).toBeNull();

    store.client.handleMessage({
      type: 'snapshot',
      profile: {
        revision: 2,
        catalog_revision: 2,
        sources: [{ key: 'a', kind: 'browser_handle', locator: 'fs:a', display_path: '/music/one.mp3' }],
        queue: { items: [{ id: 1, source_key: 'a', subsong: null }], current: 1, up_next: [] },
        position_seconds: 0
      }
    });
    expect(get(store.queueFacade.revision)).toBe(2);
    expect(get(store.queueFacade.view)?.catalogRevision).toBe(2);

    const page = {
      revision: 3,
      total: 1,
      rows: [
        {
          id: 1,
          kind: 'audio' as const,
          in_library: true,
          source: { key: 'a', kind: 'browser_handle' as const, locator: 'fs:a', display_path: '/music/one.mp3' },
          metadata: { title: 'One', artist: '', album: '', duration_seconds: null },
          facts: { favorite: false, rating: 0, play_count: 0, last_played_ms: null }
        }
      ]
    };
    const pending = store.client.queryCatalog(
      { collection: 'library', search: '', sort: 'title', descending: false, offset: 0, limit: 100 },
      'lib'
    );
    store.client.handleMessage({ type: 'result', request: posted[0].request, value: page });
    await expect(pending).resolves.toEqual(page);
    expect(get(store.catalogFacade.revision)).toBe(3);

    const file = new File(['audio'], 'one.mp3');
    store.registry.register('svelte/a', file);
    expect(store.registry.resolveLoad({ occurrence: 1, source: page.rows[0].source, position_seconds: 0, subsong: null, autoplay: false })).toBeNull();
    expect(
      store.registry.resolveLoad({ occurrence: 1, source: { key: 'svelte/a', kind: 'ephemeral', locator: 'svelte/a', display_path: 'one.mp3' }, position_seconds: 0, subsong: null, autoplay: false })
    ).toBe(file);
    expect(errors).toHaveLength(0);
  });
});
