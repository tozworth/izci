import { describe, expect, it } from 'vitest';
import type { PlaylistItem } from '$lib/types';
import { createFreeplayStepResolver } from './multiplayer-freeplay';

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
  const tracks = [track('a'), track('b'), track('c'), track('d')];

  it('steps linearly within the browsed host collection and only wraps with repeat-all', () => {
    const navigation = createFreeplayStepResolver(() => tracks);
    expect(navigation.resolveStep({ currentId: 'a', direction: 1, shuffle: false, wrap: false })?.id).toBe('b');
    expect(navigation.resolveStep({ currentId: 'b', direction: -1, shuffle: false, wrap: false })?.id).toBe('a');
    // Repeat-off: Next at the end of the collection is a no-op (the track stays).
    expect(navigation.resolveStep({ currentId: 'd', direction: 1, shuffle: false, wrap: false })).toBeNull();
    // Repeat-all wraps to the first track.
    expect(navigation.resolveStep({ currentId: 'd', direction: 1, shuffle: false, wrap: true })?.id).toBe('a');
    // With no current track, direction picks the first/last item like local playback.
    expect(navigation.resolveStep({ direction: 1, shuffle: false, wrap: false })?.id).toBe('a');
    expect(navigation.resolveStep({ direction: -1, shuffle: false, wrap: false })?.id).toBe('d');
  });

  it('starts a shuffle session deterministically when no track is loaded', () => {
    const navigation = createFreeplayStepResolver(() => tracks);
    expect(navigation.resolveStep({ direction: 1, shuffle: true, wrap: false })?.id).toBe('a');
    expect(navigation.resolveStep({ direction: -1, shuffle: true, wrap: false })?.id).toBe('d');
  });

  it('remembers played tracks so Previous walks the history, not the list order', () => {
    const navigation = createFreeplayStepResolver(() => tracks);
    navigation.resolveStep({ direction: 1, shuffle: true, wrap: false }); // fresh session anchored at 'a'
    const next = navigation.resolveStep({ currentId: 'a', direction: 1, shuffle: true, wrap: false });
    expect(next).not.toBeNull();
    expect(next!.id).not.toBe('a');
    // Prev returns to the track we actually came from.
    const previous = navigation.resolveStep({ currentId: next!.id, direction: -1, shuffle: true, wrap: false });
    expect(previous?.id).toBe('a');
  });

  it('never re-picks a track before the collection is exhausted, then wraps with repeat-all', () => {
    const navigation = createFreeplayStepResolver(() => tracks);
    navigation.resolveStep({ direction: 1, shuffle: true, wrap: false }); // 'a'
    let current = 'a';
    const seen = new Set([current]);
    for (let index = 0; index < tracks.length - 1; index += 1) {
      const next = navigation.resolveStep({ currentId: current, direction: 1, shuffle: true, wrap: false });
      expect(next).not.toBeNull();
      expect(next!.id).not.toBe(current);
      expect(seen.has(next!.id)).toBe(false);
      seen.add(next!.id);
      current = next!.id;
    }
    // Exhausted cycle + repeat off: stop.
    expect(navigation.resolveStep({ currentId: current, direction: 1, shuffle: true, wrap: false })).toBeNull();
    // Exhausted cycle + repeat all: a fresh cycle, never the current track.
    const wrapped = navigation.resolveStep({ currentId: current, direction: 1, shuffle: true, wrap: true });
    expect(wrapped).not.toBeNull();
    expect(wrapped!.id).not.toBe(current);
  });

  it('resolves track-end steps with the repeat mode', () => {
    const navigation = createFreeplayStepResolver(() => tracks);
    expect(navigation.resolveEnd({ currentId: 'b', shuffle: false, repeatMode: 'off' })?.id).toBe('c');
    expect(navigation.resolveEnd({ currentId: 'd', shuffle: false, repeatMode: 'off' })).toBeNull();
    expect(navigation.resolveEnd({ currentId: 'd', shuffle: false, repeatMode: 'all' })?.id).toBe('a');
    expect(navigation.resolveEnd({ currentId: 'b', shuffle: false, repeatMode: 'one' })?.id).toBe('b');
    const shuffled = navigation.resolveEnd({ currentId: 'c', shuffle: true, repeatMode: 'all' });
    expect(shuffled).not.toBeNull();
    expect(shuffled!.id).not.toBe('c');
  });

  it('drops the shuffle session on reset (shuffle toggle / queue or collection replacement)', () => {
    const navigation = createFreeplayStepResolver(() => tracks);
    navigation.resolveStep({ direction: 1, shuffle: true, wrap: false }); // 'a'
    const first = navigation.resolveStep({ currentId: 'a', direction: 1, shuffle: true, wrap: false })!;
    navigation.reset();
    // After a reset there is no history to walk back into: Previous from a fresh
    // anchor is a no-op instead of returning the old session's track.
    const previous = navigation.resolveStep({ currentId: first.id, direction: -1, shuffle: true, wrap: false });
    expect(previous).toBeNull();
  });
});
