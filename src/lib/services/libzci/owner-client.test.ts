import { describe, expect, it, vi } from 'vitest';
import { CoreOwnerClient, OWNER_MAX_IN_FLIGHT, type OwnerOutgoingMessage } from './owner-client';
import { createCoreQueueFacade } from './queue-facade';
import { get } from 'svelte/store';
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
});
