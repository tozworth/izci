import { createQueueNavigation } from '$lib/stores/queue-navigation';
import type { PlaybackSnapshot, TrackItem, RepeatMode } from '$lib/types';
import type {
  MultiplayerDeliveryMode,
  MultiplayerPlayback
} from './multiplayer-protocol';

const FREEPLAY_PROGRESS_INTERVAL_MS = 500;

interface MultiplayerFreeplayAudioSettings {
  enabled: boolean;
  /**
   * Pre-resolved delivery for the track: 'render' (buffered Opus), 'source-file'
   * (direct transfer, timeline-passive).
   */
  delivery: MultiplayerDeliveryMode;
}

export interface MultiplayerFreeplayPlayerUpdate {
  playback: MultiplayerPlayback;
  delivery: MultiplayerDeliveryMode;
}

interface CreateMultiplayerFreeplayPlayerOptions {
  getAudioSettings: (track: TrackItem) => MultiplayerFreeplayAudioSettings;
  onUpdate: (update: MultiplayerFreeplayPlayerUpdate) => void;
  onEnded: (trackId: string) => void;
}

const EMPTY_SNAPSHOT: PlaybackSnapshot = {
  state: 'idle',
  currentTime: 0,
  duration: 0,
  volume: 1,
  muted: false,
  backend: null
};

/**
 * An independent host-side timeline for a peer's buffered Opus delivery.
 * Source files play on the client; this never enters the shared player controller.
 */
export class MultiplayerFreeplayPlayer {
  #track: TrackItem | null = null;
  #snapshot: PlaybackSnapshot = { ...EMPTY_SNAPSHOT };
  #delivery: MultiplayerDeliveryMode = 'none';
  #progressTimer: ReturnType<typeof globalThis.setInterval> | null = null;
  #playIntent = false;
  #timelineTickAt = 0;
  readonly #getAudioSettings: CreateMultiplayerFreeplayPlayerOptions['getAudioSettings'];
  readonly #onUpdate: CreateMultiplayerFreeplayPlayerOptions['onUpdate'];
  readonly #onEnded: CreateMultiplayerFreeplayPlayerOptions['onEnded'];

  constructor({ getAudioSettings, onUpdate, onEnded }: CreateMultiplayerFreeplayPlayerOptions) {
    this.#getAudioSettings = getAudioSettings;
    this.#onUpdate = onUpdate;
    this.#onEnded = onEnded;
  }

  get track(): TrackItem | null {
    return this.#track;
  }

  get snapshot(): PlaybackSnapshot {
    return this.#currentSnapshot();
  }

  get playback(): MultiplayerPlayback {
    return {
      generationId: 'unassigned',
      snapshot: this.#currentSnapshot(),
      track: this.#track,
      sentAt: Date.now()
    };
  }

  get delivery(): MultiplayerDeliveryMode {
    return this.#delivery;
  }

  async load(track: TrackItem, autoPlay = false, initialPosition = 0): Promise<boolean> {
    if (!track.file) return false;
    this.#playIntent = autoPlay;
    this.#stopProgress();
    this.#track = track;
    this.#snapshot = {
      ...EMPTY_SNAPSHOT,
      state: 'loading',
      currentTime: Math.max(initialPosition, 0),
      duration: positiveNumber(track.metadata?.duration),
      backend: track.kind
    };

    const settings = this.#getAudioSettings(track);
    this.#delivery = !settings.enabled
      ? 'none'
      : settings.delivery === 'render'
        || settings.delivery === 'source-file'
      ? settings.delivery
      : 'none';
    this.#publish();

