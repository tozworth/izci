import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPlaylistNavigation } from './playlist-navigation';
import type { PlaylistItem } from '$lib/types';

function item(id: string): PlaylistItem {
  return {
    id,
    name: `${id}.xm`,
    extension: 'xm',
    kind: 'module',
    size: 0,
    lastModified: 0
  };
}

describe('playlist navigation', () => {
  const items = [item('a'), item('b'), item('c')];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('steps linearly from current or selected tracks and only wraps when requested', () => {
    const navigation = createPlaylistNavigation(() => items);

    expect(navigation.resolveStepTrack({ selectedId: 'b', direction: 1 })?.id).toBe('c');
    expect(navigation.resolveStepTrack({ currentId: 'c', selectedId: 'a', direction: 1 })).toBeNull();
    expect(navigation.resolveStepTrack({ currentId: 'c', direction: 1, wrap: true })?.id).toBe('a');
    expect(navigation.resolveStepTrack({ currentId: 'a', direction: -1, wrap: true })?.id).toBe('c');
  });

  it('keeps a one-item playlist reachable at exhausted ends', () => {
    const navigation = createPlaylistNavigation(() => [items[0]]);

    expect(navigation.resolveStepTrack({ currentId: 'a', direction: 1 })?.id).toBe('a');
    expect(navigation.resolveStepTrack({ currentId: 'a', direction: -1 })?.id).toBe('a');
  });

  it('resolves track end according to repeat mode', () => {
    const navigation = createPlaylistNavigation(() => items);

    expect(navigation.resolveTrackEnd({ currentId: 'b', repeatMode: 'one' })?.id).toBe('b');
    expect(navigation.resolveTrackEnd({ currentId: 'b', repeatMode: 'off' })?.id).toBe('c');
    expect(navigation.resolveTrackEnd({ currentId: 'c', repeatMode: 'off' })).toBeNull();
    expect(navigation.resolveTrackEnd({ currentId: 'c', repeatMode: 'all' })?.id).toBe('a');
  });

  it('starts linear playback from selection and shuffled playback from the full playlist', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const navigation = createPlaylistNavigation(() => items);

    expect(navigation.resolveStartTrack({ selectedId: 'a' })?.id).toBe('a');
    expect(navigation.resolveStartTrack()).toBeNull();
    expect(navigation.resolveStartTrack({ selectedId: 'a', shuffle: true })?.id).toBe('b');
    expect(navigation.resolveStepTrack({ currentId: 'b', direction: 1, shuffle: true })?.id).toBe('c');
  });

  it('walks shuffle history backward instead of drawing a fresh random item', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const navigation = createPlaylistNavigation(() => items);

    expect(navigation.resolveStepTrack({ currentId: 'a', direction: 1, shuffle: true })?.id).toBe('c');
    expect(navigation.resolveStepTrack({ currentId: 'c', direction: 1, shuffle: true })?.id).toBe('b');
    expect(navigation.resolveStepTrack({ currentId: 'b', direction: -1, shuffle: true })?.id).toBe('c');
    expect(navigation.resolveStepTrack({ currentId: 'c', direction: -1, shuffle: true })?.id).toBe('a');
  });
});
