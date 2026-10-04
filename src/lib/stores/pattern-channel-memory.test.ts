import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { createPatternChannelMemory, normalizePatternChannelMemory } from './pattern-channel-memory';
import { createPatternChannelControls } from '$lib/services/pattern-channel-controls';
import { getTrackIdentity } from '$lib/utils/files';
import type { TrackItem } from '$lib/types';

afterEach(() => vi.unstubAllGlobals());

const track = (overrides: Partial<TrackItem> = {}): TrackItem => ({
  id: 'queue', name: 'Tune.mod', extension: 'mod', kind: 'module',
  size: 12, lastModified: 34, ...overrides
});

describe('pattern channel memory', () => {
  it('uses collection file identity under FSA limitations, independently of entry or subsong', () => {
    const key = getTrackIdentity(track());
    expect(getTrackIdentity(track({ id: 'library', subsong: 2 }))).toBe(key);
    expect(getTrackIdentity(track({ size: 13 }))).not.toBe(key);
    expect(getTrackIdentity(track({ lastModified: 35 }))).not.toBe(key);
    expect(getTrackIdentity(track({ path: 'Music/Tune.mod' })))
      .toBe(getTrackIdentity(track({ id: 'imported', path: 'music/tune.mod', size: 99 })));
    expect(getTrackIdentity(track({ path: 'Other/Tune.mod' })))
      .not.toBe(getTrackIdentity(track({ path: 'Music/Tune.mod' })));
  });

  it('drops invalid records and stores only explicit mutually exclusive controls', () => {
    expect(normalizePatternChannelMemory(null)).toEqual({});
    expect(normalizePatternChannelMemory([])).toEqual({});
    expect(normalizePatternChannelMemory({
      bad: false,
      module: [{ muted: true, solo: true, effectiveMuted: true }, null, { muted: 'yes', solo: true }]
    })).toEqual({ module: [
      { muted: true, solo: false }, { muted: false, solo: false }, { muted: false, solo: true }
    ] });
  });

  it('hydrates after reload and applies synchronized edits once without writing them back', () => {
    const values = new Map<string, string>();
    const storageListeners: Array<(event: { key: string }) => void> = [];
    const messageListeners: Array<() => void> = [];
    const setItem = vi.fn((key: string, value: string) => values.set(key, value));
    class Channel {
      addEventListener(_type: string, listener: () => void) { messageListeners.push(listener); }
      postMessage = vi.fn();
    }
    vi.stubGlobal('BroadcastChannel', Channel);
    vi.stubGlobal('window', {
      localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem },
      BroadcastChannel: Channel,
      addEventListener: (_type: string, listener: (event: { key: string }) => void) => storageListeners.push(listener)
    });
    const first = createPatternChannelMemory();
    const controls = createPatternChannelControls(vi.fn(), first);
    controls.setTrack('queue', 2, 'module');
    controls.toggleSolo('queue', 1);
    controls.toggleRemember('queue');
    const reloaded = createPatternChannelMemory();
    const apply = vi.fn();
    const restored = createPatternChannelControls(apply, reloaded);
    restored.setTrack('library', 2, 'module');
    expect(apply).toHaveBeenLastCalledWith([true, false]);
    setItem.mockClear();
    apply.mockClear();
    values.set('izci.pattern-channel-memory', JSON.stringify({ module: [{ muted: true, solo: false }] }));
    for (const listener of messageListeners) listener();
    for (const listener of storageListeners) listener({ key: 'izci.pattern-channel-memory' });
    expect(apply).toHaveBeenCalledExactlyOnceWith([true, false]);
    expect(setItem).not.toHaveBeenCalled();
    expect(get(restored.state).remembered).toBe(true);
    controls.destroy();
    restored.destroy();
  });
});
