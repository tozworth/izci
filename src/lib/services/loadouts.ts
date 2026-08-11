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
  type PlaylistItem,
  type RafRackSettings
} from '$lib/types';

export const LOADOUT_CATEGORIES: LoadoutCategory[] = [
  'playback',
  'raf',
  'appearance'
];

const MANUAL_LOADOUT_CHANNEL = 'izci-manual-loadout';

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
    return {
      name: track.name,
      target: { type: 'file', fileKey: getLoadoutFileKey(track), fileName: track.name }
    };
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
  if (!playbackSettings.getSnapshot().enableRaf) return false;
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
      replayGainMode: playback.replayGainMode,
      modules: { ...modulePlaybackSettings.getSnapshot() }
    };
  }
  if (selected.has('raf')) {
    const state = rafPresets.getSnapshot();
    const preset = state.presets.find((candidate) => candidate.id === state.selectedPresetId)!;
    settings.raf = { presetName: preset.name, enabled: rafSettings.getSnapshot().enabled };
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
  if (settings.playback) {
    playbackSettings.update(settings.playback);
    modulePlaybackSettings.set(settings.playback.modules);
  }
  if (settings.raf) {
    const preset = rafPresets.getSnapshot().presets.find(
      (candidate) => normalizedComparisonText(candidate.name) === normalizedComparisonText(settings.raf!.presetName)
    );
    if (preset) rafPresets.apply(preset.id, settings.raf.enabled);
  }
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
  | { category: 'appearance'; value: LoadoutAppearanceSettings };

type ManualLoadoutCommand = {
  type: 'apply';
  baselines: RuntimeLoadoutBaseline[];
};

const manualLoadoutHandlers = new Set<(baselines: RuntimeLoadoutBaseline[]) => void>();
let manualLoadoutChannel: BroadcastChannel | null = null;

function isRuntimeLoadoutBaseline(value: unknown): value is RuntimeLoadoutBaseline {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<RuntimeLoadoutBaseline>;
  return LOADOUT_CATEGORIES.includes(source.category as LoadoutCategory) && 'value' in source;
}

function normalizeManualLoadoutCommand(value: unknown): ManualLoadoutCommand | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<ManualLoadoutCommand>;
  if (source.type !== 'apply' || !Array.isArray(source.baselines)) return null;
  const baselines = source.baselines.filter(isRuntimeLoadoutBaseline);
  return baselines.length === source.baselines.length ? { type: 'apply', baselines } : null;
}

function getManualLoadoutChannel(): BroadcastChannel | null {
  if (manualLoadoutChannel || typeof window === 'undefined' || !('BroadcastChannel' in window)) {
    return manualLoadoutChannel;
  }
  manualLoadoutChannel = new BroadcastChannel(MANUAL_LOADOUT_CHANNEL);
  manualLoadoutChannel.addEventListener('message', (event) => {
    const command = normalizeManualLoadoutCommand(event.data);
    if (!command) return;
    for (const handler of manualLoadoutHandlers) handler(command.baselines);
  });
  return manualLoadoutChannel;
}

function captureRuntimeBaseline(category: LoadoutCategory): RuntimeLoadoutBaseline {
  switch (category) {
    case 'playback': {
      const playback = playbackSettings.getSnapshot();
      return {
        category,
        value: {
          playbackRate: playback.playbackRate,
          trueSpeed: playback.trueSpeed,
          replayGainMode: playback.replayGainMode,
          modules: { ...modulePlaybackSettings.getSnapshot() }
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
      modulePlaybackSettings.set(baseline.value.modules);
      break;
    case 'raf':
      rafSettings.replace(baseline.value.settings);
      rafPresets.setSelectedPresetId(baseline.value.selectedPresetId);
      break;
    case 'appearance':
      appearanceSettings.update({ backdropZones: baseline.value.backdropZones });
      visualizerSettings.set(baseline.value.visualizer);
      break;
  }
}

/**
 * Applies a loadout as a durable manual settings change. Active automatic
 * overrides for the same categories are abandoned without restoring their old
 * baselines, so a later track change cannot undo the manual load.
 */
export function applyManualLoadoutSettings(settings: LoadoutSettings): void {
  applyLoadoutSettings(settings);
  const baselines = getLoadoutCategories(settings).map(captureRuntimeBaseline);
  for (const handler of manualLoadoutHandlers) handler(baselines);
  getManualLoadoutChannel()?.postMessage({ type: 'apply', baselines } satisfies ManualLoadoutCommand);
}

export function startLoadoutRuntime(trackStore: Readable<PlaylistItem | null>): () => void {
  let track: LoadoutTrackContext | null = null;
  let state = loadouts.getSnapshot();
  let folders = filesystemFolders.getSnapshot();
  let activeTrackKey: string | null = null;
  const activeTokens: Partial<Record<LoadoutCategory, string>> = {};
  const baselines: Partial<Record<LoadoutCategory, RuntimeLoadoutBaseline>> = {};
  const manuallySuppressedTrackKeys: Partial<Record<LoadoutCategory, string>> = {};

  const restoreCategory = (category: LoadoutCategory) => {
    const baseline = baselines[category];
    delete activeTokens[category];
    delete baselines[category];
    if (baseline) restoreRuntimeBaseline(baseline);
  };

  const restoreAll = () => {
    for (const category of [...LOADOUT_CATEGORIES].reverse()) restoreCategory(category);
  };

  const clearManualSuppressions = () => {
    for (const category of LOADOUT_CATEGORIES) delete manuallySuppressedTrackKeys[category];
  };

  const commitManualBaselines = (committedBaselines: RuntimeLoadoutBaseline[]) => {
    for (const baseline of committedBaselines) {
      delete activeTokens[baseline.category];
      delete baselines[baseline.category];
      if (activeTrackKey) manuallySuppressedTrackKeys[baseline.category] = activeTrackKey;
      restoreRuntimeBaseline(baseline);
    }
  };

  manualLoadoutHandlers.add(commitManualBaselines);
  getManualLoadoutChannel();

  const reconcileAutomatic = () => {
    const nextTrackKey = track ? getLoadoutFileKey(track) : null;
    if (nextTrackKey !== activeTrackKey) {
      activeTrackKey = nextTrackKey;
      clearManualSuppressions();
    }

    if (!track || !state.automaticEnabled) {
      restoreAll();
      if (!state.automaticEnabled) clearManualSuppressions();
      return;
    }

    const resolved = resolveAutomaticLoadouts(state, track, folders);

    for (const category of LOADOUT_CATEGORIES) {
      if (manuallySuppressedTrackKeys[category] === activeTrackKey) continue;
      const loadout = resolved[category];
      const categorySettings = loadout?.settings[category];
      const nextToken = loadout && categorySettings
        ? `${loadout.id}:${loadout.updatedAt}`
        : undefined;

      if (activeTokens[category] === nextToken) continue;

      if (!nextToken || !categorySettings) {
        restoreCategory(category);
        continue;
      }

      // Keep the original non-loadout baseline while moving directly between
      // automatic overrides. Restoring and immediately recapturing it at every
      // track boundary lets rapid changes promote transient settings into the
      // next baseline before the category ever becomes unmatched.
      if (!activeTokens[category]) {
        baselines[category] = captureRuntimeBaseline(category);
      }
      activeTokens[category] = nextToken;
      applyLoadoutSettings({ [category]: categorySettings });
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
    manualLoadoutHandlers.delete(commitManualBaselines);
    restoreAll();
  };
}
