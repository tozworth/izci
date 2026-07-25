import type { Readable } from 'svelte/store';
import { filesystemFolders, type FilesystemFolder } from './filesystem-folders';
import { startLoadoutTrackContextPublisher } from './loadout-track-context';
import { appearanceSettings } from '$lib/stores/appearance-settings';
import { loadouts } from '$lib/stores/loadouts';
import { modulePlaybackSettings } from '$lib/stores/module-playback-settings';
import { playbackSettings } from '$lib/stores/playback-settings';
import { rafPresets } from '$lib/stores/raf-presets';
import { rafSettings } from '$lib/stores/raf-settings';
import { visualizerSettings } from '$lib/stores/visualizer-settings';
import {
  MODULE_EXTENSIONS,
  STREAM_EXTENSIONS,
  VIDEO_EXTENSIONS,
  type Loadout,
  type LoadoutAppearanceSettings,
  type LoadoutCategory,
  type LoadoutPlaybackSettings,
  type LoadoutSettings,
  type LoadoutState,
  type LoadoutTarget,
  type LoadoutTrackContext,
  type LoadoutType,
  type ModulePlaybackSettings,
  type PlaylistItem,
  type RafRackSettings
} from '$lib/types';

export const LOADOUT_CATEGORIES: LoadoutCategory[] = [
  'playback',
  'raf',
  'modules',
  'appearance'
];

export interface LoadoutFolderContext {
  id: string;
  name: string;
}

