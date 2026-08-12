export type ModuleInterpolationFilter = 1 | 2 | 4 | 8;

export interface ModulePlaybackSettings {
  repeatCount: number;
  stereoSeparation: number;
  panStrength: number;
  interpolationFilter: ModuleInterpolationFilter;
  tempoFactor: number;
  pitchFactor: number;
}

export interface ModulePatternOrder {
  name: string;
  pat: number;
}

export interface ModulePattern {
  name: string;
  rows: string[][];
}

export interface ModulePatternSong {
  channels: string[];
  instruments: string[];
  samples: string[];
  orders: ModulePatternOrder[];
  patterns: ModulePattern[];
  numSubsongs: number;
}

export interface ModulePatternSnapshot {
  trackId: string | null;
  song: ModulePatternSong | null;
  order: number;
  pattern: number;
  row: number;
}
