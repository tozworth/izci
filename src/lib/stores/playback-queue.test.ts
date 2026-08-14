import { describe, expect, it } from 'vitest';
import { getFavoriteIdentity } from '$lib/utils/files';
import type { PlaylistItem } from '$lib/types';
import { playbackQueue } from './playback-queue';

function makeItem(id: string, path: string): PlaylistItem {
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
  return playbackQueue.getIds();
}

describe('playback queue', () => {
  it('adds to the end by default and peeks the front without consuming', () => {
    playbackQueue.add([trackA, trackB], 'end');

    expect(queueIds()).toEqual(['a', 'b']);
    expect(playbackQueue.peek()?.id).toBe('a');
    expect(queueIds()).toEqual(['a', 'b']);
  });

  it('adds to the front while preserving selection order', () => {
    playbackQueue.add([trackC, trackB], 'front');

    expect(queueIds()).toEqual(['c', 'b', 'a', 'b']);
  });

  it('removes every entry for a given id', () => {
    playbackQueue.remove(['b']);

    expect(queueIds()).toEqual(['c', 'a']);
  });

  it('removes the first entry by id', () => {
    playbackQueue.add([trackB, trackB], 'end');
    playbackQueue.removeFirstById('b');

    expect(queueIds()).toEqual(['c', 'a', 'b']);
  });

  it('removes all copies whose identity matches a played track', () => {
    playbackQueue.removeByIdentity(getFavoriteIdentity(trackB));

    expect(queueIds()).toEqual(['c', 'a']);
  });

  it('prunes entries whose playlist ids no longer exist', () => {
    playbackQueue.prune(new Set(['a']));

    expect(queueIds()).toEqual(['a']);
  });

  it('clears the queue', () => {
    playbackQueue.clear();

    expect(queueIds()).toEqual([]);
    expect(playbackQueue.peek()).toBeNull();
  });
});
