import { audioBusService } from '$lib/services/audio-bus';
import { logDebug, logError, logInfo } from '$lib/services/logging';
import {
  createHivelyPatternSong,
  type HivelyPatternData
} from '$lib/services/hively-patterns';
import { mediaSessionService } from '$lib/services/media-session';
import { modulePlaybackSettings } from '$lib/stores/module-playback-settings';
import type {
  ModulePatternSnapshot,
  ModulePatternSong,
  ModulePlaybackSettings,
  PlaybackSnapshot,
  TrackItem,
  TrackMetadata
} from '$lib/types';

type SnapshotHandler = (snapshot: Partial<PlaybackSnapshot>) => void;
type MetadataHandler = (metadata: TrackMetadata) => void;
type PatternHandler = (snapshot: Partial<ModulePatternSnapshot> | null) => void;
type EndHandler = () => void;
interface StopOptions {
  silent?: boolean;
}

interface AhxWorkletMessage {
  type: 'loaded' | 'metadata' | 'pattern-data' | 'pattern-progress' | 'progress' | 'ended' | 'error';
  data?: HivelyPatternData;
  message?: string;
  metadata?: TrackMetadata;
  currentTime?: number;
  duration?: number;
  subsong?: number;
  subsongCount?: number;
  order?: number;
  row?: number;
}

const LOAD_TIMEOUT_MS = 10_000;
const workletLoads = new WeakMap<AudioContext, Promise<void>>();
let wasmBytesPromise: Promise<ArrayBuffer> | null = null;

function runtimeUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

function ensureWorklet(context: AudioContext): Promise<void> {
  const existing = workletLoads.get(context);
  if (existing) return existing;
  const pending = context.audioWorklet.addModule(runtimeUrl('vendor/ahx-worklet.js')).catch((error) => {
    workletLoads.delete(context);
    throw error;
  });
  workletLoads.set(context, pending);
  return pending;
}

function loadWasmBytes(): Promise<ArrayBuffer> {
  wasmBytesPromise ??= fetch(runtimeUrl('vendor/hively-replay.wasm')).then((response) => {
    if (!response.ok) throw new Error(`Unable to load the Hively replay core (${response.status}).`);
    return response.arrayBuffer();
  }).catch((error) => {
    wasmBytesPromise = null;
    throw error;
  });
  return wasmBytesPromise;
}

export class HivelyPlayerService {
  #node: AudioWorkletNode | null = null;
  #gain: GainNode | null = null;
  #loadToken = 0;
  #playing = false;
  #started = false;
  #subsong = 0;
  #subsongCount = 1;
  #patternSong: ModulePatternSong | null = null;
  #patternOrder = 0;
  #patternRow = 0;
  #settings = modulePlaybackSettings.getSnapshot();
  #transitionGain = 1;
  #onSnapshot: SnapshotHandler;
  #onMetadata: MetadataHandler;
  #onPattern: PatternHandler;
  #onEnded: EndHandler;

  constructor(
    onSnapshot: SnapshotHandler,
    onMetadata: MetadataHandler,
    onPattern: PatternHandler,
    onEnded: EndHandler
  ) {
    this.#onSnapshot = onSnapshot;
    this.#onMetadata = onMetadata;
    this.#onPattern = onPattern;
    this.#onEnded = onEnded;
  }

