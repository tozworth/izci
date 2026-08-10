import type { ChiptuneJsPlayer } from 'chiptune3';
import { audioBusService } from '$lib/services/audio-bus';
import { createChiptunePlayer } from '$lib/services/chiptune-loader';
import { logWarning } from '$lib/services/logging';
import { modulePlaybackSettings } from '$lib/stores/module-playback-settings';
import { createPlaylistNavigation } from '$lib/stores/playlist-navigation';
import type { PlaybackSnapshot, PlaylistItem, PlaylistRepeatMode } from '$lib/types';
import type {
  MultiplayerDeliveryMode,
  MultiplayerPlayback
} from './multiplayer-protocol';

const FREEPLAY_PROGRESS_INTERVAL_MS = 500;

export interface MultiplayerFreeplayAudioSettings {
  enabled: boolean;
  /** Pre-resolved delivery for the track: 'render' (buffered Opus) or 'stream' (video). */
  delivery: MultiplayerDeliveryMode;
}

export interface MultiplayerFreeplayPlayerUpdate {
  playback: MultiplayerPlayback;
  delivery: MultiplayerDeliveryMode;
}

interface CreateMultiplayerFreeplayPlayerOptions {
  getAudioSettings: (track: PlaylistItem) => MultiplayerFreeplayAudioSettings;
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
 * A host-side player whose output exists only on a single peer's WebRTC sender.
 * It deliberately never enters the shared player controller or speaker graph.
 */
export class MultiplayerFreeplayPlayer {
  #track: PlaylistItem | null = null;
  #snapshot: PlaybackSnapshot = { ...EMPTY_SNAPSHOT };
  #delivery: MultiplayerDeliveryMode = 'none';
  #element: HTMLMediaElement | null = null;
  #elementSource: MediaElementAudioSourceNode | null = null;
  #modulePlayer: ChiptuneJsPlayer | null = null;
  #wireDestination: MediaStreamAudioDestinationNode | null = null;
  #silenceSource: ConstantSourceNode | null = null;
  #silenceGain: GainNode | null = null;
  #wirePromise: Promise<MediaStreamTrack | null> | null = null;
  #objectUrl: string | null = null;
  #progressTimer: ReturnType<typeof globalThis.setInterval> | null = null;
  #loadToken = 0;
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

