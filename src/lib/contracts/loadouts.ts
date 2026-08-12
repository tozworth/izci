import type {
  BackdropZoneSettings,
  VisualizerSettings,
} from './appearance-settings';
import type { TrackKind } from './media-format';
import type { TrackMetadata } from './media-metadata';
import type { ModulePlaybackSettings } from './module-playback';
import type { ReplayGainMode } from './playback';

export type LoadoutType = 'file' | 'path' | 'type' | 'tags' | 'preset';
export type LoadoutCategory = 'playback' | 'raf' | 'appearance';
export type LoadoutColor =
  | 'white'
  | 'red'
  | 'orange'
  | 'amber'
  | 'lime'
  | 'green'
  | 'teal'
  | 'cyan'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'magenta';

export interface LoadoutTrackContext {
  name: string;
  path?: string;
  sourceFolderId?: string;
  extension: string;
  kind: TrackKind;
  size: number;
  lastModified: number;
  metadata?: TrackMetadata;
}

export type LoadoutTarget =
  | { type: 'file'; fileKey: string; fileName?: string }
  | { type: 'path'; folderId: string; folderName: string }
  | { type: 'type'; recognizedType: string }
  | { type: 'tags'; pattern: string }
  | { type: 'preset' };

export interface LoadoutPlaybackSettings {
  playbackRate: number;
  trueSpeed: boolean;
  replayGainMode: ReplayGainMode;
  modules: ModulePlaybackSettings;
}

export interface LoadoutRafSettings {
  presetName: string;
  enabled: boolean;
}

export interface LoadoutAppearanceSettings {
  backdropZones: BackdropZoneSettings;
  visualizer: VisualizerSettings;
}

export interface LoadoutSettings {
  playback?: LoadoutPlaybackSettings;
  raf?: LoadoutRafSettings;
  appearance?: LoadoutAppearanceSettings;
}

export interface Loadout {
  id: string;
  name: string;
  color?: LoadoutColor;
  target: LoadoutTarget;
  settings: LoadoutSettings;
  createdAt: number;
  updatedAt: number;
}

export interface LoadoutState {
  automaticEnabled: boolean;
  loadouts: Loadout[];
}
