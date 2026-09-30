import { describe, expect, it } from 'vitest';
import {
  resolveClientCollections,
  resolveClientPlayback,
  resolveClientSelections
} from './main-window-presentation';
import { EMPTY_PLAYBACK } from './multiplayer-types';
import type { TrackItem, TrackSelection } from '$lib/types';

const track = (id: string): TrackItem =>
  ({ id, kind: 'stream', name: `${id}.mp3`, path: `/media/${id}.mp3` }) as TrackItem;

const selection = (
  ids: string[],
  anchorId: string | null = null,
  focusId: string | null = null
): TrackSelection => ({ ids, anchorId, focusId });

describe('resolveClientCollections', () => {
  const local = {
    trackItems: [track('a')],
    libraryItems: [track('b')],
    favoriteItems: [track('c')],
    collectionsReady: true
  };
  const remote = {
    queue: [track('rq')],
    library: [track('rl')],
    favorites: [track('rf')],
    revision: 3,
    connectionStatus: 'connected' as const
  };

  it('uses the local mirrors when not a client', () => {
    expect(resolveClientCollections(local, remote, false)).toEqual({
      queueItems: [track('a')],
      libraryItems: [track('b')],
      favoriteItems: [track('c')],
      collectionsReady: true
    });
  });

  it('uses the remote catalog when a client, ready only once connected with a revision', () => {
    expect(resolveClientCollections(local, remote, true)).toEqual({
      queueItems: [track('rq')],
      libraryItems: [track('rl')],
      favoriteItems: [track('rf')],
      collectionsReady: true
    });
    expect(resolveClientCollections(local, { ...remote, revision: 0 }, true).collectionsReady).toBe(
      false
    );
    expect(
      resolveClientCollections(local, { ...remote, connectionStatus: 'connecting' }, true)
        .collectionsReady
    ).toBe(false);
  });
});

describe('resolveClientSelections', () => {
  const local = {
    queueIds: ['q'],
    libraryIds: ['l'],
    libraryAnchorId: 'l',
    favoriteIds: ['f'],
    favoriteAnchorId: null
  };
  const remote = {
    track: selection(['rq'], null, 'rq'),
    library: selection(['rl'], 'rl', 'rl'),
    favorites: selection(['rf'])
  };

  it('uses the local mirrors when not a client', () => {
    expect(resolveClientSelections(local, remote, false)).toEqual(local);
  });

  it('uses the remote selections when a client', () => {
    expect(resolveClientSelections(local, remote, true)).toEqual({
      queueIds: ['rq'],
      libraryIds: ['rl'],
      libraryAnchorId: 'rl',
      favoriteIds: ['rf'],
      favoriteAnchorId: null
    });
  });
});

