import { describe, expect, it } from 'vitest';
import { CoreSourceRegistry, type QueueLoadLike } from './source-registry';
import { describeQueueLoadIssue, resolveQueuePlayback } from './queue-playback';

function loadFor(key: string, displayPath: string, overrides: Partial<QueueLoadLike> = {}): QueueLoadLike {
  return {
    occurrence: 1,
    source: { key, kind: 'ephemeral', locator: key, display_path: displayPath },
    position_seconds: 12.5,
    subsong: null,
    autoplay: true,
    ...overrides
  };
}

describe('queue load to playback resolution', () => {
  it('resolves ephemeral files with inferred kinds', () => {
    const registry = new CoreSourceRegistry();
    const file = new File(['audio'], 'one.mp3');
    registry.register('svelte/a', file);
    const resolved = resolveQueuePlayback(loadFor('svelte/a', '/music/one.mp3'), registry);
    expect(resolved).toMatchObject({
      occurrence: 1,
      positionSeconds: 12.5,
      subsong: null,
      autoplay: true,
      displayPath: '/music/one.mp3',
      extension: 'mp3',
      kind: 'stream'
    });
    expect(resolved?.file).toBe(file);
    expect(describeQueueLoadIssue(loadFor('svelte/a', '/music/one.mp3'), registry)).toBeNull();
  });

  it('reports access-required when the live file is missing', () => {
    const registry = new CoreSourceRegistry();
    const load = loadFor('missing', '/music/gone.mp3');
    expect(resolveQueuePlayback(load, registry)).toBeNull();
    expect(describeQueueLoadIssue(load, registry)).toBe('access-required');
  });

  it('reports unsupported kinds including images', () => {
    const registry = new CoreSourceRegistry();
    registry.register('img', new File(['image'], 'photo.webp'));
    const load = loadFor('img', 'photo.webp');
    expect(resolveQueuePlayback(load, registry)?.kind).toBe('image');
    expect(describeQueueLoadIssue(load, registry)).toBe('unsupported');

    registry.register('weird', new File(['data'], 'file.bogus'));
    expect(describeQueueLoadIssue(loadFor('weird', 'file.bogus'), registry)).toBe('unsupported');
  });

  it('normalizes positions and subsongs defensively', () => {
    const registry = new CoreSourceRegistry();
    registry.register('s', new File(['audio'], 'track.ogg'));
    const resolved = resolveQueuePlayback(
      loadFor('s', 'track.ogg', { position_seconds: Number.NaN, subsong: -1 }),
      registry
    );
    expect(resolved?.positionSeconds).toBe(0);
    expect(resolved?.subsong).toBeNull();
  });
});
