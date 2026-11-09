import { describe, expect, it } from 'vitest';
import { CoreSourceRegistry } from './source-registry';
import type { TrackItem } from '$lib/types';

function track(id: string, file?: File): TrackItem {
  return {
    id,
    name: `${id}.mp3`,
    extension: 'mp3',
    kind: 'stream',
    size: 1,
    lastModified: 1,
    ...(file ? { file } : {})
  };
}

describe('core source registry', () => {
  it('registers ephemeral files and resolves queue loads', () => {
    const registry = new CoreSourceRegistry();
    const file = new File(['audio'], 'one.mp3');
    const reference = registry.registerTrack(track('a', file));
    expect(reference.key).toBe('svelte/a');
    expect(registry.size).toBe(1);
    expect(
      registry.resolveLoad({
        occurrence: 1,
        source: reference,
        position_seconds: 0,
        subsong: null,
        autoplay: false
      })
    ).toBe(file);
  });

  it('keeps handle-only tracks resolvable only through capabilities', () => {
    const registry = new CoreSourceRegistry();
    const reference = registry.registerTrack({
      ...track('b'),
      fileHandle: {} as FileSystemFileHandle
    });
    // No File was supplied, so the load needs the future owner worker.
    expect(registry.has(reference.key)).toBe(false);
    expect(
      registry.resolveLoad({
        occurrence: 2,
        source: reference,
        position_seconds: 0,
        subsong: null,
        autoplay: false
      })
    ).toBeNull();
  });

  it('retains only core-referenced keys', () => {
    const registry = new CoreSourceRegistry();
    registry.register('k1', new File(['a'], 'a.mp3'));
    registry.register('k2', new File(['b'], 'b.mp3'));
    registry.retain(new Set(['k2']));
    expect(registry.keys()).toEqual(['k2']);
    expect(registry.remove('k2')).toBe(true);
    expect(registry.size).toBe(0);
  });

  it('rejects invalid keys', () => {
    const registry = new CoreSourceRegistry();
    expect(() => registry.register('', new File(['a'], 'a.mp3'))).toThrow();
  });
});