describe('resolveClientPlayback', () => {
  const local = {
    snapshot: {
      state: 'playing',
      currentTime: 5,
      duration: 100,
      volume: 0.8,
      muted: false,
      backend: 'stream'
    },
    status: { state: 'playing', volume: 0.8, backend: 'stream', error: undefined },
    shuffleEnabled: false,
    repeatMode: 'off'
  } as const;

  it('passes local values through when not a client', () => {
    const remote = { snapshot: EMPTY_PLAYBACK, sentAt: 0, shuffleEnabled: true, repeatMode: 'all' as const };
    const result = resolveClientPlayback(remote, local, false, false, false, false, null);
    expect(result.playbackSnapshot).toBe(local.snapshot);
    expect(result.playbackStatus).toBe(local.status);
    expect(result.shuffleEnabled).toBe(false);
    expect(result.repeatMode).toBe('off');
  });

  it('keeps the local snapshot for source-file freeplay clients but still remote shuffle/repeat', () => {
    const remote = { snapshot: EMPTY_PLAYBACK, sentAt: 0, shuffleEnabled: true, repeatMode: 'all' as const };
    const result = resolveClientPlayback(remote, local, true, true, false, false, null);
    expect(result.playbackSnapshot).toBe(local.snapshot);
    expect(result.playbackStatus).toBe(local.status);
    expect(result.shuffleEnabled).toBe(true);
    expect(result.repeatMode).toBe('all');
  });

  it('overlays local volume/mute on the remote snapshot with buffered stripped for non-render clients', () => {
    const remote = {
      snapshot: {
        ...EMPTY_PLAYBACK,
        state: 'playing' as const,
        currentTime: 3,
        duration: 60,
        backend: 'video' as const,
        buffered: [[0, 3]] as Array<[number, number]>
      },
      sentAt: 0,
      shuffleEnabled: true,
      repeatMode: 'all' as const
    };
    const result = resolveClientPlayback(remote, local, true, false, false, false, null);
    expect(result.playbackSnapshot).toEqual({
      ...remote.snapshot,
      state: 'playing',
      volume: 0.8,
      muted: false,
      buffered: undefined
    });
    expect(result.playbackStatus).toEqual({
      state: 'playing',
      volume: 0.8,
      backend: 'video',
      error: undefined
    });
    expect(result.shuffleEnabled).toBe(true);
    expect(result.repeatMode).toBe('all');
  });

  it('surfaces render-pipeline buffering as loading unless the host reported an error', () => {
    const remote = {
      snapshot: { ...EMPTY_PLAYBACK, state: 'playing' as const },
      sentAt: 0,
      shuffleEnabled: false,
      repeatMode: 'off' as const
    };
    expect(
      resolveClientPlayback(remote, local, true, false, true, true, null).playbackSnapshot.state
    ).toBe('loading');
    expect(
      resolveClientPlayback(
        { ...remote, snapshot: { ...remote.snapshot, state: 'error' as const } },
        local,
        true,
        false,
        true,
        true,
        null
      ).playbackSnapshot.state
    ).toBe('error');
    expect(
      resolveClientPlayback(remote, local, true, false, false, true, null).playbackSnapshot.state
    ).toBe('playing');
  });

  it('keeps remote buffered ranges only for render clients', () => {
    const remote = {
      snapshot: { ...EMPTY_PLAYBACK, state: 'playing' as const },
      sentAt: 0,
      shuffleEnabled: false,
      repeatMode: 'off' as const
    };
    expect(
      resolveClientPlayback(remote, local, true, false, true, false, [[1, 2]]).playbackSnapshot
        .buffered
    ).toEqual([[1, 2]]);
    expect(
      resolveClientPlayback(remote, local, true, false, true, false, null).playbackSnapshot.buffered
    ).toBeUndefined();
    expect(
      resolveClientPlayback(remote, local, true, false, false, false, [[1, 2]]).playbackSnapshot
        .buffered
    ).toBeUndefined();
  });

  it('advances a playing host snapshot without advancing loading or paused snapshots', () => {
    const remote = {
      snapshot: { ...EMPTY_PLAYBACK, state: 'playing' as const, currentTime: 4, duration: 10 },
      sentAt: 1_000,
      shuffleEnabled: false,
      repeatMode: 'off' as const
    };
    const displayTime = (state: 'playing' | 'loading' | 'paused', now: number) =>
      resolveClientPlayback(
        { ...remote, snapshot: { ...remote.snapshot, state } },
        local, true, false, false, false, null, now
      ).playbackSnapshot.currentTime;

    expect(displayTime('playing', 3_500)).toBe(6.5);
    expect(displayTime('playing', 20_000)).toBe(10);
    expect(displayTime('loading', 3_500)).toBe(4);
    expect(displayTime('paused', 3_500)).toBe(4);
  });

  it('uses a loaded source file duration when the host has none', () => {
    const remote = {
      snapshot: { ...EMPTY_PLAYBACK, state: 'playing' as const, currentTime: 8 },
      sentAt: 1_000,
      sourceFileDuration: 12,
      shuffleEnabled: false,
      repeatMode: 'off' as const
    };
    const result = resolveClientPlayback(remote, local, true, false, false, false, null, 10_000);
    expect(result.playbackSnapshot.duration).toBe(12);
    expect(result.playbackSnapshot.currentTime).toBe(12);
  });
});
