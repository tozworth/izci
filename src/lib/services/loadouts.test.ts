import { writable } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import type { FilesystemFolder } from './filesystem-folders';
import {
  applyLoadoutSettings,
  applyManualLoadoutSettings,
  captureLoadoutSettings,
  getLoadoutFileKey,
  matchesLoadoutTarget,
  resolveAutomaticLoadouts,
  resolveLoadoutFolderContext,
  resolveRecognizedTrackType,
  startLoadoutRuntime
} from './loadouts';
import { loadouts as loadoutStore } from '$lib/stores/loadouts';
import { DEFAULT_MODULE_PLAYBACK_SETTINGS, modulePlaybackSettings } from '$lib/stores/module-playback-settings';
import { playbackSettings } from '$lib/stores/playback-settings';
import { rafPresets } from '$lib/stores/raf-presets';
import { rafSettings } from '$lib/stores/raf-settings';
import type { Loadout, LoadoutPlaybackSettings, LoadoutState, LoadoutTrackContext } from '$lib/contracts/loadouts';
import type { MediaEntity } from '$lib/contracts/catalog';

function playback(
  values: Pick<LoadoutPlaybackSettings, 'playbackRate' | 'trueSpeed' | 'replayGainMode'>,
  modules: Partial<LoadoutPlaybackSettings['modules']> = {}
): LoadoutPlaybackSettings {
  return {
    ...values,
    modules: { ...DEFAULT_MODULE_PLAYBACK_SETTINGS, ...modules }
  };
}

const folder = {
  id: 'folder-1',
  name: 'Modules',
  handle: { kind: 'directory', name: 'Modules' } as FileSystemDirectoryHandle,
  addedAt: 1,
  definitionRevision: 1,
  scanGeneration: 0,
  permission: 'granted',
  libraryMode: null,
  lastScanStatus: 'never'
} satisfies FilesystemFolder;

function track(overrides: Partial<LoadoutTrackContext> = {}): LoadoutTrackContext {
  return {
    name: 'Artist - Song.custom',
    path: 'Modules/Album/Artist - Song.custom',
    format: 'custom',
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
      playback: playback({ playbackRate: 1.25, trueSpeed: true, replayGainMode: 'album' })
    });
    const folderBaseline = loadout('folder-baseline', { type: 'path', folderId: folder.id, folderName: folder.name }, {
      playback: playback({ playbackRate: 0.9, trueSpeed: false, replayGainMode: 'track' }),
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
        playback: playback({ playbackRate: 2, trueSpeed: false, replayGainMode: 'off' })
      })]
    };
    expect(resolveAutomaticLoadouts(state, track(), [folder])).toEqual({});
  });
});