function normalizePath(value: string | undefined): string {
  return (value ?? '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

function normalizedComparisonText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function getLoadoutFileKey(track: LoadoutTrackContext): string {
  const location = normalizePath(track.path) || track.name;
  return `${normalizedComparisonText(location)}:${track.size}:${track.lastModified}`;
}

export function resolveRecognizedTrackType(track: LoadoutTrackContext): string | null {
  const originalType = track.metadata?.originalType?.trim().toLowerCase();
  if (originalType) return originalType;

  const extension = track.extension.trim().toLowerCase();
  if (track.kind === 'stream' && STREAM_EXTENSIONS.includes(extension as (typeof STREAM_EXTENSIONS)[number])) {
    return extension;
  }
  if (track.kind === 'video' && VIDEO_EXTENSIONS.includes(extension as (typeof VIDEO_EXTENSIONS)[number])) {
    return extension;
  }
  if (track.kind === 'module' && MODULE_EXTENSIONS.includes(extension as (typeof MODULE_EXTENSIONS)[number])) {
    return extension;
  }
  return null;
}

function getRootFolderName(path: string | undefined): string | null {
  const normalized = normalizePath(path);
  const separator = normalized.indexOf('/');
  return separator > 0 ? normalized.slice(0, separator) : null;
}

export function resolveLoadoutFolderContext(
  track: LoadoutTrackContext,
  folders: FilesystemFolder[]
): LoadoutFolderContext | null {
  if (track.sourceFolderId) {
    const direct = folders.find((folder) => folder.id === track.sourceFolderId);
    if (direct) return { id: direct.id, name: direct.name };
  }

  const rootName = getRootFolderName(track.path);
  if (!rootName) return null;
  const matchingFolders = folders.filter(
    (folder) => normalizedComparisonText(folder.name) === normalizedComparisonText(rootName)
  );
  return matchingFolders.length === 1
    ? { id: matchingFolders[0].id, name: matchingFolders[0].name }
    : null;
}

function buildTagMatchText(track: LoadoutTrackContext): string {
  const metadataValues = Object.values(track.metadata ?? {}).flatMap((value) => {
    if (typeof value === 'string' || typeof value === 'number') return [String(value)];
    if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string');
    return [];
  });
  return [track.name, ...metadataValues].join('\n');
}

export function isValidLoadoutPattern(pattern: string): boolean {
  try {
    new RegExp(pattern, 'i');
    return pattern.trim().length > 0;
  } catch {
    return false;
  }
}

export function matchesLoadoutTarget(
  target: LoadoutTarget,
  track: LoadoutTrackContext,
  folders: FilesystemFolder[]
): boolean {
  switch (target.type) {
    case 'file':
      return target.fileKey === getLoadoutFileKey(track);
    case 'path': {
      const folder = resolveLoadoutFolderContext(track, folders);
      return Boolean(
        folder &&
        (folder.id === target.folderId ||
          normalizedComparisonText(folder.name) === normalizedComparisonText(target.folderName))
      );
    }
    case 'type':
      return resolveRecognizedTrackType(track) === target.recognizedType;
    case 'tags':
      try {
        return new RegExp(target.pattern, 'i').test(buildTagMatchText(track));
      } catch {
        return false;
      }
    case 'preset':
      return false;
  }
}

export function createLoadoutTarget(
  type: LoadoutType,
  track: LoadoutTrackContext | null,
  folders: FilesystemFolder[],
  manualText = ''
): { name: string; target: LoadoutTarget } | null {
  if (type === 'tags') {
    const pattern = manualText.trim();
    return isValidLoadoutPattern(pattern)
      ? { name: pattern, target: { type: 'tags', pattern } }
      : null;
  }
  if (type === 'preset') {
    const name = manualText.trim().replace(/\s+/g, ' ').slice(0, 240);
    return name ? { name, target: { type: 'preset' } } : null;
  }
  if (!track) return null;

  if (type === 'file') {
    return { name: track.name, target: { type: 'file', fileKey: getLoadoutFileKey(track) } };
  }
  if (type === 'path') {
    const folder = resolveLoadoutFolderContext(track, folders);
    return folder
      ? { name: folder.name, target: { type: 'path', folderId: folder.id, folderName: folder.name } }
      : null;
  }

  const recognizedType = resolveRecognizedTrackType(track);
  return recognizedType
    ? { name: recognizedType.toUpperCase(), target: { type: 'type', recognizedType } }
    : null;
}

export function getLoadoutCategories(settings: LoadoutSettings): LoadoutCategory[] {
  return LOADOUT_CATEGORIES.filter((category) => settings[category] !== undefined);
}

export function canCaptureLoadoutCategories(categories: Iterable<LoadoutCategory>): boolean {
  const selected = new Set(categories);
  if (selected.size === 0) return false;
  if (!selected.has('raf')) return true;
  const state = rafPresets.getSnapshot();
  return state.presets.some((preset) => preset.id === state.selectedPresetId);
}

export function captureLoadoutSettings(
  categories: Iterable<LoadoutCategory>
): LoadoutSettings | null {
  const selected = new Set(categories);
  if (!canCaptureLoadoutCategories(selected)) return null;
  const settings: LoadoutSettings = {};

  if (selected.has('playback')) {
    const playback = playbackSettings.getSnapshot();
    settings.playback = {
      playbackRate: playback.playbackRate,
      trueSpeed: playback.trueSpeed,
      replayGainMode: playback.replayGainMode
    };
  }
  if (selected.has('raf')) {
    const state = rafPresets.getSnapshot();
    const preset = state.presets.find((candidate) => candidate.id === state.selectedPresetId)!;
    settings.raf = { presetName: preset.name, enabled: rafSettings.getSnapshot().enabled };
  }
  if (selected.has('modules')) {
    settings.modules = { ...modulePlaybackSettings.getSnapshot() };
  }
  if (selected.has('appearance')) {
    settings.appearance = {
      backdropZones: { ...appearanceSettings.getSnapshot().backdropZones },
      visualizer: { ...visualizerSettings.getSnapshot() }
    };
  }

  return settings;
}

export function applyLoadoutSettings(settings: LoadoutSettings): void {
  if (settings.playback) playbackSettings.update(settings.playback);
  if (settings.raf) {
    const preset = rafPresets.getSnapshot().presets.find(
      (candidate) => normalizedComparisonText(candidate.name) === normalizedComparisonText(settings.raf!.presetName)
    );
    if (preset) {
      rafPresets.apply(preset.id);
      rafSettings.setEnabled(settings.raf.enabled);
    }
  }
  if (settings.modules) modulePlaybackSettings.set(settings.modules);
  if (settings.appearance) {
    appearanceSettings.update({ backdropZones: settings.appearance.backdropZones });
    visualizerSettings.set(settings.appearance.visualizer);
  }
}

export function resolveAutomaticLoadouts(
  state: LoadoutState,
  track: LoadoutTrackContext,
  folders: FilesystemFolder[]
): Partial<Record<LoadoutCategory, Loadout>> {
  if (!state.automaticEnabled) return {};
  const loadout = state.loadouts.find((candidate) =>
    matchesLoadoutTarget(candidate.target, track, folders)
  );
  if (!loadout) return {};
  const resolved: Partial<Record<LoadoutCategory, Loadout>> = {};
  for (const category of getLoadoutCategories(loadout.settings)) {
    resolved[category] = loadout;
  }
  return resolved;
}

type RuntimeLoadoutBaseline =
  | { category: 'playback'; value: LoadoutPlaybackSettings }
  | { category: 'raf'; value: { selectedPresetId: string | null; settings: RafRackSettings } }
  | { category: 'modules'; value: ModulePlaybackSettings }
  | { category: 'appearance'; value: LoadoutAppearanceSettings };

function captureRuntimeBaseline(category: LoadoutCategory): RuntimeLoadoutBaseline {
  switch (category) {
    case 'playback': {
      const playback = playbackSettings.getSnapshot();
      return {
        category,
        value: {
          playbackRate: playback.playbackRate,
          trueSpeed: playback.trueSpeed,
          replayGainMode: playback.replayGainMode
        }
      };
    }
    case 'raf':
      return {
        category,
        value: {
          selectedPresetId: rafPresets.getSnapshot().selectedPresetId,
          settings: structuredClone(rafSettings.getSnapshot())
        }
      };
    case 'modules':
      return { category, value: { ...modulePlaybackSettings.getSnapshot() } };
    case 'appearance':
      return {
        category,
        value: {
          backdropZones: { ...appearanceSettings.getSnapshot().backdropZones },
          visualizer: { ...visualizerSettings.getSnapshot() }
        }
      };
  }
}

function restoreRuntimeBaseline(baseline: RuntimeLoadoutBaseline): void {
  switch (baseline.category) {
    case 'playback':
      playbackSettings.update(baseline.value);
      break;
    case 'raf':
      rafSettings.replace(baseline.value.settings);
      rafPresets.setSelectedPresetId(baseline.value.selectedPresetId);
      break;
    case 'modules':
      modulePlaybackSettings.set(baseline.value);
      break;
    case 'appearance':
      appearanceSettings.update({ backdropZones: baseline.value.backdropZones });
      visualizerSettings.set(baseline.value.visualizer);
      break;
  }
}

export function startLoadoutRuntime(trackStore: Readable<PlaylistItem | null>): () => void {
  let track: LoadoutTrackContext | null = null;
  let state = loadouts.getSnapshot();
  let folders = filesystemFolders.getSnapshot();
  let activeTrackKey: string | null = null;
  const activeTokens: Partial<Record<LoadoutCategory, string>> = {};
  const baselines: Partial<Record<LoadoutCategory, RuntimeLoadoutBaseline>> = {};

  const restoreCategory = (category: LoadoutCategory) => {
    const baseline = baselines[category];
    delete activeTokens[category];
    delete baselines[category];
    if (baseline) restoreRuntimeBaseline(baseline);
  };

  const restoreAll = () => {
    for (const category of [...LOADOUT_CATEGORIES].reverse()) restoreCategory(category);
  };

  const reconcileAutomatic = () => {
    const nextTrackKey = track ? getLoadoutFileKey(track) : null;
    if (nextTrackKey !== activeTrackKey) {
      restoreAll();
      activeTrackKey = nextTrackKey;
    }

    if (!track || !state.automaticEnabled) {
      restoreAll();
      return;
    }

    const resolved = resolveAutomaticLoadouts(state, track, folders);

    for (const category of LOADOUT_CATEGORIES) {
      const loadout = resolved[category];
      const categorySettings = loadout?.settings[category];
      const nextToken = loadout && categorySettings
        ? `${loadout.id}:${loadout.updatedAt}`
        : undefined;

      if (activeTokens[category] === nextToken) continue;
      restoreCategory(category);

      if (nextToken && categorySettings) {
        baselines[category] = captureRuntimeBaseline(category);
        activeTokens[category] = nextToken;
        applyLoadoutSettings({ [category]: categorySettings });
      }
    }
  };

  const stopPublisher = startLoadoutTrackContextPublisher(trackStore);
  const stopTrack = trackStore.subscribe((value) => {
    track = value;
    reconcileAutomatic();
  });
  const stopLoadouts = loadouts.subscribe((value) => {
    state = value;
    reconcileAutomatic();
  });
  const stopFolders = filesystemFolders.subscribe((value) => {
    folders = value;
    reconcileAutomatic();
  });
  const handlePageHide = () => restoreAll();
  const handlePageShow = () => reconcileAutomatic();
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
  }

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
    }
    stopFolders();
    stopLoadouts();
    stopTrack();
    stopPublisher();
    restoreAll();
  };
}