  get track(): PlaylistItem | null {
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

  get streamTrack(): MediaStreamTrack | null {
    return this.#wireDestination?.stream.getAudioTracks()[0] ?? null;
  }

  /** Create the peer's sender track once and keep it alive with silent RTP. */
  async ensureWire(): Promise<MediaStreamTrack | null> {
    if (this.streamTrack?.readyState === 'live') return this.streamTrack;
    if (this.#wirePromise) return this.#wirePromise;
    const token = this.#loadToken;
    const creating = this.#createWire(token);
    this.#wirePromise = creating;
    try {
      return await creating;
    } finally {
      if (this.#wirePromise === creating) this.#wirePromise = null;
    }
  }

  async #createWire(token: number): Promise<MediaStreamTrack | null> {
    let context: AudioContext;
    try {
      context = audioBusService.context;
    } catch {
      return null;
    }
    await audioBusService.resume();
    if (token !== this.#loadToken) return null;
    const destination = context.createMediaStreamDestination();
    destination.channelCount = 2;
    const silenceSource = context.createConstantSource();
    const silenceGain = context.createGain();
    silenceGain.gain.value = 0;
    silenceSource.connect(silenceGain);
    silenceGain.connect(destination);
    silenceSource.start();
    this.#wireDestination = destination;
    this.#silenceSource = silenceSource;
    this.#silenceGain = silenceGain;
    const track = this.streamTrack;
    if (track && 'contentHint' in track) track.contentHint = 'music';
    return track;
  }

  async load(track: PlaylistItem, autoPlay = false, initialPosition = 0): Promise<boolean> {
    if (!track.file) return false;
    const token = ++this.#loadToken;
    this.#playIntent = autoPlay;
    this.#disposeRenderer();
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
      : settings.delivery === 'render' || settings.delivery === 'stream'
      ? settings.delivery
      : 'none';
    this.#publish();

    try {
      if (this.#delivery === 'stream') {
        if (!await this.ensureWire()) throw new Error('Freeplay wire is unavailable.');
        if (track.kind === 'module') await this.#loadModuleRenderer(track, token);
        else await this.#loadMediaRenderer(track, token);
      }
    } catch {
      if (token !== this.#loadToken) return false;
      this.#snapshot = { ...this.#snapshot, state: 'error', error: 'Freeplay could not render this track.' };
      this.#publish();
      return false;
    }

    if (token !== this.#loadToken) return false;
    const passive = this.#delivery !== 'stream';
    this.#snapshot = {
      ...this.#snapshot,
      state: passive ? 'idle' : 'paused',
      currentTime: passive ? 0 : Math.min(this.#snapshot.currentTime, finiteDuration(this.#snapshot.duration)),
      error: undefined
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
    if (this.#delivery !== 'stream') return true;
    if (this.#snapshot.state === 'error') {
      this.#snapshot = { ...this.#snapshot, state: 'paused', error: undefined };
    }
    const audioReady = await audioBusService.resume();
    if (!audioReady) {
      this.#snapshot = { ...this.#snapshot, state: 'error', error: 'Freeplay audio could not start.' };
      logWarning('freeplay', 'Freeplay audio context is blocked', { trackId: this.#track.id });
      this.#publish();
      return false;
    }
    try {
      if (this.#element) await this.#element.play();
      else if (this.#modulePlayer) {
        if (this.#snapshot.currentTime > 0) this.#modulePlayer.seek(this.#snapshot.currentTime);
        this.#modulePlayer.unpause();
      }
    } catch (error) {
      this.#snapshot = { ...this.#snapshot, state: 'error', error: 'Freeplay audio could not start.' };
      logWarning('freeplay', 'Freeplay renderer could not start', { trackId: this.#track.id, error });
      this.#publish();
      return false;
    }
    this.#snapshot = { ...this.#snapshot, state: 'playing', error: undefined };
    this.#startProgress();
    this.#publish();
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
    if (this.#delivery !== 'stream') return true;
    const current = this.#currentSnapshot().currentTime;
    this.#element?.pause();
    this.#modulePlayer?.pause();
    this.#snapshot = { ...this.#snapshot, state: 'paused', currentTime: current };
    this.#stopProgress();
    this.#publish();
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
    if (this.#delivery !== 'stream') return true;
    const duration = finiteDuration(this.#snapshot.duration);
    const target = Math.min(Math.max(seconds, 0), duration);
    if (this.#element) this.#element.currentTime = target;
    if (this.#modulePlayer) this.#modulePlayer.seek(target);
    this.#snapshot = { ...this.#snapshot, currentTime: target };
    this.#publish();
    return true;
  }

  destroy(): void {
    this.#loadToken += 1;
    this.#stopProgress();
    this.#disposeRenderer();
    this.#disposeWire();
    this.#track = null;
    this.#delivery = 'none';
    this.#playIntent = false;
    this.#snapshot = { ...EMPTY_SNAPSHOT };
  }

  async #loadMediaRenderer(track: PlaylistItem, token: number): Promise<void> {
    const context = audioBusService.context;
    await audioBusService.resume();
    const element = document.createElement(track.kind === 'video' ? 'video' : 'audio');
    element.preload = 'auto';
    element.setAttribute('playsinline', '');
    element.volume = 1;
    const objectUrl = URL.createObjectURL(track.file!);
    const source = context.createMediaElementSource(element);
    this.#connectRenderer(source);

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        element.removeEventListener('loadedmetadata', loaded);
        element.removeEventListener('error', failed);
      };
      const loaded = () => {
        cleanup();
        if (token !== this.#loadToken) return resolve();
        this.#snapshot = {
          ...this.#snapshot,
          duration: positiveNumber(element.duration) || this.#snapshot.duration
        };
        resolve();
      };
      const failed = () => {
        cleanup();
        disposeMediaRenderer(element, source, objectUrl);
        reject(new Error('Media element rejected the Freeplay source.'));
      };
      element.addEventListener('loadedmetadata', loaded);
      element.addEventListener('error', failed);
      element.src = objectUrl;
      element.load();
    });
    if (token !== this.#loadToken) {
      disposeMediaRenderer(element, source, objectUrl);
      return;
    }
    this.#element = element;
    this.#elementSource = source;
    this.#objectUrl = objectUrl;
    element.addEventListener('ended', this.#handleEnded);
  }

  async #loadModuleRenderer(track: PlaylistItem, token: number): Promise<void> {
    const context = audioBusService.context;
    await audioBusService.resume();
    const settings = modulePlaybackSettings.getSnapshot();
    const player = await createChiptunePlayer({
      context,
      repeatCount: 0,
      stereoSeparation: settings.stereoSeparation,
      interpolationFilter: settings.interpolationFilter
    });
    if (token !== this.#loadToken) {
      disposeModulePlayer(player);
      return;
    }
    const buffer = await track.file!.arrayBuffer();
    if (token !== this.#loadToken) {
      disposeModulePlayer(player);
      return;
    }
    this.#connectRenderer(player.gain);
    this.#modulePlayer = player;
    player.setVol(1);
    player.setRepeatCount(0);
    player.onMetadata((metadata) => {
      if (player !== this.#modulePlayer) return;
      this.#snapshot = {
        ...this.#snapshot,
        duration: positiveNumber(metadata.dur) || this.#snapshot.duration
      };
      this.#publish();
    });
    player.onProgress((progress) => {
      if (player !== this.#modulePlayer) return;
      this.#snapshot = { ...this.#snapshot, currentTime: Math.max(progress.pos, 0) };
    });
    player.onEnded(() => this.#handleEnded());
    player.onError(() => {
      if (player !== this.#modulePlayer) return;
      this.#snapshot = { ...this.#snapshot, state: 'error', error: 'Freeplay module rendering failed.' };
      this.#stopProgress();
      this.#publish();
    });
    player.play(buffer);
    player.pause();
  }

  #connectRenderer(source: AudioNode): void {
    const destination = this.#wireDestination;
    if (!destination) throw new Error('Freeplay wire is unavailable.');
    source.connect(destination);
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
    if (this.#element) currentTime = positiveNumber(this.#element.currentTime);
    else if (this.#modulePlayer) currentTime = positiveNumber(this.#modulePlayer.currentTime);
    else if (this.#delivery === 'render' && this.#snapshot.state === 'playing') {
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

  #disposeRenderer(): void {
    this.#stopProgress();
    if (this.#element) {
      this.#element.removeEventListener('ended', this.#handleEnded);
      this.#element.pause();
      this.#element.removeAttribute('src');
      this.#element.load();
    }
    try {
      this.#elementSource?.disconnect();
      this.#modulePlayer?.gain.disconnect();
    } catch {
      // A renderer may already have disconnected during a failed load.
    }
    if (this.#modulePlayer) disposeModulePlayer(this.#modulePlayer);
    if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
    this.#element = null;
    this.#elementSource = null;
    this.#modulePlayer = null;
    this.#objectUrl = null;
  }

  #disposeWire(): void {
    try {
      this.#silenceSource?.stop();
      this.#silenceSource?.disconnect();
      this.#silenceGain?.disconnect();
      this.#wireDestination?.disconnect();
    } catch {
      // A closed audio context has already made the wire inert.
    }
    for (const track of this.#wireDestination?.stream.getTracks() ?? []) track.stop();
    this.#silenceSource = null;
    this.#silenceGain = null;
    this.#wireDestination = null;
  }
}

export interface FreeplayStepResolver {
  reset(): void;
  resolveStep(options: {
    currentId?: string | null;
    direction: -1 | 1;
    shuffle: boolean;
    wrap: boolean;
  }): PlaylistItem | null;
  resolveEnd(options: {
    currentId?: string | null;
    shuffle: boolean;
    repeatMode: PlaylistRepeatMode;
  }): PlaylistItem | null;
}
export function createFreeplayStepResolver(getItems: () => PlaylistItem[]): FreeplayStepResolver {
  const navigation = createPlaylistNavigation(getItems);
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

function disposeModulePlayer(player: ChiptuneJsPlayer): void {
  try {
    player.stop();
    player.gain.disconnect();
    player.processNode?.disconnect();
    player.processNode?.port.close();
  } catch {
    // Detached worklets are already inaudible; teardown is best-effort.
  }
}

function disposeMediaRenderer(
  element: HTMLMediaElement,
  source: MediaElementAudioSourceNode,
  objectUrl: string
): void {
  element.pause();
  element.removeAttribute('src');
  element.load();
  try {
    source.disconnect();
  } catch {
    // A failed media load may already have detached the source.
  }
  URL.revokeObjectURL(objectUrl);
}