describe('automatic loadout runtime', () => {
  const originalPlayback = playbackSettings.getSnapshot();
  const originalModules = modulePlaybackSettings.getSnapshot();
  const originalRafSettings = rafSettings.getSnapshot();

  afterEach(() => {
    loadoutStore.reset();
    playbackSettings.set(originalPlayback);
    modulePlaybackSettings.set(originalModules);
    rafPresets.reset();
    rafSettings.replace(originalRafSettings);
  });

  it('captures media and module controls as one playback category', () => {
    playbackSettings.update({ playbackRate: 1.25, trueSpeed: true, replayGainMode: 'album' });
    modulePlaybackSettings.update({ panStrength: 140, tempoFactor: 1.5 });

    expect(captureLoadoutSettings(['playback'])?.playback).toEqual(
      playback(
        { playbackRate: 1.25, trueSpeed: true, replayGainMode: 'album' },
        { panStrength: 140, tempoFactor: 1.5 }
      )
    );
  });

  it('does not capture Raf while the feature is disabled', () => {
    playbackSettings.update({ enableRaf: false });
    rafPresets.create('Dormant rack');

    expect(captureLoadoutSettings(['raf'])).toBeNull();
  });

  it('captures and reapplies the Raf enabled state with its preset', () => {
    playbackSettings.update({ enableRaf: true });
    rafSettings.reset();
    rafSettings.setEnabled(false);
    rafPresets.create('Clean');

    const captured = captureLoadoutSettings(['raf']);
    expect(captured?.raf).toEqual({ presetName: 'Clean', enabled: false });

    rafSettings.setEnabled(true);
    applyLoadoutSettings(captured!);
    expect(rafSettings.getSnapshot().enabled).toBe(false);
  });

  it('applies the Raf rack and bypass state before selecting the loadout preset', () => {
    rafSettings.reset();
    const oldPreset = rafPresets.create('Old rack')!;
    rafSettings.addEffect('stereo-width');
    const newPreset = rafPresets.create('New rack')!;
    rafPresets.apply(oldPreset.id);

    let rackWhenNewPresetWasSelected = rafSettings.getSnapshot();
    const unsubscribe = rafPresets.subscribe((state) => {
      if (state.selectedPresetId === newPreset.id) {
        rackWhenNewPresetWasSelected = structuredClone(rafSettings.getSnapshot());
      }
    });

    applyLoadoutSettings({ raf: { presetName: newPreset.name, enabled: false } });
    unsubscribe();

    expect(rackWhenNewPresetWasSelected).toEqual({
      enabled: false,
      effects: newPreset.settings.effects
    });
    expect(rafSettings.getSnapshot()).toEqual(rackWhenNewPresetWasSelected);
  });

  it('turns Raf off when switching from a Raf-on loadout to a Raf-off loadout', () => {
    rafSettings.reset();
    const preset = rafPresets.create('Track rack')!;
    const rafOnTrack: MediaEntity = {
      id: 'raf-on', path: 'test', name: 'Raf on.flac', format: 'flac', kind: 'stream', size: 10, lastModified: 1
    };
    const rafOffTrack: MediaEntity = {
      id: 'raf-off', path: 'test', name: 'Raf off.flac', format: 'flac', kind: 'stream', size: 11, lastModified: 2
    };
    loadoutStore.create('Raf on', { type: 'file', fileKey: getLoadoutFileKey(rafOnTrack) }, {
      raf: { presetName: preset.name, enabled: true }
    });
    loadoutStore.create('Raf off', { type: 'file', fileKey: getLoadoutFileKey(rafOffTrack) }, {
      raf: { presetName: preset.name, enabled: false }
    });
    const tracks = writable<MediaEntity | null>(null);
    const stop = startLoadoutRuntime(tracks);

    tracks.set(rafOnTrack);
    expect(rafSettings.getSnapshot().enabled).toBe(true);

    tracks.set(rafOffTrack);
    expect(rafSettings.getSnapshot().enabled).toBe(false);
    stop();
  });

  it('restores the previous category settings before an unmatched track inherits them', () => {
    playbackSettings.update({ playbackRate: 0.8, trueSpeed: true, replayGainMode: 'off' });
    modulePlaybackSettings.update({ panStrength: 70 });
    loadoutStore.reset();
    loadoutStore.create('FLAC', { type: 'type', recognizedType: 'flac' }, {
      playback: playback(
        { playbackRate: 1.5, trueSpeed: false, replayGainMode: 'album' },
        { panStrength: 140 }
      )
    });
    const tracks = writable<MediaEntity | null>(null);
    const stop = startLoadoutRuntime(tracks);

    tracks.set({
      id: 'flac', path: 'test', name: 'Song.flac', format: 'flac', kind: 'stream', size: 1, lastModified: 1
    });
    expect(playbackSettings.getSnapshot()).toMatchObject({
      playbackRate: 1.5,
      trueSpeed: false,
      replayGainMode: 'album'
    });
    expect(modulePlaybackSettings.getSnapshot().panStrength).toBe(140);

    tracks.set({
      id: 'mp3', path: 'test', name: 'Next.mp3', format: 'mp3', kind: 'stream', size: 2, lastModified: 2
    });
    expect(playbackSettings.getSnapshot()).toMatchObject({
      playbackRate: 0.8,
      trueSpeed: true,
      replayGainMode: 'off'
    });
    expect(modulePlaybackSettings.getSnapshot().panStrength).toBe(70);
    stop();
  });

  it('keeps one Raf baseline while rapidly moving between matching tracks', () => {
    rafSettings.reset();
    rafSettings.addEffect('stereo-width');
    const widePreset = rafPresets.create('Wide track')!;
    rafSettings.reset();
    rafSettings.addEffect('crystalizer');
    const brightPreset = rafPresets.create('Bright track')!;
    rafSettings.replace({ enabled: false, effects: [] });
    rafPresets.setSelectedPresetId(null);

    const wideTrack: MediaEntity = {
      id: 'wide', path: 'test', name: 'Wide.flac', format: 'flac', kind: 'stream', size: 10, lastModified: 1
    };
    const brightTrack: MediaEntity = {
      id: 'bright', path: 'test', name: 'Bright.flac', format: 'flac', kind: 'stream', size: 11, lastModified: 2
    };
    loadoutStore.create('Wide', { type: 'file', fileKey: getLoadoutFileKey(wideTrack) }, {
      raf: { presetName: widePreset.name, enabled: true }
    });
    loadoutStore.create('Bright', { type: 'file', fileKey: getLoadoutFileKey(brightTrack) }, {
      raf: { presetName: brightPreset.name, enabled: true }
    });

    const tracks = writable<MediaEntity | null>(null);
    const stop = startLoadoutRuntime(tracks);
    tracks.set(wideTrack);

    const observedRacks: ReturnType<typeof rafSettings.getSnapshot>[] = [];
    const unsubscribe = rafSettings.subscribe((settings) => observedRacks.push(settings));
    observedRacks.length = 0;
    tracks.set(brightTrack);

    expect(observedRacks.some((settings) => settings.effects.length === 0)).toBe(false);
    expect(rafSettings.getSnapshot().effects[0]?.type).toBe('crystalizer');

    for (let index = 0; index < 20; index += 1) {
      tracks.set(index % 2 === 0 ? wideTrack : brightTrack);
    }
    tracks.set({
      id: 'plain', path: 'test', name: 'Plain.mp3', format: 'mp3', kind: 'stream', size: 12, lastModified: 3
    });

    expect(rafSettings.getSnapshot()).toEqual({ enabled: false, effects: [] });
    expect(rafPresets.getSnapshot().selectedPresetId).toBeNull();
    unsubscribe();
    stop();
  });

  it('restores active overrides when automatic application is disabled', () => {
    playbackSettings.update({ playbackRate: 1, trueSpeed: false, replayGainMode: 'track' });
    loadoutStore.reset();
    loadoutStore.create('FLAC', { type: 'type', recognizedType: 'flac' }, {
      playback: playback({ playbackRate: 2, trueSpeed: true, replayGainMode: 'off' })
    });
    const tracks = writable<MediaEntity | null>({
      id: 'flac', path: 'test', name: 'Song.flac', format: 'flac', kind: 'stream', size: 1, lastModified: 1
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

  it('commits a manual load without restoring the automatic baseline later', () => {
    playbackSettings.update({ playbackRate: 1, trueSpeed: false, replayGainMode: 'track' });
    loadoutStore.reset();
    loadoutStore.create('FLAC', { type: 'type', recognizedType: 'flac' }, {
      playback: playback({ playbackRate: 2, trueSpeed: true, replayGainMode: 'off' })
    });
    const tracks = writable<MediaEntity | null>({
      id: 'flac', path: 'test', name: 'Song.flac', format: 'flac', kind: 'stream', size: 1, lastModified: 1
    });
    const stop = startLoadoutRuntime(tracks);
    expect(playbackSettings.getSnapshot().playbackRate).toBe(2);

    applyManualLoadoutSettings({
      playback: playback({ playbackRate: 0.75, trueSpeed: false, replayGainMode: 'album' })
    });
    expect(playbackSettings.getSnapshot()).toMatchObject({
      playbackRate: 0.75,
      trueSpeed: false,
      replayGainMode: 'album'
    });

    playbackSettings.update({ playbackRate: 0.8 });
    tracks.set({
      id: 'mp3', path: 'test', name: 'Next.mp3', format: 'mp3', kind: 'stream', size: 2, lastModified: 2
    });
    expect(playbackSettings.getSnapshot()).toMatchObject({
      playbackRate: 0.8,
      trueSpeed: false,
      replayGainMode: 'album'
    });
    stop();
    expect(playbackSettings.getSnapshot().playbackRate).toBe(0.8);
  });
});
