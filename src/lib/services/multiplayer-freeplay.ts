import type { ChiptuneJsPlayer } from 'chiptune3';
import { audioBusService } from '$lib/services/audio-bus';
import { createChiptunePlayer } from '$lib/services/chiptune-loader';
import { RafEngine } from '$lib/services/raf-engine';
import { modulePlaybackSettings } from '$lib/stores/module-playback-settings';
import { createPlaylistNavigation } from '$lib/stores/playlist-navigation';
import type { PlaybackSnapshot, PlaylistItem, PlaylistRepeatMode } from '$lib/types';
import type {
  MultiplayerAudioAvailability,
  MultiplayerPlayback
} from './multiplayer-protocol';

const FREEPLAY_PROGRESS_INTERVAL_MS = 250;

export interface MultiplayerFreeplayAudioSettings {
  enabled: boolean;
  sourceFile: boolean;
  postRaf: boolean;
}

export interface MultiplayerFreeplayPlayerUpdate {
  playback: MultiplayerPlayback;
  audio: MultiplayerAudioAvailability;
  sourceFile: File | null;
  streamTrack: MediaStreamTrack | null;
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
 *
 * When the track is delivered as a source file (or audio is disabled), the host
 * is timeline-passive: it only holds the current selection so the client can
 * render it locally. No renderer, no clock, no auto-advance, no live progress.
 */
export class MultiplayerFreeplayPlayer {
  #track: PlaylistItem | null = null;
  #snapshot: PlaybackSnapshot = { ...EMPTY_SNAPSHOT };
  #audio: MultiplayerAudioAvailability = disabledAudioAvailability();
  #sourceFile: File | null = null;
  #element: HTMLMediaElement | null = null;
  #elementSource: MediaElementAudioSourceNode | null = null;
  #modulePlayer: ChiptuneJsPlayer | null = null;
  #destination: MediaStreamAudioDestinationNode | null = null;
  #raf: RafEngine | null = null;
  #objectUrl: string | null = null;
  #progressTimer: number | null = null;
  #loadToken = 0;
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
      snapshot: this.#currentSnapshot(),
      track: this.#track,
      sentAt: Date.now()
    };
  }

  get audio(): MultiplayerAudioAvailability {
    return this.#audio;
  }

  get sourceFile(): File | null {
    return this.#sourceFile;
  }

  get streamTrack(): MediaStreamTrack | null {
    return this.#destination?.stream.getAudioTracks()[0] ?? null;
  }

  async load(track: PlaylistItem, autoPlay = false, initialPosition = 0): Promise<boolean> {
    if (!track.file) return false;
    const token = ++this.#loadToken;
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
    this.#sourceFile = settings.enabled && settings.sourceFile ? track.file : null;
    this.#audio = {
      enabled: settings.enabled && !settings.sourceFile,
      sourceFile: settings.enabled && settings.sourceFile,
      postRaf: settings.enabled && !settings.sourceFile && settings.postRaf,
      reason: settings.enabled ? null : 'host-disabled'
    };
    this.#publish();

    try {
      if (this.#audio.enabled) {
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
    const passive = !this.#audio.enabled;
    this.#snapshot = {
      ...this.#snapshot,
      state: passive ? 'idle' : 'paused',
      currentTime: passive ? 0 : Math.min(this.#snapshot.currentTime, finiteDuration(this.#snapshot.duration)),
      error: undefined
    };
    this.seek(this.#snapshot.currentTime);
    this.#publish();
    if (autoPlay) await this.play();
    return true;
  }

  async reconfigure(): Promise<void> {
    const track = this.#track;
    if (!track) return;
    const snapshot = this.#currentSnapshot();
    await this.load(track, snapshot.state === 'playing', snapshot.currentTime);
  }

  async play(): Promise<boolean> {
    if (!this.#track || this.#snapshot.state === 'loading' || this.#snapshot.state === 'error') return false;
    // Timeline-passive selections (source-file delivery, host-disabled audio) have no
    // renderer or clock; the client owns playback and the host has nothing to start.
    if (!this.#element && !this.#modulePlayer) return true;
    try {
      if (this.#element) await this.#element.play();
      else if (this.#modulePlayer) {
        if (this.#snapshot.currentTime > 0) this.#modulePlayer.seek(this.#snapshot.currentTime);
        this.#modulePlayer.unpause();
      }
    } catch {
      this.#snapshot = { ...this.#snapshot, state: 'error', error: 'Freeplay audio could not start.' };
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
    if (!this.#element && !this.#modulePlayer) return true;
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
    if (!this.#element && !this.#modulePlayer) return true;
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
    this.#track = null;
    this.#sourceFile = null;
    this.#audio = disabledAudioAvailability();
    this.#snapshot = { ...EMPTY_SNAPSHOT };
  }

  async #loadMediaRenderer(track: PlaylistItem, token: number): Promise<void> {
    const context = audioBusService.context;
    await audioBusService.resume();
    if (token !== this.#loadToken) return;
    const element = document.createElement(track.kind === 'video' ? 'video' : 'audio');
    element.preload = 'auto';
    element.setAttribute('playsinline', '');
    element.volume = 1;
    const objectUrl = URL.createObjectURL(track.file!);
    const source = context.createMediaElementSource(element);
    const destination = context.createMediaStreamDestination();
    destination.channelCount = 2;

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        element.removeEventListener('loadedmetadata', loaded);
        element.removeEventListener('error', failed);
      };
      const loaded = () => {
        cleanup();
        if (token !== this.#loadToken) {
          disposeMediaRenderer(element, objectUrl, source, destination);
          return resolve();
        }
        // The token gate owns every instance-field assignment (mirroring the module
        // path): an older load's continuation must never republish a renderer that a
        // newer load already disposed, or the orphaned element keeps playing and its
        // object URL leaks.
        this.#connectRenderer(source, destination, this.#audio.postRaf, track.kind === 'video');
        this.#element = element;
        this.#elementSource = source;
        this.#destination = destination;
        this.#objectUrl = objectUrl;
        element.addEventListener('ended', this.#handleEnded);
        this.#snapshot = {
          ...this.#snapshot,
          duration: positiveNumber(element.duration) || this.#snapshot.duration
        };
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error('Media element rejected the Freeplay source.'));
      };
      element.addEventListener('loadedmetadata', loaded);
      element.addEventListener('error', failed);
      element.src = objectUrl;
      element.load();
    });
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
    const destination = context.createMediaStreamDestination();
    destination.channelCount = 2;
    this.#connectRenderer(player.gain, destination, this.#audio.postRaf, false);
    this.#modulePlayer = player;
    this.#destination = destination;
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
    player.play(await track.file!.arrayBuffer());
    player.pause();
  }

  #connectRenderer(
    source: AudioNode,
    destination: MediaStreamAudioDestinationNode,
    postRaf: boolean,
    bypassAutoAmp: boolean
  ): void {
    if (!postRaf) {
      source.connect(destination);
      return;
    }
    const raf = new RafEngine(source.context, { publishMeters: false });
    raf.setBypassedEffectTypes(bypassAutoAmp ? ['auto-amp'] : []);
    source.connect(raf.input);
    raf.output.connect(destination);
    this.#raf = raf;
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
    const duration = this.#snapshot.duration;
    if (duration > 0 && currentTime >= duration) {
      currentTime = duration;
      if (this.#snapshot.state === 'playing') queueMicrotask(this.#handleEnded);
    }
    return { ...this.#snapshot, currentTime };
  }

  #publish(): void {
    const playback = this.playback;
    this.#snapshot = playback.snapshot;
    this.#onUpdate({
      playback,
      audio: this.#audio,
      sourceFile: this.#sourceFile,
      streamTrack: this.streamTrack
    });
  }

  #startProgress(): void {
    if (this.#progressTimer !== null) return;
    this.#progressTimer = window.setInterval(() => this.#publish(), FREEPLAY_PROGRESS_INTERVAL_MS);
  }

  #stopProgress(): void {
    if (this.#progressTimer !== null) window.clearInterval(this.#progressTimer);
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
      this.#destination?.disconnect();
    } catch {
      // A renderer may already have disconnected during a failed load.
    }
    if (this.#modulePlayer) disposeModulePlayer(this.#modulePlayer);
    this.#raf?.destroy();
    for (const track of this.#destination?.stream.getTracks() ?? []) track.stop();
    if (this.#objectUrl) URL.revokeObjectURL(this.#objectUrl);
    this.#element = null;
    this.#elementSource = null;
    this.#modulePlayer = null;
    this.#destination = null;
    this.#raf = null;
    this.#objectUrl = null;
  }
}

export interface FreeplayStepResolver {
  /**
   * Drops the shuffle session (history + upcoming cycle). Mirrors the local
   * playlist store, which resets its navigation whenever shuffle toggles or the
   * collection/queue is replaced.
   */
  reset(): void;
  /**
   * Steps from an explicit user action (Next/Prev). Shuffle mode keeps a played
   * history so Prev walks back through what was actually played, and an upcoming
   * cycle so a track is never re-picked before the collection is exhausted
   * (wrapping to a fresh cycle only when `wrap` is set, i.e. repeat-all).
   */
  resolveStep(options: {
    currentId?: string | null;
    direction: -1 | 1;
    shuffle: boolean;
    wrap: boolean;
  }): PlaylistItem | null;
  /**
   * Steps after a track ended (auto-advance). Handles repeat-one (same track),
   * shuffle with repeat-all wrapping, and the repeat-off end-of-collection stop.
   */
  resolveEnd(options: {
    currentId?: string | null;
    shuffle: boolean;
    repeatMode: PlaylistRepeatMode;
  }): PlaylistItem | null;
}

/**
 * Per-peer Freeplay stepping context. The host owns one instance per Freeplay
 * peer, seeded with that peer's current collection (library/favorites/queue).
 * This reuses the local playlist-navigation semantics so Freeplay shuffle is
 * the same pseudorandom cycle the user gets locally: previous tracks are
 * remembered (Prev walks the history), and Next never re-picks a track until
 * the collection is exhausted.
 */
export function createFreeplayStepResolver(
  getItems: () => PlaylistItem[]
): FreeplayStepResolver {
  const navigation = createPlaylistNavigation(getItems);
  return {
    reset: () => navigation.reset(),
    resolveStep: (options) => navigation.resolveStepTrack(options),
    resolveEnd: (options) => navigation.resolveTrackEnd(options)
  };
}

function disabledAudioAvailability(): MultiplayerAudioAvailability {
  return { enabled: false, sourceFile: false, postRaf: false, reason: 'host-disabled' };
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
  objectUrl: string,
  source: MediaElementAudioSourceNode,
  destination: MediaStreamAudioDestinationNode
): void {
  element.pause();
  element.removeAttribute('src');
  element.load();
  try {
    source.disconnect();
    destination.disconnect();
  } catch {
    // A superseded renderer may already be partially detached.
  }
  for (const track of destination.stream.getTracks()) track.stop();
  URL.revokeObjectURL(objectUrl);
}
