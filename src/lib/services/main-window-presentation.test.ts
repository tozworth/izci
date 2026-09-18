import { describe, expect, it } from 'vitest';
import {
  resolveClientCollections,
  resolveClientPlayback,
  resolveClientSelections,
  resolveClientSelectedItems,
  resolveLyricsPresentation,
  resolveMultiplayerDialogPresentation,
  resolveNowPlayingEligibility,
  resolveNowPlayingLayoutActive,
  resolveVideoTheaterPresentation,
  resolveWindowTitle
} from './main-window-presentation';
import type { Translate } from './main-window-presentation';
import {
  EMPTY_CATALOG,
  EMPTY_DELIVERY,
  EMPTY_PLAYBACK,
  EMPTY_REMOTE_PLAYBACK,
  type MultiplayerSessionState
} from './multiplayer-types';
import type { TrackItem, TrackSelection } from '$lib/types';

const noopTranslate: Translate = (id) => id;

const track = (id: string): TrackItem =>
  ({ id, kind: 'stream', name: `${id}.mp3`, path: `/media/${id}.mp3` }) as TrackItem;

const selection = (
  ids: string[],
  anchorId: string | null = null,
  focusId: string | null = null
): TrackSelection => ({ ids, anchorId, focusId });

function createSessionState(
  overrides: Partial<MultiplayerSessionState> = {}
): MultiplayerSessionState {
  return {
    mode: 'idle',
    connectionStatus: 'idle',
    reconnecting: false,
    inviteCode: null,
    hostName: null,
    hostMotd: '',
    hostVersion: null,
    freeplayPaired: false,
    freeplay: false,
    freeplayQueue: [],
    clients: [],
    remoteCatalog: EMPTY_CATALOG,
    remotePlayback: EMPTY_REMOTE_PLAYBACK,
    remoteArtwork: null,
    remoteArtworkResolvedTrackKey: '',
    audioStatus: 'idle',
    remoteDelivery: EMPTY_DELIVERY,
    connectionRoute: null,
    sidekickSignaling: null,
    sidekickHostAuth: null,
    averageAudioBitrateKbps: null,
    receiveAudio: true,
    connectionStats: null,
    connectionDetail: null,
    message: null,
    ...overrides
  };
}

describe('resolveMultiplayerDialogPresentation', () => {
  it('reports failure from the dialog error or the connection status', () => {
    const state = createSessionState({ connectionStatus: 'connecting' });
    expect(resolveMultiplayerDialogPresentation(state, { error: null }, 'joining', null, noopTranslate).failed).toBe(false);
    expect(resolveMultiplayerDialogPresentation(state, { error: 'boom' }, 'joining', null, noopTranslate).failed).toBe(true);
    expect(
      resolveMultiplayerDialogPresentation(
        createSessionState({ connectionStatus: 'error' }),
        { error: null },
        'joining',
        null,
        noopTranslate
      ).failed
    ).toBe(true);
    expect(
      resolveMultiplayerDialogPresentation(
        createSessionState({ connectionStatus: 'disconnected' }),
        { error: null },
        'joining',
        null,
        noopTranslate
      ).failed
    ).toBe(true);
  });

  it('resolves the target from the host name, else the typed target name', () => {
    expect(
      resolveMultiplayerDialogPresentation(
        createSessionState({ hostName: 'host-a' }),
        { error: null },
        'joining',
        'typed-b',
        noopTranslate
      ).resolvedTarget
    ).toBe('host-a');
    expect(
      resolveMultiplayerDialogPresentation(
        createSessionState(),
        { error: null },
        'joining',
        'typed-b',
        noopTranslate
      ).resolvedTarget
    ).toBe('typed-b');
    expect(
      resolveMultiplayerDialogPresentation(
        createSessionState(),
        { error: null },
        'joining',
        null,
        noopTranslate
      ).resolvedTarget
    ).toBeNull();
  });

  it('builds the notice per failure, hosting, and joining states', () => {
    expect(
      resolveMultiplayerDialogPresentation(
        createSessionState({ connectionStatus: 'error' }),
        { error: null },
        'joining',
        null,
        noopTranslate
      ).notice
    ).toBe('main.multiplayer.connectionNoticeFailed');
    expect(
      resolveMultiplayerDialogPresentation(createSessionState(), { error: null }, 'hosting', null, noopTranslate)
        .notice
    ).toBe('main.multiplayer.startingHost');
    const valuesTranslate: Translate = (id, options) =>
      options?.default
        ? options.default.replace('{name}', String(options.values?.name ?? '?'))
        : id;
    expect(
      resolveMultiplayerDialogPresentation(
        createSessionState(),
        { error: null },
        'joining',
        'bob',
        valuesTranslate
      ).notice
    ).toBe('Connecting to bob');
    expect(
      resolveMultiplayerDialogPresentation(createSessionState(), { error: null }, 'joining', null, noopTranslate)
        .notice
    ).toBe('main.multiplayer.connectingToHost');
  });

  it('builds the status line with documented precedence', () => {
    const base = createSessionState();
    expect(
      resolveMultiplayerDialogPresentation(base, { error: null }, 'joining', null, noopTranslate).statusLine
    ).toBe('main.multiplayer.preparingConnection');
    expect(
      resolveMultiplayerDialogPresentation(base, { error: null }, 'hosting', null, noopTranslate).statusLine
    ).toBe('main.multiplayer.preparingRoom');
    expect(
      resolveMultiplayerDialogPresentation(
        createSessionState({ audioStatus: 'blocked' }),
        { error: null },
        'joining',
        null,
        noopTranslate
      ).statusLine
    ).toBe('main.multiplayer.audio.blocked');
    expect(
      resolveMultiplayerDialogPresentation(
        createSessionState({ message: 'a message' }),
        { error: null },
        'joining',
        null,
        noopTranslate
      ).statusLine
    ).toBe('a message');
    expect(
      resolveMultiplayerDialogPresentation(
        createSessionState({ connectionDetail: 'detail' }),
        { error: null },
        'joining',
        null,
        noopTranslate
      ).statusLine
    ).toBe('detail');
    expect(
      resolveMultiplayerDialogPresentation(
        createSessionState({ connectionDetail: 'detail' }),
        { error: 'dialog error' },
        'joining',
        null,
        noopTranslate
      ).statusLine
    ).toBe('dialog error');
  });
});

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

