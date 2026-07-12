declare module 'chiptune3' {
  export interface Chiptune3Config {
    repeatCount?: number;
    stereoSeparation?: number;
    interpolationFilter?: number;
    context?: AudioContext | false;
  }

  export interface Chiptune3Progress {
    pos: number;
    order: number;
    pattern: number;
    row: number;
  }

  export interface Chiptune3Song {
    channels: string[];
    instruments: string[];
    samples: string[];
    orders: Array<{ name: string; pat: number }>;
    patterns: Array<{ name: string; rows: number[][][] }>;
    numSubsongs: number;
  }

  export interface Chiptune3Metadata extends Record<string, unknown> {
    title?: string;
    songtitle?: string;
    artist?: string;
    tracker?: string;
    type?: string;
    originaltype?: string;
    originaltype_long?: string;
    message?: string;
    message_raw?: string;
    channels?: number | string;
    dur?: number;
    totalOrders?: number;
    totalPatterns?: number;
    song?: Chiptune3Song;
    songs?: string[];
    libopenmptVersion?: string;
    libopenmptBuild?: string;
  }

  export class ChiptuneJsPlayer {
    context: AudioContext;
    gain: GainNode;
    processNode?: AudioWorkletNode;
    duration?: number;
    currentTime?: number;
    order?: number;
    pattern?: number;
    row?: number;

    constructor(config?: Chiptune3Config);

    onInitialized(handler: () => void): void;
    onEnded(handler: () => void): void;
    onError(handler: (error: { type: string }) => void): void;
    onMetadata(handler: (metadata: Chiptune3Metadata) => void): void;
    onProgress(handler: (progress: Chiptune3Progress) => void): void;

    play(buffer: ArrayBuffer): void;
    stop(): void;
    pause(): void;
    unpause(): void;
    togglePause(): void;
    setRepeatCount(value: number): void;
    setPitch(value: number): void;
    setTempo(value: number): void;
    setPos(value: number): void;
    setOrderRow(order: number, row: number): void;
    seek(value: number): void;
    setVol(value: number): void;
    selectSubsong(value: number): void;
    decodeAll(buffer: ArrayBuffer): void;
  }
}
