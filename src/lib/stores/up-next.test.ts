import { describe, expect, it } from 'vitest';
import { getFavoriteIdentity } from '$lib/utils/files';
import type { TrackItem } from '$lib/types';
import { upNext } from './up-next';

function makeItem(id: string, path: string): TrackItem {
  return {
    id,
    name: `${id}.mp3`,
    path,
    size: 100,
    lastModified: 1,
    kind: 'stream',
    extension: 'mp3'
  };
}

const trackA = makeItem('a', '/music/a.mp3');
const trackB = makeItem('b', '/music/b.mp3');
const trackC = makeItem('c', '/music/c.mp3');

function queueIds(): string[] {
  return upNext.getIds();
}

describe('playback queue', () => {
  it('adds to the end by default and peeks the front without consuming', () => {
    upNext.add([trackA, trackB], 'end');

    expect(queueIds()).toEqual(['a', 'b']);
    expect(upNext.peek()?.id).toBe('a');
    expect(queueIds()).toEqual(['a', 'b']);
  });

  it('adds to the front while preserving selection order', () => {
    upNext.add([trackC, trackB], 'front');

    expect(queueIds()).toEqual(['c', 'b', 'a', 'b']);
  });

  it('removes every entry for a given id', () => {
    upNext.remove(['b']);

    expect(queueIds()).toEqual(['c', 'a']);
  });

  it('removes the first entry by id', () => {
    upNext.add([trackB, trackB], 'end');
    upNext.removeFirstById('b');

    expect(queueIds()).toEqual(['c', 'a', 'b']);
  });

  it('removes all copies whose identity matches a played track', () => {
    upNext.removeByIdentity(getFavoriteIdentity(trackB));

    expect(queueIds()).toEqual(['c', 'a']);
  });

  it('prunes entries whose queue ids no longer exist', () => {
    upNext.prune(new Set(['a']));

    expect(queueIds()).toEqual(['a']);
  });

  it('clears the queue', () => {
    upNext.clear();

    expect(queueIds()).toEqual([]);
    expect(upNext.peek()).toBeNull();
  });
});
