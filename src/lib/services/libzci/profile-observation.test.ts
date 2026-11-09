import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { createCoreProfileStore } from './profile-store';
import { observeCoreProfile } from './profile-observation';
import type { OwnerOutgoingMessage } from './owner-client';

describe('core profile observation', () => {
  it('combines facades, access, and scan into one store', async () => {
    const posted: OwnerOutgoingMessage[] = [];
    const store = createCoreProfileStore({ post: (message) => posted.push(message) });
    const observation = observeCoreProfile(store);
    expect(get(observation)).toEqual({
      queue: null,
      catalog: null,
      access: '',
      scan: { state: 'idle', root: null, visited: 0, accepted: 0, ignored: 0, detail: '' }
    });

    store.client.handleMessage({
      type: 'snapshot',
      profile: {
        revision: 2,
        catalog_revision: 2,
        sources: [{ key: 'a', kind: 'browser_handle', locator: 'fs:a', display_path: '/music/one.mp3' }],
        queue: { items: [{ id: 1, source_key: 'a', subsong: null }], current: 1, up_next: [] },
        position_seconds: 0
      },
      access: 'granted',
      scan: { state: 'scanning', root: 3, visited: 8, accepted: 1, ignored: 0, detail: 'run' }
    });
    expect(get(observation).access).toBe('granted');
    expect(get(observation).queue?.revision).toBe(2);
    expect(get(observation).scan.state).toBe('scanning');

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
    store.client.handleMessage({ type: 'result', request: (posted[0] as { request: string }).request, value: page });
    await pending;
    expect(get(observation).catalog?.revision).toBe(3);
  });
});
