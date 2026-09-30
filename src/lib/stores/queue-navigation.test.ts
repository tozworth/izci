import { afterEach, describe, expect, it, vi } from 'vitest';

import { createQueueNavigation } from './queue-navigation';
import type { TrackItem } from '$lib/types';

function item(id: string): TrackItem {
  return {
    id,
    name: `${id}.xm`,
    extension: 'xm',
    kind: 'module',
    size: 0,
    lastModified: 0
  };
}

describe('queue navigation', () => {
  const items = [item('a'), item('b'), item('c')];

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('steps linearly from current or selected tracks and only wraps when requested', () => {
    const navigation = createQueueNavigation(() => items);

    expect(navigation.resolveStepTrack({ selectedId: 'b', direction: 1 })?.id).toBe('c');
    expect(navigation.resolveStepTrack({ currentId: 'c', selectedId: 'a', direction: 1 })).toBeNull();
    expect(navigation.resolveStepTrack({ currentId: 'c', direction: 1, wrap: true })?.id).toBe('a');
    expect(navigation.resolveStepTrack({ currentId: 'a', direction: -1, wrap: true })?.id).toBe('c');
  });

  it('keeps a one-item queue reachable at exhausted ends', () => {
    const navigation = createQueueNavigation(() => [items[0]]);

    expect(navigation.resolveStepTrack({ currentId: 'a', direction: 1 })?.id).toBe('a');
    expect(navigation.resolveStepTrack({ currentId: 'a', direction: -1 })?.id).toBe('a');
  });

  it('resolves track end according to repeat mode', () => {
    const navigation = createQueueNavigation(() => items);

    expect(navigation.resolveTrackEnd({ currentId: 'b', repeatMode: 'one' })?.id).toBe('b');
    expect(navigation.resolveTrackEnd({ currentId: 'b', repeatMode: 'off' })?.id).toBe('c');
    expect(navigation.resolveTrackEnd({ currentId: 'c', repeatMode: 'off' })).toBeNull();
    expect(navigation.resolveTrackEnd({ currentId: 'c', repeatMode: 'all' })?.id).toBe('a');
  });

  it.each([false, true])('stops a one-item queue with repeat off (shuffle: %s)', (shuffle) => {
    const navigation = createQueueNavigation(() => [items[0]]);

    expect(navigation.resolveTrackEnd({ currentId: 'a', shuffle, repeatMode: 'off' })).toBeNull();
    expect(navigation.resolveStepTrack({ currentId: 'a', direction: 1, shuffle })?.id).toBe('a');
    expect(navigation.resolveStepTrack({ currentId: 'a', direction: -1, shuffle })?.id).toBe('a');
    expect(navigation.resolveTrackEnd({ currentId: 'a', shuffle, repeatMode: 'off' })).toBeNull();
  });

  it.each([false, true])('repeats a one-item queue when enabled (shuffle: %s)', (shuffle) => {
    const navigation = createQueueNavigation(() => [items[0]]);

    expect(navigation.resolveTrackEnd({ currentId: 'a', shuffle, repeatMode: 'one' })?.id).toBe('a');
    expect(navigation.resolveTrackEnd({ currentId: 'a', shuffle, repeatMode: 'all' })?.id).toBe('a');
  });

  it('starts linear playback from selection and shuffled playback from the full queue', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const navigation = createQueueNavigation(() => items);

    expect(navigation.resolveStartTrack({ selectedId: 'a' })?.id).toBe('a');
    expect(navigation.resolveStartTrack()).toBeNull();
    expect(navigation.resolveStartTrack({ selectedId: 'a', shuffle: true })?.id).toBe('b');
    expect(navigation.resolveStepTrack({ currentId: 'b', direction: 1, shuffle: true })?.id).toBe('c');
  });

  it('walks shuffle history backward instead of drawing a fresh random item', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const navigation = createQueueNavigation(() => items);

    expect(navigation.resolveStepTrack({ currentId: 'a', direction: 1, shuffle: true })?.id).toBe('c');
    expect(navigation.resolveStepTrack({ currentId: 'c', direction: 1, shuffle: true })?.id).toBe('b');
    expect(navigation.resolveStepTrack({ currentId: 'b', direction: -1, shuffle: true })?.id).toBe('c');
    expect(navigation.resolveStepTrack({ currentId: 'c', direction: -1, shuffle: true })?.id).toBe('a');
  });
});
