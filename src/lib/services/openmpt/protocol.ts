import type { ModulePatternSong, TrackMetadata } from '$lib/types';

export interface OpenMptSettings {
  repeatCount: number;
  stereoSeparation: number;
  interpolationFilter: number;
  tempoFactor: number;
  pitchFactor: number;
}

export const DEFAULT_OPENMPT_SETTINGS: OpenMptSettings = {
  repeatCount: 0, stereoSeparation: 100, interpolationFilter: 4, tempoFactor: 1, pitchFactor: 1
};

export interface OpenMptProgress {
  currentTime: number;
  order: number;
  pattern: number;
  row: number;
  subsong: number;
}

export interface OpenMptInspection {
  metadata: TrackMetadata;
  subsong: number;
  song?: ModulePatternSong;
}

export type OpenMptCommand =
  | { type: 'load'; id: number; buffer: ArrayBuffer; subsong: number; settings: OpenMptSettings }
  | { type: 'play' | 'pause' | 'dispose'; id?: number }
  | { type: 'seek'; seconds: number }
  | { type: 'subsong'; subsong: number }
  | { type: 'settings'; settings: OpenMptSettings }
  | { type: 'channels'; muted: boolean[] };

export type OpenMptEvent =
  | { type: 'ready' | 'disposed' | 'ended' }
  | { type: 'loaded'; id: number; inspection: OpenMptInspection }
  | { type: 'metadata'; inspection: OpenMptInspection }
  | { type: 'progress'; progress: OpenMptProgress }
  | { type: 'error'; id?: number; message: string };

export interface ModuleDecodeRequest {
  id: number;
  buffer: ArrayBuffer;
  mode: 'verify' | 'metadata' | 'patterns';
  subsong: number;
}

export type ModuleDecodeResponse =
  | { id: number; accepted: boolean; inspection?: OpenMptInspection }
  | { id: number; error: string };
