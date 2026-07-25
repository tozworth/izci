import { writable } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import type { FilesystemFolder } from './filesystem-folders';
import {
  getLoadoutFileKey,
  matchesLoadoutTarget,
  resolveAutomaticLoadouts,
  resolveLoadoutFolderContext,
  resolveRecognizedTrackType,
  startLoadoutRuntime
} from './loadouts';
import { loadouts as loadoutStore } from '$lib/stores/loadouts';
import { playbackSettings } from '$lib/stores/playback-settings';
import type { Loadout, LoadoutState, LoadoutTrackContext, PlaylistItem } from '$lib/types';

const folder = {
  id: 'folder-1',
  name: 'Modules',
  handle: { kind: 'directory', name: 'Modules' } as FileSystemDirectoryHandle,
  addedAt: 1,
  permission: 'granted',
  libraryMode: null,
  lastScanStatus: 'never'
} satisfies FilesystemFolder;

function track(overrides: Partial<LoadoutTrackContext> = {}): LoadoutTrackContext {
  return {
    name: 'Artist - Song.custom',
    path: 'Modules/Album/Artist - Song.custom',
    extension: 'custom',
    kind: 'module',
    size: 123,
    lastModified: 456,
    metadata: { title: 'Song', artist: 'Artist', originalType: 'XM' },
    ...overrides
  };
}

function loadout(
  id: string,
  target: Loadout['target'],
  settings: Loadout['settings'],
  updatedAt = 1
): Loadout {
  return { id, name: id, target, settings, createdAt: 1, updatedAt };
}

describe('loadout matching', () => {
  it('uses the decoder-recognized module type instead of a misleading extension', () => {
    expect(resolveRecognizedTrackType(track())).toBe('xm');
    expect(matchesLoadoutTarget({ type: 'type', recognizedType: 'xm' }, track(), [folder])).toBe(true);
    expect(matchesLoadoutTarget({ type: 'type', recognizedType: 'custom' }, track(), [folder])).toBe(false);
  });

  it('resolves a remembered FSA root from either its id or the relative path root', () => {
    expect(resolveLoadoutFolderContext(track({ sourceFolderId: 'folder-1' }), [folder])).toEqual({
      id: 'folder-1',
      name: 'Modules'
    });
    expect(resolveLoadoutFolderContext(track({ sourceFolderId: undefined }), [folder])).toEqual({
      id: 'folder-1',
      name: 'Modules'
    });
  });

  it('matches tag regexes against filenames and metadata', () => {
    expect(matchesLoadoutTarget({ type: 'tags', pattern: '^Artist -' }, track(), [])).toBe(true);
    expect(matchesLoadoutTarget({ type: 'tags', pattern: 'song' }, track(), [])).toBe(true);
    expect(matchesLoadoutTarget({ type: 'tags', pattern: '[' }, track(), [])).toBe(false);
  });

  it('builds stable file identities across playlist copies', () => {
    expect(getLoadoutFileKey(track())).toBe(getLoadoutFileKey(track()));
    expect(getLoadoutFileKey(track({ lastModified: 457 }))).not.toBe(getLoadoutFileKey(track()));
  });
});

describe('automatic loadout resolution', () => {
  it('layers the most specific matching loadout independently per category', () => {
    const currentTrack = track();
    const state: LoadoutState = {
      automaticEnabled: true,
      loadouts: [
        loadout('type-modules', { type: 'type', recognizedType: 'xm' }, {
          modules: {
            repeatCount: -1,
            stereoSeparation: 100,
            panStrength: 100,
            interpolationFilter: 8,
            tempoFactor: 1,
            pitchFactor: 1
          }
        }),
        loadout('folder-appearance', { type: 'path', folderId: folder.id, folderName: folder.name }, {
          appearance: {
            backdropZones: { left: 'none', center: 'none', right: 'none', player: 'none', nowPlaying: 'artwork' },
            visualizer: {
              style: 'bars', colorSource: 'theme', height: 0.5, transparency: 0.4,
              frameRateLimit: 60, normalizationStrength: 0.4, triangleCount: 64,
              triangleMinSize: 0.1, triangleMaxSize: 0.5, triangleBaseSpeed: 1,
              triangleReactiveSpeed: 1, triangleBorderWidth: 1
            }
          }
        }),
        loadout('file-playback', { type: 'file', fileKey: getLoadoutFileKey(currentTrack) }, {
          playback: { playbackRate: 1.25, trueSpeed: true, replayGainMode: 'album' }
        })
      ]
    };

    const resolved = resolveAutomaticLoadouts(state, currentTrack, [folder]);
    expect(resolved.playback?.id).toBe('file-playback');
    expect(resolved.appearance?.id).toBe('folder-appearance');
    expect(resolved.modules?.id).toBe('type-modules');
  });

  it('never automatically selects manual presets', () => {
    const state: LoadoutState = {
      automaticEnabled: true,
      loadouts: [loadout('manual', { type: 'preset' }, {
        playback: { playbackRate: 2, trueSpeed: false, replayGainMode: 'off' }
      })]
    };
    expect(resolveAutomaticLoadouts(state, track(), [folder])).toEqual({});
  });
});

describe('automatic loadout runtime', () => {
  const originalPlayback = playbackSettings.getSnapshot();

  afterEach(() => {
    loadoutStore.reset();
    playbackSettings.set(originalPlayback);
  });

  it('restores the previous category settings before an unmatched track inherits them', () => {
    playbackSettings.update({ playbackRate: 0.8, trueSpeed: true, replayGainMode: 'off' });
    loadoutStore.reset();
    loadoutStore.create('FLAC', { type: 'type', recognizedType: 'flac' }, {
      playback: { playbackRate: 1.5, trueSpeed: false, replayGainMode: 'album' }
    });
    const tracks = writable<PlaylistItem | null>(null);
    const stop = startLoadoutRuntime(tracks);

    tracks.set({
      id: 'flac', name: 'Song.flac', extension: 'flac', kind: 'stream', size: 1, lastModified: 1
    });
    expect(playbackSettings.getSnapshot()).toMatchObject({
      playbackRate: 1.5,
      trueSpeed: false,
      replayGainMode: 'album'
    });

    tracks.set({
      id: 'mp3', name: 'Next.mp3', extension: 'mp3', kind: 'stream', size: 2, lastModified: 2
    });
    expect(playbackSettings.getSnapshot()).toMatchObject({
      playbackRate: 0.8,
      trueSpeed: true,
      replayGainMode: 'off'
    });
    stop();
  });

  it('restores active overrides when automatic application is disabled', () => {
    playbackSettings.update({ playbackRate: 1, trueSpeed: false, replayGainMode: 'track' });
    loadoutStore.reset();
    loadoutStore.create('FLAC', { type: 'type', recognizedType: 'flac' }, {
      playback: { playbackRate: 2, trueSpeed: true, replayGainMode: 'off' }
    });
    const tracks = writable<PlaylistItem | null>({
      id: 'flac', name: 'Song.flac', extension: 'flac', kind: 'stream', size: 1, lastModified: 1
    });
    const stop = startLoadoutRuntime(tracks);
    expect(playbackSettings.getSnapshot().playbackRate).toBe(2);

    loadoutStore.setAutomaticEnabled(false);
    expect(playbackSettings.getSnapshot()).toMatchObject({
      playbackRate: 1,
      trueSpeed: false,
      replayGainMode: 'track'
    });
    stop();
  });
});
