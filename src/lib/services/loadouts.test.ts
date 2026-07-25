import { writable } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import type { FilesystemFolder } from './filesystem-folders';
import {
  applyLoadoutSettings,
  captureLoadoutSettings,
  getLoadoutFileKey,
  matchesLoadoutTarget,
  resolveAutomaticLoadouts,
  resolveLoadoutFolderContext,
  resolveRecognizedTrackType,
  startLoadoutRuntime
} from './loadouts';
import { loadouts as loadoutStore } from '$lib/stores/loadouts';
import { playbackSettings } from '$lib/stores/playback-settings';
import { rafPresets } from '$lib/stores/raf-presets';
import { rafSettings } from '$lib/stores/raf-settings';
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
  it('applies only the first matching loadout from top to bottom', () => {
    const currentTrack = track();
    const fileOverride = loadout('file-override', { type: 'file', fileKey: getLoadoutFileKey(currentTrack) }, {
      playback: { playbackRate: 1.25, trueSpeed: true, replayGainMode: 'album' }
    });
    const folderBaseline = loadout('folder-baseline', { type: 'path', folderId: folder.id, folderName: folder.name }, {
      playback: { playbackRate: 0.9, trueSpeed: false, replayGainMode: 'track' },
      appearance: {
        backdropZones: { left: 'none', center: 'none', right: 'none', player: 'none', nowPlaying: 'artwork' },
        visualizer: {
          style: 'bars', colorSource: 'theme', height: 0.5, transparency: 0.4,
          frameRateLimit: 60, normalizationStrength: 0.4, triangleCount: 64,
          triangleMinSize: 0.1, triangleMaxSize: 0.5, triangleBaseSpeed: 1,
          triangleReactiveSpeed: 1, triangleBorderWidth: 1
        }
      }
    });
    const state: LoadoutState = {
      automaticEnabled: true,
      loadouts: [fileOverride, folderBaseline]
    };

    const resolved = resolveAutomaticLoadouts(state, currentTrack, [folder]);
    expect(resolved.playback?.id).toBe('file-override');
    expect(resolved.appearance).toBeUndefined();

    const reordered = resolveAutomaticLoadouts(
      { ...state, loadouts: [folderBaseline, fileOverride] },
      currentTrack,
      [folder]
    );
    expect(reordered.playback?.id).toBe('folder-baseline');
    expect(reordered.appearance?.id).toBe('folder-baseline');
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
  const originalRafSettings = rafSettings.getSnapshot();

  afterEach(() => {
    loadoutStore.reset();
    playbackSettings.set(originalPlayback);
    rafPresets.reset();
    rafSettings.replace(originalRafSettings);
  });

  it('captures and reapplies the Raf enabled state with its preset', () => {
    rafSettings.reset();
    rafSettings.setEnabled(false);
    rafPresets.create('Clean');

    const captured = captureLoadoutSettings(['raf']);
    expect(captured?.raf).toEqual({ presetName: 'Clean', enabled: false });

    rafSettings.setEnabled(true);
    applyLoadoutSettings(captured!);
    expect(rafSettings.getSnapshot().enabled).toBe(false);
  });

  it('turns Raf off when switching from a Raf-on loadout to a Raf-off loadout', () => {
    rafSettings.reset();
    const preset = rafPresets.create('Track rack')!;
    const rafOnTrack: PlaylistItem = {
      id: 'raf-on', name: 'Raf on.flac', extension: 'flac', kind: 'stream', size: 10, lastModified: 1
    };
    const rafOffTrack: PlaylistItem = {
      id: 'raf-off', name: 'Raf off.flac', extension: 'flac', kind: 'stream', size: 11, lastModified: 2
    };
    loadoutStore.create('Raf on', { type: 'file', fileKey: getLoadoutFileKey(rafOnTrack) }, {
      raf: { presetName: preset.name, enabled: true }
    });
    loadoutStore.create('Raf off', { type: 'file', fileKey: getLoadoutFileKey(rafOffTrack) }, {
      raf: { presetName: preset.name, enabled: false }
    });
    const tracks = writable<PlaylistItem | null>(null);
    const stop = startLoadoutRuntime(tracks);

    tracks.set(rafOnTrack);
    expect(rafSettings.getSnapshot().enabled).toBe(true);

    tracks.set(rafOffTrack);
    expect(rafSettings.getSnapshot().enabled).toBe(false);
    stop();
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
