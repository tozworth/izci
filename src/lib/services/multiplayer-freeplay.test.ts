import { describe, expect, it } from 'vitest';
import type { PlaylistItem } from '$lib/types';
import { resolveFreeplayStep } from './multiplayer-freeplay';

function track(id: string): PlaylistItem {
  return {
    id,
    name: `${id}.mp3`,
    extension: 'mp3',
    kind: 'stream',
    size: 1,
    lastModified: 1
  };
}

describe('Freeplay navigation', () => {
  const tracks = [track('a'), track('b'), track('c')];

  it('steps and wraps independently within the browsed host collection', () => {
    expect(resolveFreeplayStep(tracks, 'a', 1, false)?.id).toBe('b');
    expect(resolveFreeplayStep(tracks, 'c', 1, false)?.id).toBe('a');
    expect(resolveFreeplayStep(tracks, 'a', -1, false)?.id).toBe('c');
  });

  it('uses a different track for shuffle when alternatives exist', () => {
    expect(resolveFreeplayStep(tracks, 'b', 1, true, () => 0)?.id).toBe('c');
    expect(resolveFreeplayStep(tracks, 'b', 1, true, () => 0.99)?.id).toBe('a');
  });
});