  async load(track: TrackItem): Promise<void> {
    if (!track.file) throw new Error('Expected a file for Hively playback.');

    this.#disposeNode();
    logInfo('playback', 'Hively load started', { id: track.id, name: track.name, extension: track.extension, subsong: track.subsong });
    const loadToken = ++this.#loadToken;
    this.#playing = false;
    this.#started = false;
    this.#subsong = this.#normalizeSubsong(track.subsong, track.metadata?.subsongs);
    this.#subsongCount = this.#normalizeSubsongCount(track.metadata?.subsongs);
    this.#patternSong = null;
    this.#patternOrder = 0;
    this.#patternRow = 0;
    this.#onPattern(null);
    this.#onSnapshot({
      backend: 'module',
      state: 'loading',
      currentTime: 0,
      duration: track.metadata?.duration ?? 0,
      subsong: this.#subsong,
      subsongCount: this.#subsongCount,
      error: undefined
    });

    const context = audioBusService.context;
    const [wasm, moduleBuffer] = await Promise.all([
      loadWasmBytes(),
      track.file.arrayBuffer(),
      ensureWorklet(context)
    ]).then(([core, module]) => [core, module] as const);
    if (loadToken !== this.#loadToken) return;

    const node = new AudioWorkletNode(context, 'izci-ahx-replay', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });
    const gain = context.createGain();
    node.connect(gain);
    audioBusService.connectAudioNode(gain);
    audioBusService.setSourceGain(gain, this.#transitionGain);
    this.#node = node;
    this.#gain = gain;

    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          if (error) reject(error);
          else resolve();
        };
        const timeoutId = window.setTimeout(
          () => finish(new Error('Hively AudioWorklet did not initialize.')),
          LOAD_TIMEOUT_MS
        );

        node.port.onmessage = (event: MessageEvent<AhxWorkletMessage>) => {
          if (loadToken !== this.#loadToken || node !== this.#node) return;
          const message = event.data;
          if (message.type === 'loaded') {
            finish();
          } else if (message.type === 'error') {
            finish(new Error(message.message ?? 'Hively playback failed.'));
            this.#onSnapshot({ state: 'error', error: message.message ?? 'Hively playback failed.' });
          } else {
            this.#handleWorkletMessage(message);
          }
        };

        node.port.postMessage(
          {
            type: 'load',
            wasm: wasm.slice(0),
            module: moduleBuffer,
            format: track.extension.toLowerCase(),
            // Hively's scale is 0 (mono) to 4 (Paula-style hard stereo).
            // The existing stereo-separation setting is intentionally MOD-only.
            stereo: 2,
            interpolationFilter: this.#settings.interpolationFilter,
            repeat: this.#settings.repeatCount === -1,
            subsong: this.#subsong
          },
          [moduleBuffer]
        );
      });
    } catch (error) {
      logError('decode', 'Hively load failed', { extension: track.extension, error });
      if (loadToken === this.#loadToken) this.#disposeNode();
      throw error;
    }

    if (loadToken !== this.#loadToken) return;
    logInfo('decode', 'Hively worklet initialized', { extension: track.extension });
    mediaSessionService.activateTransportAnchor();
    mediaSessionService.pauseTransportAnchor();
  }

  play(): void {
    if (!this.#node || this.#playing) return;
    audioBusService.resume();
    this.#node.port.postMessage({ type: 'play' });
    this.#playing = true;
    this.#started = true;
    this.#onSnapshot({ state: 'playing', error: undefined });
    mediaSessionService.playTransportAnchor();
  }

  pause(): void {
    if (!this.#node || !this.#playing) return;
    this.#node.port.postMessage({ type: 'pause' });
    this.#playing = false;
    this.#onSnapshot({ state: 'paused' });
    mediaSessionService.pauseTransportAnchor();
  }

  stop(options: StopOptions = {}): void {
    this.#loadToken += 1;
    this.#playing = false;
    this.#started = false;
    this.#subsong = 0;
    this.#subsongCount = 1;
    this.#patternSong = null;
    this.#patternOrder = 0;
    this.#patternRow = 0;
    this.#onPattern(null);
    this.#disposeNode();
    mediaSessionService.deactivateTransportAnchor();
    if (!options.silent) this.#onSnapshot({ state: 'paused', currentTime: 0, error: undefined });
  }

  seek(seconds: number): void {
    if (!this.#node || !this.#started) return;
    logDebug('playback', 'Hively seek', { seconds });
    this.#node.port.postMessage({ type: 'seek', seconds });
  }

  stepSubsong(direction: -1 | 1): number | null {
    if (!this.#node || this.#subsongCount <= 1) return null;
    this.#subsong = (this.#subsong + direction + this.#subsongCount) % this.#subsongCount;
    this.#node.port.postMessage({ type: 'subsong', subsong: this.#subsong });
    this.#onSnapshot({
      currentTime: 0,
      duration: 0,
      subsong: this.#subsong,
      subsongCount: this.#subsongCount,
      error: undefined
    });
    return this.#subsong;
  }

  async applySettings(settings: ModulePlaybackSettings): Promise<void> {
    const previous = this.#settings;
    this.#settings = settings;
    if (!this.#node) return;
    if (previous.repeatCount !== settings.repeatCount) {
      this.#node.port.postMessage({ type: 'repeat', enabled: settings.repeatCount === -1 });
    }
    if (previous.interpolationFilter !== settings.interpolationFilter) {
      this.#node.port.postMessage({ type: 'interpolation', filter: settings.interpolationFilter });
    }
  }

  setTransitionGain(gain: number, durationSeconds = 0): void {
    this.#transitionGain = Math.max(gain, 0);
    audioBusService.setSourceGain(this.#gain, this.#transitionGain, durationSeconds);
  }

  setChannelMutes(muted: boolean[]): void {
    this.#node?.port.postMessage({ type: 'channel-mutes', muted });
  }

  #handleWorkletMessage(message: AhxWorkletMessage): void {
    if (message.type === 'metadata' && message.metadata) {
      this.#subsongCount = this.#normalizeSubsongCount(message.metadata.subsongs);
      this.#onMetadata(message.metadata);
      return;
    }
    if (message.type === 'pattern-data' && message.data) {
      const song = createHivelyPatternSong(message.data);
      this.#patternSong = song;
      this.#publishPattern(song);
      return;
    }
    if (message.type === 'pattern-progress') {
      this.#patternOrder = this.#normalizePatternPosition(message.order);
      this.#patternRow = this.#normalizePatternPosition(message.row);
      if (this.#patternSong) this.#publishPattern(this.#patternSong);
      return;
    }
    if (message.type === 'progress') {
      this.#subsong = this.#normalizeSubsong(message.subsong, message.subsongCount);
      this.#subsongCount = this.#normalizeSubsongCount(message.subsongCount);
      this.#onSnapshot({
        currentTime: message.currentTime ?? 0,
        duration: message.duration ?? 0,
        subsong: this.#subsong,
        subsongCount: this.#subsongCount
      });
      return;
    }
    if (message.type === 'ended') {
      this.#playing = false;
      this.#onEnded();
      mediaSessionService.pauseTransportAnchor();
    }
  }

  #publishPattern(song: ModulePatternSong): void {
    const order = Math.min(this.#patternOrder, Math.max(song.orders.length - 1, 0));
    const pattern = song.orders[order]?.pat ?? 0;
    const rowCount = song.patterns[pattern]?.rows.length ?? 0;
    const row = Math.min(this.#patternRow, Math.max(rowCount - 1, 0));
    this.#onPattern({ song, order, pattern, row });
  }

  #disposeNode(): void {
    const node = this.#node;
    const gain = this.#gain;
    this.#node = null;
    this.#gain = null;
    if (node) {
      try {
        node.port.postMessage({ type: 'dispose' });
        node.disconnect();
        node.port.close();
      } catch {
        // Ignore teardown races for worklets that never finished initialization.
      }
    }
    if (gain) {
      audioBusService.disconnect(gain);
      try {
        gain.disconnect();
      } catch {
        // Ignore graph teardown races.
      }
    }
  }

  #normalizeSubsongCount(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(1, Math.trunc(value))
      : 1;
  }

  #normalizeSubsong(value: unknown, count: unknown): number {
    const normalizedCount = this.#normalizeSubsongCount(count);
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.min(Math.max(Math.trunc(value), 0), normalizedCount - 1)
      : 0;
  }

  #normalizePatternPosition(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.trunc(value))
      : 0;
  }
}
