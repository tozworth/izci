import { createChiptunePlayer } from '$lib/services/chiptune-loader';
import { audioBusService } from '$lib/services/audio-bus';
import { mediaSessionService } from '$lib/services/media-session';
import { modulePlaybackSettings } from '$lib/stores/module-playback-settings';
import type {
  ModulePatternSnapshot,
  ModulePlaybackSettings,
  PlaybackSnapshot,
  PlaylistItem,
  TrackMetadata
} from '$lib/types';
import type { Chiptune3Metadata, ChiptuneJsPlayer } from 'chiptune3';

type SnapshotHandler = (snapshot: Partial<PlaybackSnapshot>) => void;
type MetadataHandler = (metadata: TrackMetadata) => void;
type PatternHandler = (snapshot: Partial<ModulePatternSnapshot> | null) => void;
type EndHandler = () => void;
interface StopOptions {
  silent?: boolean;
}

const PROGRESS_PUBLISH_INTERVAL_SECONDS = 0.125;

export class ModulePlayerService {
  #player: ChiptuneJsPlayer | null = null;
  #buffer: ArrayBuffer | null = null;
  #trackExtension: PlaylistItem['extension'] | null = null;
  #loadToken = 0;
  #playing = false;
  #started = false;
  #currentTime = 0;
  #subsong = 0;
  #subsongCount = 1;
  #lastPublishedCurrentTime = -1;
  #lastPublishedDuration = -1;
  #lastPublishedOrder = -1;
  #lastPublishedPattern = -1;
  #lastPublishedRow = -1;
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

