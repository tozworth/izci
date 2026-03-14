import { ensureChiptunePlayer } from '$lib/services/chiptune-loader';
import type { PlaybackSnapshot, PlaylistItem, TrackMetadata } from '$lib/types';
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
  #handlersAttached = false;
  #onSnapshot: SnapshotHandler;
  #onMetadata: MetadataHandler;
  #onEnded: EndHandler;

  constructor(onSnapshot: SnapshotHandler, onMetadata: MetadataHandler, onEnded: EndHandler) {
    this.#onSnapshot = onSnapshot;
    this.#onMetadata = onMetadata;
    this.#onEnded = onEnded;
  }

  async load(track: PlaylistItem): Promise<void> {
    this.stop();
    this.#onSnapshot({
      backend: 'module',
      state: 'loading',
      currentTime: 0,
      duration: 0,
      error: undefined
    });

    this.#player = await ensureChiptunePlayer();
    this.#attachHandlers();
    this.#player.setVol(this.#volume);
    this.#buffer = await track.file.arrayBuffer();
    this.#started = false;

    this.#onMetadata({
      title: track.name.replace(/\.[^.]+$/, ''),
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
    this.#player?.stop();
    this.#buffer = null;
    this.#onSnapshot({ state: 'paused', currentTime: 0, error: undefined });
  }

  seek(seconds: number): void {
    if (!this.#player || !this.#started) {
      return;
    }

    this.#player.seek(seconds);
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

  #attachHandlers(): void {
    if (!this.#player || this.#handlersAttached) {
      return;
    }

    this.#handlersAttached = true;

    this.#player.onEnded(() => {
      this.#playing = false;
      this.#started = false;
      this.#onSnapshot({ state: 'ended' });
      this.#onEnded();
    });

    this.#player.onError((error) => {
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

    this.#player.onMetadata((metadata) => {
      this.#onMetadata(this.#toTrackMetadata(metadata));
      this.#onSnapshot({
        duration: this.#safeSeconds(metadata.dur),
        error: undefined
      });
    });

    this.#player.onProgress((progress) => {
      this.#onSnapshot({
        currentTime: this.#safeSeconds(progress.pos),
        duration: this.#safeSeconds(this.#player?.duration),
        error: undefined
      });
    });
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
      subsongs: song?.numSubsongs
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
