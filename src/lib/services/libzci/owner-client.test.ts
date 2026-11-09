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
    catalog_revision: revision,
    sources: [{ key: 'a', kind: 'browser_handle', locator: 'fs:a', display_path: '/music/one.mp3' }],
    queue: { items: [{ id: 1, source_key: 'a', subsong: null }], current: 1, up_next: [] },
    position_seconds: 0
  };
}

describe('core owner client', () => {
  it('tracks access and scan observations from snapshots', () => {
    const scans: unknown[] = [];
    const scanClient = new CoreOwnerClient({ post: () => undefined, onScan: (scan) => scans.push(scan) });
    expect(scanClient.scan).toBeNull();
    scanClient.handleMessage({ type: 'snapshot', profile: profile(1) });
    expect(scanClient.scan).toBeNull();
    expect(scans).toHaveLength(0);
    const observation = { state: 'scanning' as const, root: 3, visited: 10, accepted: 2, ignored: 1, detail: 'run' };
    scanClient.handleMessage({ type: 'snapshot', profile: profile(2), scan: observation });
    expect(scanClient.scan).toEqual(observation);
    expect(scans).toEqual([observation]);
    expect(() =>
      scanClient.handleMessage({ type: 'snapshot', profile: profile(3), scan: { ...observation, state: 'bogus' as never } })
    ).toThrow();
  });

  it('tracks access strings from snapshots', () => {
    const accesses: string[] = [];
    const client = new CoreOwnerClient({
      post: () => undefined,
      onAccess: (access) => accesses.push(access)
    });
    expect(client.access).toBe('');
    client.handleMessage({ type: 'snapshot', profile: profile(1) });
    expect(client.access).toBe('');
    expect(accesses).toHaveLength(0);
    client.handleMessage({ type: 'snapshot', profile: profile(2), access: 'checking' });
    expect(client.access).toBe('checking');
    client.handleMessage({ type: 'snapshot', profile: profile(3), access: 'granted' });
    expect(client.access).toBe('granted');
    expect(accesses).toEqual(['checking', 'granted']);
  });

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
    expect((posted[0] as { request: string }).request.endsWith('/test')).toBe(true);
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
      request: (posted[0] as { request: string }).request,
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
    client.handleMessage({ type: 'result', request: (posted[0] as { request: string }).request, error: 'queue full' });
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
    expect((posted[0] as { request: string }).request.endsWith('/fav')).toBe(true);
    expect(client.pending).toBe(1);

    client.handleMessage({
      type: 'result',
      request: (posted[0] as { request: string }).request,
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
    client.handleMessage({ type: 'result', request: (posted[0] as { request: string }).request, value: page });
    await expect(pending).resolves.toEqual(page);
    expect(get(catalogFacade.revision)).toBe(21);
    expect(get(catalogFacade.view)?.rows[0].rating).toBe(4);

    // Late pages with stale revisions stay harmless through the facade guard.
    const stale = client.queryCatalog({ collection: 'library', search: '', sort: 'title', descending: false, offset: 0, limit: 100 }, 'stale');
    client.handleMessage({ type: 'result', request: (posted[1] as { request: string }).request, value: { ...page, revision: 20, total: 99 } });
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
    client.handleMessage({ type: 'result', request: (posted[0] as { request: string }).request, value: page });
    await expect(pending).resolves.toEqual(page);

    const invalid = client.queryGroups(
      'album',
      { collection: 'library', search: '', sort: 'title', descending: false, offset: 0, limit: 100 },
      'bad'
    );
    client.handleMessage({
      type: 'result',
      request: (posted[1] as { request: string }).request,
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
      request: (posted[0] as { request: string }).request,
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
      request: (posted[1] as { request: string }).request,
      value: [{ id: 0, media: 7, subsong: null, position_seconds: 1, label: 'x' }]
    });
    await expect(invalid).rejects.toThrow();
  });

  it('queries image sequences with validation', async () => {
    const posted: OwnerOutgoingMessage[] = [];
    const client = new CoreOwnerClient({ post: (message) => posted.push(message) });
    const query = { collection: 'all' as const, search: '', sort: 'title' as const, descending: false, offset: 0, limit: 100 };
    const pending = client.queryImageSequence(query, 'images');
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('image_sequence');
    const sequence = { revision: 55, media: [5, 6, 7] };
    client.handleMessage({ type: 'result', request: (posted[0] as { request: string }).request, value: sequence });
    await expect(pending).resolves.toEqual(sequence);

    const invalid = client.queryImageSequence(query, 'bad-images');
    client.handleMessage({ type: 'result', request: (posted[1] as { request: string }).request, value: { revision: 1, media: [] } });
    await expect(invalid).rejects.toThrow();
  });

  it('queries roots and begins scans with validation', async () => {
    const posted: OwnerOutgoingMessage[] = [];
    const client = new CoreOwnerClient({ post: (message) => posted.push(message) });
    const source = { key: 'cap/root', kind: 'browser_handle' as const, locator: 'cap/root', display_path: 'Music' };
    const root = {
      id: 3,
      revision: 5,
      config: {
        source,
        settings: { recursive: true, scan_on_launch: false, verify_unknown: true, probe_concurrency: 2 }
      }
    };
    const roots = client.queryRoots('list');
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('roots');
    client.handleMessage({ type: 'result', request: (posted[0] as { request: string }).request, value: [root] });
    await expect(roots).resolves.toEqual([root]);

    const plan = {
      token: 'scan-1-abc',
      root,
      max_batch: 256,
      max_entries: 100_000,
      max_bytes: 128 * 1024 * 1024,
      max_total_bytes: 256 * 1024 * 1024
    };
    const begun = client.beginScan(3, 'start');
    expect(posted[1].type).toBe('begin_scan');
    client.handleMessage({ type: 'result', request: (posted[1] as { request: string }).request, value: plan });
    await expect(begun).resolves.toEqual(plan);

    await expect(client.beginScan(0, 'bad')).rejects.toThrow();
    const invalid = client.beginScan(3, 'invalid-plan');
    client.handleMessage({ type: 'result', request: (posted[2] as { request: string }).request, value: { ...plan, token: '' } });
    await expect(invalid).rejects.toThrow();
  });

  it('cancels and finishes scans with validation', async () => {
    const posted: OwnerOutgoingMessage[] = [];
    const client = new CoreOwnerClient({ post: (message) => posted.push(message) });
    const cancelled = client.cancelScan('scan-1-abc', 'cancel');
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('cancel_scan');
    client.handleMessage({ type: 'result', request: (posted[0] as { request: string }).request, value: null });
    await expect(cancelled).resolves.toBeUndefined();

    const summary = { root: 3, entries: 10, added: 4, removed: 1 };
    const finished = client.finishScan('scan-1-abc', 'finish');
    expect(posted[1].type).toBe('finish_scan');
    client.handleMessage({ type: 'result', request: (posted[1] as { request: string }).request, value: summary });
    await expect(finished).resolves.toEqual(summary);

    await expect(client.cancelScan('', 'bad')).rejects.toThrow();
    const invalid = client.finishScan('scan-1-abc', 'invalid-summary');
    client.handleMessage({ type: 'result', request: (posted[2] as { request: string }).request, value: { ...summary, root: 0 } });
    await expect(invalid).rejects.toThrow();
  });

  it('ingests files through structured-clone posts', async () => {
    const posted: OwnerOutgoingMessage[] = [];
    const client = new CoreOwnerClient({ post: (message) => posted.push(message) });
    const files = [new File(['audio'], 'one.mp3')];
    const pending = client.ingest(files, [], true, 'pick');
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('ingest');
    const outcome = { duplicate: false, appended: [1], revision: 6, load: null, stop: false };
    client.handleMessage({ type: 'result', request: (posted[0] as { request: string }).request, value: outcome });
    await expect(pending).resolves.toEqual(outcome);

    await expect(client.ingest([], [], true, 'empty')).rejects.toThrow('1..10000');
  });

  it('restores the current queue load with validation', async () => {
    const posted: OwnerOutgoingMessage[] = [];
    const client = new CoreOwnerClient({ post: (message) => posted.push(message) });
    const load = {
      occurrence: 4,
      source: { key: 'svelte/a', kind: 'ephemeral' as const, locator: 'svelte/a', display_path: 'one.mp3' },
      position_seconds: 3,
      subsong: null,
      autoplay: false
    };
    const pending = client.restore('boot');
    expect(posted).toHaveLength(1);
    expect(posted[0].type).toBe('restore');
    client.handleMessage({ type: 'result', request: (posted[0] as { request: string }).request, value: load });
    await expect(pending).resolves.toEqual(load);

    const empty = client.restore('empty-boot');
    client.handleMessage({ type: 'result', request: (posted[1] as { request: string }).request, value: null });
    await expect(empty).resolves.toBeNull();

    const invalid = client.restore('bad-boot');
    client.handleMessage({
      type: 'result',
      request: (posted[2] as { request: string }).request,
      value: { ...load, occurrence: 0 }
    });
    await expect(invalid).rejects.toThrow();
  });

  it('attaches output and forwards context state', () => {
    const posted: OwnerOutgoingMessage[] = [];
    const client = new CoreOwnerClient({ post: (message) => posted.push(message) });
    const control = {};
    const decode = {};
    client.attach(control, decode, 48000, 128);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({ type: 'attach', control, decode, rate: 48000, latency: 128 });
    client.notifyContextState('suspended');
    expect(posted).toHaveLength(2);
    expect(posted[1]).toEqual({ type: 'context', state: 'suspended' });

    expect(() => client.attach(null, decode, 48000, 0)).toThrow();
    expect(() => client.attach(control, decode, 0, 0)).toThrow();
    expect(() => client.notifyContextState('bogus' as never)).toThrow();
  });
});
