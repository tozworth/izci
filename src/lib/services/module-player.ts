import { createChiptunePlayer } from '$lib/services/chiptune-loader';
import { mediaSessionService } from '$lib/services/media-session';
import { sliderVolumeToGain } from '$lib/services/volume';
import { modulePlaybackSettings } from '$lib/stores/module-playback-settings';
import type { ModulePlaybackSettings, PlaybackSnapshot, PlaylistItem, TrackMetadata } from '$lib/types';
import type { Chiptune3Metadata, ChiptuneJsPlayer } from 'chiptune3';

type SnapshotHandler = (snapshot: Partial<PlaybackSnapshot>) => void;
type MetadataHandler = (metadata: TrackMetadata) => void;
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
  #volume = 0.85;
  #useLogarithmicVolume = true;
  #playing = false;
  #started = false;
  #currentTime = 0;
  #lastPublishedCurrentTime = -1;
  #lastPublishedDuration = -1;
  #settings = modulePlaybackSettings.getSnapshot();
  #onSnapshot: SnapshotHandler;
  #onMetadata: MetadataHandler;
  #onEnded: EndHandler;

  constructor(onSnapshot: SnapshotHandler, onMetadata: MetadataHandler, onEnded: EndHandler) {
    this.#onSnapshot = onSnapshot;
    this.#onMetadata = onMetadata;
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
    this.#resetPublishedProgress();

    this.#onSnapshot({
      backend: 'module',
      state: 'loading',
      currentTime: 0,
      duration: 0,
      error: undefined
    });

    const player = await this.#createPlayer(loadToken);

    if (!this.#isActiveLoad(loadToken)) {
      this.#disposeDetachedPlayer(player);
      return;
    }

    this.#player = player;
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

    void this.#player.context.resume();

    if (!this.#started) {
      this.#player.play(this.#buffer);
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
    this.#buffer = null;
    this.#trackExtension = null;
    this.#resetPublishedProgress();
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

  setVolume(volume: number, logarithmicVolume: boolean = this.#useLogarithmicVolume): void {
    this.#volume = volume;
    this.#useLogarithmicVolume = logarithmicVolume;
    this.#player?.setVol(sliderVolumeToGain(volume, this.#useLogarithmicVolume));
    this.#onSnapshot({ volume, error: undefined });
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

  async #createPlayer(loadToken: number = this.#loadToken): Promise<ChiptuneJsPlayer> {
    const player = await createChiptunePlayer(this.#toPlayerConfig(this.#settings));

    player.setVol(sliderVolumeToGain(this.#volume, this.#useLogarithmicVolume));
    player.setRepeatCount(this.#settings.repeatCount);
    this.#attachHandlers(player, loadToken);

    return player;
  }

  #disposePlayer(): void {
    const player = this.#player;

    this.#player = null;

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

      void player.context.close().catch(() => undefined);
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

      this.#onMetadata(this.#toTrackMetadata(metadata));
      this.#onSnapshot({
        duration: this.#safeSeconds(metadata.dur),
        error: undefined
      });
    });

    player.onProgress((progress) => {
      if (!this.#isPlayerLoadCurrent(player, loadToken)) {
        return;
      }

      this.#currentTime = this.#safeSeconds(progress.pos);
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
  }

  #toPlayerConfig(settings: ModulePlaybackSettings) {
    return {
      repeatCount: settings.repeatCount,
      stereoSeparation: this.#getStereoWidth(settings),
      interpolationFilter: settings.interpolationFilter
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

      void player.context.close().catch(() => undefined);
    }
  }

  #isActiveLoad(loadToken: number): boolean {
    return loadToken === this.#loadToken;
  }

  #isPlayerLoadCurrent(player: ChiptuneJsPlayer, loadToken: number): boolean {
    return this.#player === player && this.#isActiveLoad(loadToken);
  }
}