  async load(track: PlaylistItem): Promise<void> {
    if (!track.file) {
      throw new Error('Expected a file for tracker module playback.');
    }

    this.#disposePlayer();
    const loadToken = ++this.#loadToken;
    this.#buffer = null;
    this.#trackExtension = track.extension.toLowerCase();
    this.#playing = false;
    this.#started = false;
    this.#currentTime = 0;
    this.#subsong = this.#normalizeSubsong(track.subsong, track.metadata?.subsongs);
    this.#subsongCount = this.#normalizeSubsongCount(track.metadata?.subsongs);
    this.#resetPublishedProgress();
    this.#onPattern(null);

    this.#onSnapshot({
      backend: 'module',
      state: 'loading',
      currentTime: 0,
      duration: 0,
      subsong: this.#subsong,
      subsongCount: this.#subsongCount,
      error: undefined
    });

    const player = await this.#createPlayer(loadToken);

    if (!this.#isActiveLoad(loadToken)) {
      this.#disposeDetachedPlayer(player);
      return;
    }

    this.#player = player;
    audioBusService.connectAudioNode(player.gain);
    audioBusService.setSourceGain(player.gain, this.#transitionGain);
    mediaSessionService.activateTransportAnchor();
    mediaSessionService.pauseTransportAnchor();
    const buffer = await track.file.arrayBuffer();

    if (!this.#isActiveLoad(loadToken)) {
      return;
    }

    this.#buffer = buffer;

    this.#onMetadata({
      trackerType: track.extension.toUpperCase()
    });
  }

  play(): void {
    if (!this.#player || !this.#buffer) {
      return;
    }

    audioBusService.resume();

    if (!this.#started) {
      this.#player.play(this.#buffer);
      if (this.#subsong > 0) {
        this.#player.selectSubsong(this.#subsong);
      }
      this.#started = true;
      this.#playing = true;
      this.#applyRuntimeSettings();
    } else if (!this.#playing) {
      this.#player.unpause();
      this.#playing = true;
    } else {
      return;
    }

    this.#onSnapshot({ state: 'playing', error: undefined });
    this.#publishProgress(true);
    mediaSessionService.playTransportAnchor();
  }

  pause(): void {
    if (!this.#player || !this.#playing) {
      return;
    }

    this.#player.pause();
    this.#playing = false;
    this.#publishProgress(true);
    this.#onSnapshot({ state: 'paused' });
    mediaSessionService.pauseTransportAnchor();
  }

  stop(options: StopOptions = {}): void {
    this.#loadToken += 1;
    this.#playing = false;
    this.#started = false;
    this.#currentTime = 0;
    this.#subsong = 0;
    this.#subsongCount = 1;
    this.#buffer = null;
    this.#trackExtension = null;
    this.#resetPublishedProgress();
    this.#onPattern(null);
    this.#disposePlayer();
    mediaSessionService.deactivateTransportAnchor();
    if (!options.silent) {
      this.#onSnapshot({ state: 'paused', currentTime: 0, error: undefined });
    }
  }

  destroy(): void {
    this.stop();
  }

  seek(seconds: number): void {
    if (!this.#player || !this.#started) {
      return;
    }

    this.#player.seek(seconds);
    this.#currentTime = seconds;
    this.#publishProgress(true, seconds);
  }

  stepSubsong(direction: -1 | 1): number | null {
    if (!this.#player || !this.#buffer || this.#subsongCount <= 1) {
      return null;
    }

    const nextSubsong = (this.#subsong + direction + this.#subsongCount) % this.#subsongCount;
    this.#subsong = nextSubsong;
    this.#currentTime = 0;
    this.#resetPublishedProgress();

    if (this.#started) {
      this.#player.selectSubsong(nextSubsong);
    }

    this.#onSnapshot({
      currentTime: 0,
      ...(this.#started ? { duration: 0 } : {}),
      subsong: nextSubsong,
      subsongCount: this.#subsongCount,
      error: undefined
    });

    return nextSubsong;
  }

  async applySettings(settings: ModulePlaybackSettings): Promise<void> {
    const previousSettings = this.#settings;
    const previousStereoWidth = this.#getStereoWidth(previousSettings);
    const nextStereoWidth = this.#getStereoWidth(settings);
    const recreatePlayer =
      previousStereoWidth !== nextStereoWidth ||
      previousSettings.interpolationFilter !== settings.interpolationFilter;

    this.#settings = settings;

    if (!this.#player) {
      return;
    }

    if (recreatePlayer) {
      await this.#recreatePlayer();
      return;
    }

    this.#applyRuntimeSettings();
  }

  setTransitionGain(gain: number, durationSeconds = 0): void {
    this.#transitionGain = Math.max(gain, 0);
    audioBusService.setSourceGain(this.#player?.gain ?? null, this.#transitionGain, durationSeconds);
  }

  async #createPlayer(loadToken: number = this.#loadToken): Promise<ChiptuneJsPlayer> {
    const player = await createChiptunePlayer(this.#toPlayerConfig(this.#settings));

    player.setVol(1);
    player.setRepeatCount(this.#settings.repeatCount);
    this.#attachHandlers(player, loadToken);

    return player;
  }

  #disposePlayer(): void {
    const player = this.#player;

    this.#player = null;
    audioBusService.disconnect(player?.gain ?? null);

    if (!player) {
      return;
    }

    try {
      player.stop();
    } catch {
      return;
    } finally {
      try {
        player.gain.disconnect();
      } catch {
        // Ignore disconnect failures during teardown.
      }

      this.#disposeProcessNode(player);
    }
  }

  async #recreatePlayer(): Promise<void> {
    const loadToken = this.#loadToken;
    const wasStarted = this.#started;
    const wasPlaying = this.#playing;
    const restorePosition = this.#currentTime;
    const buffer = this.#buffer;

    this.#disposePlayer();
    const player = await this.#createPlayer(loadToken);

    if (!this.#isActiveLoad(loadToken)) {
      this.#disposeDetachedPlayer(player);
      return;
    }

    this.#player = player;
    audioBusService.connectAudioNode(player.gain);
    audioBusService.setSourceGain(player.gain, this.#transitionGain);
    mediaSessionService.activateTransportAnchor();

    if (!wasStarted || !buffer || !this.#player) {
      this.#started = false;
      this.#playing = false;
      this.#currentTime = restorePosition;
      this.#resetPublishedProgress();
      this.#onSnapshot({ state: 'paused', currentTime: restorePosition, error: undefined });
      mediaSessionService.pauseTransportAnchor();
      return;
    }

    void this.#player.context.resume();
    this.#player.play(buffer);
    if (this.#subsong > 0) {
      this.#player.selectSubsong(this.#subsong);
    }
    this.#started = true;
    this.#playing = true;
    this.#applyRuntimeSettings();

    if (restorePosition > 0) {
      this.#player.seek(restorePosition);
      this.#currentTime = restorePosition;
    }

    if (!wasPlaying) {
      this.#player.pause();
      this.#playing = false;
      this.#onSnapshot({ state: 'paused', currentTime: restorePosition, error: undefined });
      mediaSessionService.pauseTransportAnchor();
      return;
    }

    this.#onSnapshot({ state: 'playing', currentTime: restorePosition, error: undefined });
    mediaSessionService.playTransportAnchor();
  }

  #applyRuntimeSettings(): void {
    if (!this.#player) {
      return;
    }

    this.#player.setRepeatCount(this.#settings.repeatCount);

    if (!this.#started) {
      return;
    }

    this.#player.setTempo(this.#settings.tempoFactor);
    this.#player.setPitch(this.#settings.pitchFactor);
  }

  #attachHandlers(player: ChiptuneJsPlayer, loadToken: number): void {
    player.onEnded(() => {
      if (!this.#isPlayerLoadCurrent(player, loadToken)) {
        return;
      }

      this.#playing = false;
      this.#started = false;
      const duration = this.#safeSeconds(player.duration);
      this.#currentTime = duration;
      this.#publishProgress(true, duration, duration);
      this.#onSnapshot({ state: 'ended' });
      this.#onEnded();
    });

    player.onError((error) => {
      if (!this.#isPlayerLoadCurrent(player, loadToken)) {
        return;
      }

      this.#playing = false;
      this.#started = false;
      this.#onSnapshot({
        state: 'error',
        error:
          error.type === 'ptr' || error.type === 'dur' || error.type === 'Process'
            ? 'libopenmpt failed to decode this module.'
            : 'Module playback failed.'
      });
    });

    player.onMetadata((metadata) => {
      if (!this.#isPlayerLoadCurrent(player, loadToken)) {
        return;
      }

      const subsongCount = this.#normalizeSubsongCount(metadata.song?.numSubsongs);
      const selectedSubsong = this.#normalizeSubsong(metadata.selectedSubsong, subsongCount);

      // play() publishes the default subsong before a queued initial selection.
      // Suppress that transient metadata so separated entries never flash subsong 1.
      if (selectedSubsong !== this.#subsong) {
        return;
      }

      this.#subsongCount = subsongCount;
      this.#onMetadata(this.#toTrackMetadata(metadata));
      if (metadata.song) {
        this.#onPattern({
          song: metadata.song,
          order: 0,
          pattern: metadata.song.orders[0]?.pat ?? 0,
          row: 0
        });
      }
      this.#onSnapshot({
        duration: this.#safeSeconds(metadata.dur),
        subsong: this.#subsong,
        subsongCount: this.#subsongCount,
        error: undefined
      });
    });

    player.onProgress((progress) => {
      if (!this.#isPlayerLoadCurrent(player, loadToken)) {
        return;
      }

      if (progress.subsong !== undefined && progress.subsong !== this.#subsong) {
        return;
      }

      this.#currentTime = this.#safeSeconds(progress.pos);
      if (
        progress.order !== this.#lastPublishedOrder ||
        progress.pattern !== this.#lastPublishedPattern ||
        progress.row !== this.#lastPublishedRow
      ) {
        this.#lastPublishedOrder = progress.order;
        this.#lastPublishedPattern = progress.pattern;
        this.#lastPublishedRow = progress.row;
        this.#onPattern({
          order: progress.order,
          pattern: progress.pattern,
          row: progress.row
        });
      }
      this.#publishProgress(false, this.#currentTime, this.#safeSeconds(player.duration));
    });
  }

  #publishProgress(
    force = false,
    currentTime = this.#currentTime,
    duration = this.#safeSeconds(this.#player?.duration)
  ): void {
    if (!force) {
      const currentTimeDelta = Math.abs(currentTime - this.#lastPublishedCurrentTime);
      const durationChanged = duration !== this.#lastPublishedDuration;

      if (!durationChanged && currentTimeDelta < PROGRESS_PUBLISH_INTERVAL_SECONDS) {
        return;
      }
    }

    this.#lastPublishedCurrentTime = currentTime;
    this.#lastPublishedDuration = duration;
    this.#onSnapshot({
      currentTime,
      duration,
      error: undefined
    });
  }

  #resetPublishedProgress(): void {
    this.#lastPublishedCurrentTime = -1;
    this.#lastPublishedDuration = -1;
    this.#lastPublishedOrder = -1;
    this.#lastPublishedPattern = -1;
    this.#lastPublishedRow = -1;
  }

  #toPlayerConfig(settings: ModulePlaybackSettings) {
    return {
      repeatCount: settings.repeatCount,
      stereoSeparation: this.#getStereoWidth(settings),
      interpolationFilter: settings.interpolationFilter,
      context: audioBusService.context
    };
  }

  #getStereoWidth(settings: ModulePlaybackSettings): number {
    return this.#trackExtension === 'mod' ? settings.stereoSeparation : settings.panStrength;
  }

  #safeSeconds(value: number | undefined): number {
    if (!value || value < 0) {
      return 0;
    }

    return value > 1000 ? value / 1000 : value;
  }

  #toTrackMetadata(metadata: Chiptune3Metadata): TrackMetadata {
    const song = metadata.song;

    return {
      title: metadata.title || metadata.songtitle || undefined,
      artist: metadata.artist || undefined,
      message: metadata.message || metadata.message_raw || undefined,
      trackerType: metadata.tracker || metadata.originaltype_long || metadata.type || undefined,
      originalType: metadata.originaltype || undefined,
      duration: this.#safeSeconds(metadata.dur),
      patterns: metadata.totalPatterns ?? song?.patterns.length,
      channels: this.#toNumber(metadata.channels) ?? song?.channels.length,
      instruments: song?.instruments.length,
      orders: metadata.totalOrders ?? song?.orders.length,
      subsongs: song?.numSubsongs,
      subsongNames: Array.isArray(metadata.songs)
        ? metadata.songs.filter((value): value is string => typeof value === 'string')
        : undefined
    };
  }

  #toNumber(value: number | string | undefined): number | undefined {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : undefined;
    }

    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
  }

  #normalizeSubsongCount(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.max(1, Math.trunc(value))
      : 1;
  }

  #normalizeSubsong(value: unknown, count: unknown): number {
    const normalizedCount = this.#normalizeSubsongCount(count);
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.min(Math.max(Math.trunc(value), 0), normalizedCount - 1)
      : 0;
  }

  #disposeDetachedPlayer(player: ChiptuneJsPlayer): void {
    try {
      player.stop();
    } catch {
      // Ignore teardown failures for superseded players.
    } finally {
      try {
        player.gain.disconnect();
      } catch {
        // Ignore disconnect failures during teardown.
      }

      this.#disposeProcessNode(player);
    }
  }

  #disposeProcessNode(player: ChiptuneJsPlayer): void {
    try {
      player.processNode?.disconnect();
    } catch {
      // Ignore teardown failures for worklets that never finished initializing.
    }

    try {
      player.processNode?.port.close();
    } catch {
      // Ignore teardown failures for worklets whose ports already closed.
    }
  }

  #isActiveLoad(loadToken: number): boolean {
    return loadToken === this.#loadToken;
  }

  #isPlayerLoadCurrent(player: ChiptuneJsPlayer, loadToken: number): boolean {
    return this.#player === player && this.#isActiveLoad(loadToken);
  }
}
