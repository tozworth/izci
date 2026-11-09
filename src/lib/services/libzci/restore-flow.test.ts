import { describe, expect, it } from 'vitest';
import { CoreSourceRegistry } from './source-registry';
import { planRestoredPlayback } from './restore-flow';
import type { QueueLoadLike } from './source-registry';

function loadFor(key: string, displayPath: string): QueueLoadLike {
  return {
    occurrence: 1,
    source: { key, kind: 'ephemeral', locator: key, display_path: displayPath },
    position_seconds: 2,
    subsong: null,
    autoplay: true
  };
}

describe('restore flow planning', () => {
  it('selects a track when there is no load or the kind is unsupported', () => {
    const registry = new CoreSourceRegistry();
    expect(planRestoredPlayback(null, registry, '')).toEqual({ action: 'select-track' });
    registry.register('img', new File(['image'], 'photo.webp'));
    expect(planRestoredPlayback(loadFor('img', 'photo.webp'), registry, 'granted')).toEqual({
      action: 'select-track'
    });
  });

  it('plays when the file resolves and access is granted', () => {
    const registry = new CoreSourceRegistry();
    const file = new File(['audio'], 'one.mp3');
    registry.register('svelte/a', file);
    const plan = planRestoredPlayback(loadFor('svelte/a', '/music/one.mp3'), registry, 'granted');
    expect(plan).toEqual({
      action: 'play',
      file,
      occurrence: 1,
      positionSeconds: 2,
      subsong: null,
      autoplay: true
    });
  });

  it('maps missing files and access states to retry actions', () => {
    const registry = new CoreSourceRegistry();
    expect(planRestoredPlayback(loadFor('missing', '/music/gone.mp3'), registry, 'checking')).toEqual({
      action: 'wait'
    });
    expect(
      planRestoredPlayback(loadFor('missing', '/music/gone.mp3'), registry, 'non-restorable: gone')
    ).toEqual({ action: 're-add' });
    expect(planRestoredPlayback(loadFor('missing', '/music/gone.mp3'), registry, '')).toEqual({
      action: 'grant-and-retry'
    });
  });

  it('waits for granted access even when the file resolves', () => {
    const registry = new CoreSourceRegistry();
    const file = new File(['audio'], 'one.mp3');
    registry.register('svelte/a', file);
    // The worker has not published `granted` yet; retry after the next snapshot.
    expect(planRestoredPlayback(loadFor('svelte/a', '/music/one.mp3'), registry, 'checking')).toEqual({
      action: 'wait'
    });
  });
});