describe('resolveClientSelectedItems', () => {
  it('resolves the focus item, falling back to the last selected id', () => {
    const items = [track('a'), track('b')];
    expect(resolveClientSelectedItems(items, selection(['a', 'b'], null, 'b'))).toEqual(track('b'));
    expect(resolveClientSelectedItems(items, selection(['a', 'b']))).toEqual(track('b'));
    expect(resolveClientSelectedItems(items, selection([], 'a'))).toBeNull();
    expect(resolveClientSelectedItems([], selection(['a']))).toBeNull();
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
    const remote = { snapshot: EMPTY_PLAYBACK, shuffleEnabled: true, repeatMode: 'all' as const };
    const result = resolveClientPlayback(remote, local, false, false, false, false, null);
    expect(result.playbackSnapshot).toBe(local.snapshot);
    expect(result.playbackStatus).toBe(local.status);
    expect(result.shuffleEnabled).toBe(false);
    expect(result.repeatMode).toBe('off');
  });

  it('keeps the local snapshot for source-file freeplay clients but still remote shuffle/repeat', () => {
    const remote = { snapshot: EMPTY_PLAYBACK, shuffleEnabled: true, repeatMode: 'all' as const };
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
});

describe('resolveVideoTheaterPresentation', () => {
  const overlayVisible = {
    visible: true,
    titlebarAreaRect: { x: 0, y: 10, width: 200, height: 40 }
  } as unknown as Parameters<typeof resolveVideoTheaterPresentation>[3];

  it('gates fullscreen theater on track, theater, and window fullscreen', () => {
    expect(resolveVideoTheaterPresentation(true, true, true, overlayVisible, 50, false).isFullscreenVideoTheater).toBe(true);
    expect(resolveVideoTheaterPresentation(true, false, true, overlayVisible, 50, false).isFullscreenVideoTheater).toBe(false);
    expect(resolveVideoTheaterPresentation(true, true, false, overlayVisible, 50, false).isFullscreenVideoTheater).toBe(false);
    expect(resolveVideoTheaterPresentation(false, true, true, overlayVisible, 50, false).isFullscreenVideoTheater).toBe(false);
  });

  it('computes the exit action from the DOM fullscreen element', () => {
    expect(resolveVideoTheaterPresentation(true, true, true, overlayVisible, 50, true).fullscreenExitAction).toBe(true);
    expect(resolveVideoTheaterPresentation(true, true, true, overlayVisible, 50, false).fullscreenExitAction).toBe(false);
    expect(resolveVideoTheaterPresentation(true, true, false, overlayVisible, 50, true).fullscreenExitAction).toBe(false);
  });

  it('derives the chrome inset from the lower edge of the overlay or measured menubar', () => {
    // Overlay bottom and measured menubar bottom are both 50.
    expect(resolveVideoTheaterPresentation(true, false, false, overlayVisible, 50, false).chromeInset).toBe(50);
    expect(
      resolveVideoTheaterPresentation(
        true,
        false,
        false,
        { visible: false, titlebarAreaRect: { x: 0, y: 10, width: 200, height: 40 } } as unknown as Parameters<
          typeof resolveVideoTheaterPresentation
        >[3],
        50,
        false
      ).chromeInset
    ).toBe(50);
    expect(
      resolveVideoTheaterPresentation(
        true,
        false,
        false,
        { visible: true, titlebarAreaRect: { x: 0, y: -5, width: 200, height: 2 } } as unknown as Parameters<
          typeof resolveVideoTheaterPresentation
        >[3],
        50,
        false
      ).chromeInset
    ).toBe(50);
    expect(
      resolveVideoTheaterPresentation(
        true,
        false,
        false,
        { visible: true, titlebarAreaRect: { x: 0, y: 0, width: 200, height: 80 } } as unknown as Parameters<
          typeof resolveVideoTheaterPresentation
        >[3],
        50,
        false
      ).chromeInset
    ).toBe(80);
  });

  it('zeroes the top inset in fullscreen theater, else mirrors the chrome inset', () => {
    expect(resolveVideoTheaterPresentation(true, true, true, overlayVisible, 50, false).topInset).toBe(0);
    expect(resolveVideoTheaterPresentation(true, false, true, overlayVisible, 50, false).topInset).toBe(50);
  });
});

describe('resolveNowPlayingEligibility', () => {
  const appearance = { nowPlayingViewActive: true, autoNowPlayingOnMaximized: true };
  const windowDisplay = { prefersNowPlaying: true };
  const desktop = { width: 1200, height: 800 };

  it('mirrors the manual now-playing switch and computes automatic + viewport eligibility', () => {
    const result = resolveNowPlayingEligibility(appearance, windowDisplay, desktop, false);
    expect(result.nowPlayingViewActive).toBe(true);
    expect(result.isAutomaticNowPlayingEligible).toBe(true);
    expect(result.isNowPlayingViewportEligible).toBe(true);
    expect(
      resolveNowPlayingEligibility(
        { ...appearance, autoNowPlayingOnMaximized: false },
        windowDisplay,
        desktop,
        false
      ).isAutomaticNowPlayingEligible
    ).toBe(false);
    expect(
      resolveNowPlayingEligibility(
        appearance,
        { prefersNowPlaying: false },
        desktop,
        false
      ).isAutomaticNowPlayingEligible
    ).toBe(false);
  });

  it('treats mobile mode as always viewport-eligible but still requires the minimum size otherwise', () => {
    expect(
      resolveNowPlayingEligibility(appearance, windowDisplay, { width: 400, height: 300 }, false)
        .isNowPlayingViewportEligible
    ).toBe(false);
    expect(
      resolveNowPlayingEligibility(appearance, windowDisplay, { width: 1, height: 1 }, true)
        .isNowPlayingViewportEligible
    ).toBe(true);
  });
});

describe('resolveNowPlayingLayoutActive', () => {
  it('activates the layout from the manual view or automatic eligibility, never on video', () => {
    expect(resolveNowPlayingLayoutActive(true, false, false, true, undefined)).toBe(true);
    expect(resolveNowPlayingLayoutActive(false, true, false, true, undefined)).toBe(true);
    expect(resolveNowPlayingLayoutActive(false, true, false, true, 'video')).toBe(false);
    expect(resolveNowPlayingLayoutActive(true, false, false, false, undefined)).toBe(false);
  });

  it('respects the auto-now-playing suppression toggle', () => {
    expect(resolveNowPlayingLayoutActive(false, true, true, true, undefined)).toBe(false);
  });
});

describe('resolveLyricsPresentation', () => {
  const lyricsAppearance = {
    lyrics: {
      autoTheaterInNowPlaying: true,
      displayStyle: 'timestamped' as const,
      autoScroll: false,
      fontSizes: { plain: 0.95, timestamped: 0.95, theater: 1.75 },
      theaterDowntimeDots: true,
      theaterDowntimeThresholdSeconds: 5,
      theaterSmoothScroll: true,
      autoFocusInNowPlaying: true
    }
  };

  it('uses theater style in the now-playing layout when enabled', () => {
    expect(resolveLyricsPresentation(lyricsAppearance, true).effectiveLyricsDisplayStyle).toBe('theater');
    expect(resolveLyricsPresentation(lyricsAppearance, false).effectiveLyricsDisplayStyle).toBe('timestamped');
    expect(
      resolveLyricsPresentation(
        { lyrics: { ...lyricsAppearance.lyrics, autoTheaterInNowPlaying: false } },
        true
      ).effectiveLyricsDisplayStyle
    ).toBe('timestamped');
  });

  it('auto-scrolls in theater or when the setting is on', () => {
    expect(resolveLyricsPresentation(lyricsAppearance, true).lyricsAutoScroll).toBe(true);
    expect(
      resolveLyricsPresentation(
        { lyrics: { ...lyricsAppearance.lyrics, autoScroll: true } },
        false
      ).lyricsAutoScroll
    ).toBe(true);
    expect(resolveLyricsPresentation(lyricsAppearance, false).lyricsAutoScroll).toBe(false);
  });

  it('resolves the font size for the effective style', () => {
    expect(resolveLyricsPresentation(lyricsAppearance, true).lyricsFontSize).toBe(1.75);
    expect(resolveLyricsPresentation(lyricsAppearance, false).lyricsFontSize).toBe(0.95);
  });
});

describe('resolveWindowTitle', () => {
  it('shows the track title when enabled and a track is live, else izci', () => {
    expect(resolveWindowTitle(true, track('Song'))).toBe('Song');
    expect(resolveWindowTitle(false, track('Song'))).toBe('izci');
    expect(resolveWindowTitle(true, null)).toBe('izci');
  });
});
