import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { createCoreQueueFacade } from './queue-facade';
import type { CoreProfileQueueState } from './queue-snapshot';

function observation(revision: number): CoreProfileQueueState {
  return {
    revision,
    sources: [{ key: 'a', kind: 'browser_handle', locator: 'fs:a', display_path: '/music/one.mp3' }],
    queue: {
      items: [{ id: 1, source_key: 'a', subsong: null }],
      current: 1,
      up_next: []
    },
    position_seconds: revision
  };
}

describe('core queue facade', () => {
  it('starts empty and applies the first observation', () => {
    const facade = createCoreQueueFacade();
    expect(get(facade.view)).toBeNull();
    expect(get(facade.revision)).toBeNull();

    facade.pushObservation(observation(4));

    expect(get(facade.revision)).toBe(4);
    expect(get(facade.view)?.rows).toEqual([
      { occurrenceId: 1, title: '/music/one.mp3', restorable: true, subsong: null, isCurrent: true }
    ]);
  });

  it('ignores duplicate and out-of-order revisions', () => {
    const facade = createCoreQueueFacade();
    facade.pushObservation(observation(4));
    const applied = get(facade.view);

    facade.pushObservation(observation(4));
    expect(get(facade.view)).toBe(applied);

    facade.pushObservation(observation(3));
    expect(get(facade.revision)).toBe(4);
    expect(get(facade.view)).toBe(applied);
  });

  it('applies newer revisions', () => {
    const facade = createCoreQueueFacade();
    facade.pushObservation(observation(4));
    facade.pushObservation(observation(5));

    expect(get(facade.revision)).toBe(5);
    expect(get(facade.view)?.positionSeconds).toBe(5);
  });
});