    this.#snapshot = {
      ...this.#snapshot,
      state: 'idle',
      currentTime: this.#delivery === 'render' ? Math.max(initialPosition, 0) : 0
    };
    this.#timelineTickAt = Date.now();
    this.seek(this.#snapshot.currentTime);
    this.#publish();
    if (autoPlay) await this.play();
    return true;
  }

  async reconfigure(): Promise<boolean> {
    const track = this.#track;
    if (!track) return false;
    const snapshot = this.#currentSnapshot();
    const shouldResume = this.#playIntent;
    const loaded = await this.load(track, false, snapshot.currentTime);
    this.#playIntent = shouldResume;
    return loaded && shouldResume;
  }

  async play(): Promise<boolean> {
    if (!this.#track || this.#snapshot.state === 'loading') return false;
    this.#playIntent = true;
    if (this.#delivery === 'render') {
      if (this.#snapshot.state === 'error') {
        this.#snapshot = { ...this.#snapshot, state: 'paused', error: undefined };
      }
      this.#timelineTickAt = Date.now();
      this.#snapshot = { ...this.#snapshot, state: 'playing', error: undefined };
      this.#startProgress();
      this.#publish();
      return true;
    }
    return true;
  }

  pause(): boolean {
    if (!this.#track) return false;
    this.#playIntent = false;
    if (this.#delivery === 'render') {
      this.#advanceTimeline();
      this.#snapshot = { ...this.#snapshot, state: 'paused' };
      this.#stopProgress();
      this.#publish();
      return true;
    }
    return true;
  }

  stop(): boolean {
    if (!this.#track) return false;
    this.pause();
    this.seek(0);
    return true;
  }

  seek(seconds: number): boolean {
    if (!this.#track || !Number.isFinite(seconds)) return false;
    if (this.#delivery === 'render') {
      const duration = finiteDuration(this.#snapshot.duration);
      this.#snapshot = {
        ...this.#snapshot,
        currentTime: Math.min(Math.max(seconds, 0), duration)
      };
      this.#timelineTickAt = Date.now();
      this.#publish();
      return true;
    }
    return true;
  }

  destroy(): void {
    this.#stopProgress();
    this.#track = null;
    this.#delivery = 'none';
    this.#playIntent = false;
    this.#snapshot = { ...EMPTY_SNAPSHOT };
  }

  #handleEnded = (): void => {
    const trackId = this.#track?.id;
    if (!trackId || this.#snapshot.state === 'ended') return;
    this.#snapshot = {
      ...this.#snapshot,
      state: 'ended',
      currentTime: this.#snapshot.duration > 0
        ? this.#snapshot.duration
        : this.#currentSnapshot().currentTime
    };
    this.#stopProgress();
    this.#publish();
    this.#onEnded(trackId);
  };

  #currentSnapshot(): PlaybackSnapshot {
    let currentTime = this.#snapshot.currentTime;
    if (this.#delivery === 'render' && this.#snapshot.state === 'playing') {
      const elapsed = this.#timelineTickAt > 0 ? (Date.now() - this.#timelineTickAt) / 1_000 : 0;
      currentTime = Math.min(
        currentTime + Math.max(0, elapsed),
        finiteDuration(this.#snapshot.duration)
      );
    }
    const duration = this.#snapshot.duration;
    if (duration > 0 && currentTime >= duration) {
      currentTime = duration;
      if (this.#snapshot.state === 'playing') queueMicrotask(this.#handleEnded);
    }
    return { ...this.#snapshot, currentTime };
  }

  #advanceTimeline(): void {
    if (this.#delivery !== 'render' || this.#snapshot.state !== 'playing') return;
    this.#snapshot = { ...this.#snapshot, currentTime: this.#currentSnapshot().currentTime };
    this.#timelineTickAt = Date.now();
  }

  #publish(): void {
    this.#advanceTimeline();
    const playback = this.playback;
    this.#snapshot = playback.snapshot;
    this.#timelineTickAt = Date.now();
    this.#onUpdate({
      playback,
      delivery: this.#delivery
    });
  }

  #startProgress(): void {
    if (this.#progressTimer !== null) return;
    this.#progressTimer = globalThis.setInterval(() => this.#publish(), FREEPLAY_PROGRESS_INTERVAL_MS);
  }

  #stopProgress(): void {
    if (this.#progressTimer !== null) globalThis.clearInterval(this.#progressTimer);
    this.#progressTimer = null;
  }

}

export interface FreeplayStepResolver {
  reset(): void;
  resolveStep(options: {
    currentId?: string | null;
    direction: -1 | 1;
    shuffle: boolean;
    wrap: boolean;
  }): TrackItem | null;
  resolveEnd(options: {
    currentId?: string | null;
    shuffle: boolean;
    repeatMode: RepeatMode;
  }): TrackItem | null;
}
export function createFreeplayStepResolver(getItems: () => TrackItem[]): FreeplayStepResolver {
  const navigation = createQueueNavigation(getItems);
  return {
    reset: navigation.reset,
    resolveStep: (options) => navigation.resolveStepTrack(options),
    resolveEnd: (options) => navigation.resolveTrackEnd(options)
  };
}

function positiveNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function finiteDuration(value: number): number {
  return value > 0 && Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}
