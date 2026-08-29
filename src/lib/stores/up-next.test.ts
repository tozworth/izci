import { beforeEach, describe, expect, it } from 'vitest';
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
// Same identity as trackA (same path), but a distinct queue id.
const trackA2 = makeItem('a2', '/music/a.mp3');

function queueIds(): string[] {
  return upNext.getIds();
}

describe('playback queue', () => {
  beforeEach(() => {
    // upNext is a module-level singleton; clear() is its reset mechanism.
    upNext.clear();
  });

  it('adds to the end by default and peeks the front without consuming', () => {
    upNext.add([trackA, trackB], 'end');

    expect(queueIds()).toEqual(['a', 'b']);
    expect(upNext.peek()?.id).toBe('a');
    expect(queueIds()).toEqual(['a', 'b']);
  });

  it('adds to the front while preserving the added order before existing entries', () => {
    upNext.add([trackA], 'end');
    upNext.add([trackC, trackB], 'front');

    expect(queueIds()).toEqual(['c', 'b', 'a']);
  });

  it('ignores empty adds', () => {
    upNext.add([], 'end');

    expect(queueIds()).toEqual([]);
  });

  it('removes every entry for a given id', () => {
    upNext.add([trackB, trackA, trackB], 'end');

    upNext.remove(['b']);

    expect(queueIds()).toEqual(['a']);
  });

  it('removes only the first entry when removing by id once', () => {
    upNext.add([trackB, trackB], 'end');

    upNext.removeFirstById('b');

    expect(queueIds()).toEqual(['b']);
  });

  it('removes all copies whose identity matches a played track', () => {
    upNext.add([trackA, trackB, trackA2], 'end');

    upNext.removeByIdentity(getFavoriteIdentity(trackA));

    expect(queueIds()).toEqual(['b']);
  });

  it('prunes entries whose queue ids no longer exist', () => {
    upNext.add([trackA, trackB, trackC], 'end');

    upNext.prune(new Set(['a']));

    expect(queueIds()).toEqual(['a']);
  });

  it('clears the queue', () => {
    upNext.add([trackA, trackB], 'end');

    upNext.clear();

    expect(queueIds()).toEqual([]);
    expect(upNext.peek()).toBeNull();
  });
});
