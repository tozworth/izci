import { createChiptunePlayer } from '$lib/services/chiptune-loader';
import { modulePlaybackSettings } from '$lib/stores/module-playback-settings';
import type { ModulePlaybackSettings, PlaybackSnapshot, PlaylistItem, TrackMetadata } from '$lib/types';
import type { Chiptune3Metadata, ChiptuneJsPlayer } from 'chiptune3';

type SnapshotHandler = (snapshot: Partial<PlaybackSnapshot>) => void;
type MetadataHandler = (metadata: TrackMetadata) => void;
type EndHandler = () => void;

export class ModulePlayerService {
  #player: ChiptuneJsPlayer | null = null;
  #buffer: ArrayBuffer | null = null;
  #volume = 0.85;
  #playing = false;
  #started = false;
  #currentTime = 0;
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
    this.#disposePlayer();
    this.#buffer = null;
    this.#playing = false;
    this.#started = false;
    this.#currentTime = 0;

    this.#onSnapshot({
      backend: 'module',
      state: 'loading',
      currentTime: 0,
      duration: 0,
      error: undefined
    });

    this.#player = await this.#createPlayer();
    this.#buffer = await track.file.arrayBuffer();

    this.#onMetadata({
      trackerType: track.extension.toUpperCase()
    });
    this.#onSnapshot({ duration: 0, state: 'paused' });
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
  }

  pause(): void {
    if (!this.#player || !this.#playing) {
      return;
    }

    this.#player.pause();
    this.#playing = false;
    this.#onSnapshot({ state: 'paused' });
  }

  stop(): void {
    this.#playing = false;
    this.#started = false;
    this.#currentTime = 0;
    this.#buffer = null;
    this.#disposePlayer();
    this.#onSnapshot({ state: 'paused', currentTime: 0, error: undefined });
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
    this.#onSnapshot({
      currentTime: seconds,
      error: undefined
    });
  }

  setVolume(volume: number): void {
    this.#volume = volume;
    this.#player?.setVol(volume);
    this.#onSnapshot({ volume, error: undefined });
  }

  async applySettings(settings: ModulePlaybackSettings): Promise<void> {
    const previousSettings = this.#settings;
    const recreatePlayer =
      previousSettings.stereoSeparation !== settings.stereoSeparation ||
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

  async #createPlayer(): Promise<ChiptuneJsPlayer> {
    const player = await createChiptunePlayer(this.#toPlayerConfig(this.#settings));

    player.setVol(this.#volume);
    player.setRepeatCount(this.#settings.repeatCount);
    this.#attachHandlers(player);

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
    const wasStarted = this.#started;
    const wasPlaying = this.#playing;
    const restorePosition = this.#currentTime;
    const buffer = this.#buffer;

    this.#disposePlayer();
    this.#player = await this.#createPlayer();

    if (!wasStarted || !buffer || !this.#player) {
      this.#started = false;
      this.#playing = false;
      this.#currentTime = restorePosition;
      this.#onSnapshot({ state: 'paused', currentTime: restorePosition, error: undefined });
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
      return;
    }

    this.#onSnapshot({ state: 'playing', currentTime: restorePosition, error: undefined });
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

  #attachHandlers(player: ChiptuneJsPlayer): void {
    player.onEnded(() => {
      this.#playing = false;
      this.#started = false;
      this.#currentTime = 0;
      this.#onSnapshot({ state: 'ended' });
      this.#onEnded();
    });

    player.onError((error) => {
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
      this.#onMetadata(this.#toTrackMetadata(metadata));
      this.#onSnapshot({
        duration: this.#safeSeconds(metadata.dur),
        error: undefined
      });
    });

    player.onProgress((progress) => {
      this.#currentTime = this.#safeSeconds(progress.pos);
      this.#onSnapshot({
        currentTime: this.#currentTime,
        duration: this.#safeSeconds(player.duration),
        error: undefined
      });
    });
  }

  #toPlayerConfig(settings: ModulePlaybackSettings) {
    return {
      repeatCount: settings.repeatCount,
      stereoSeparation: settings.stereoSeparation,
      interpolationFilter: settings.interpolationFilter
    };
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
      trackerType: metadata.type || metadata.tracker || metadata.originaltype || undefined,
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
}
