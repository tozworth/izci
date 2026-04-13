import { Howl } from 'howler';
import type { PlaybackSnapshot, PlaylistItem, TrackMetadata } from '$lib/types';

type SnapshotHandler = (snapshot: Partial<PlaybackSnapshot>) => void;
type MetadataHandler = (metadata: TrackMetadata) => void;
type EndHandler = () => void;

interface StreamLoadOptions {
  autoPlay?: boolean;
}

export class HowlerPlayerService {
  #howl: Howl | null = null;
  #loadToken = 0;
  #autoPlayOnLoad = false;
  #tickFrame: number | null = null;
  #shouldTrackProgress = false;
  #onSnapshot: SnapshotHandler;
  #onMetadata: MetadataHandler;
  #onEnded: EndHandler;

  constructor(onSnapshot: SnapshotHandler, onMetadata: MetadataHandler, onEnded: EndHandler) {
    this.#onSnapshot = onSnapshot;
    this.#onMetadata = onMetadata;
    this.#onEnded = onEnded;
  }

  load(track: PlaylistItem, options: StreamLoadOptions = {}): void {
    if (!track.objectUrl) {
      throw new Error('Expected an object URL for streamable audio.');
    }

    this.destroy();
    const loadToken = ++this.#loadToken;
    this.#autoPlayOnLoad = options.autoPlay === true;
    this.#onSnapshot({
      backend: 'stream',
      state: 'loading',
      currentTime: 0,
      duration: 0,
      error: undefined
    });

    this.#howl = new Howl({
      src: [track.objectUrl],
      // Use a real media element so Chromium keeps native media controls alive while paused.
      html5: true,
      format: [track.extension],
      onload: () => {
        if (!this.#isActiveLoad(loadToken)) {
          return;
        }

        const duration = this.#howl?.duration() ?? 0;
        const bitrate = duration > 0 ? Math.round((track.size * 8) / duration / 1000) : undefined;
        this.#onMetadata({
          duration,
          bitrate
        });

        if (this.#autoPlayOnLoad) {
          this.#howl?.play();
          return;
        }

        this.#onSnapshot({ duration, state: 'paused' });
      },
      onplay: () => {
        if (!this.#isActiveLoad(loadToken)) {
          return;
        }

        this.#shouldTrackProgress = true;
        this.#startTicking();
        this.#onSnapshot({ state: 'playing' });
      },
      onpause: () => {
        if (!this.#isActiveLoad(loadToken)) {
          return;
        }

        this.#shouldTrackProgress = false;
        this.#stopTicking();
        this.#onSnapshot({ state: 'paused' });
      },
      onstop: () => {
        if (!this.#isActiveLoad(loadToken)) {
          return;
        }

        this.#shouldTrackProgress = false;
        this.#stopTicking();
        this.#onSnapshot({ currentTime: 0, state: 'paused' });
      },
      onend: () => {
        if (!this.#isActiveLoad(loadToken)) {
          return;
        }

        this.#shouldTrackProgress = false;
        this.#stopTicking();
        this.#onSnapshot({ state: 'ended' });
        this.#onEnded();
      },
      onseek: () => {
        if (!this.#isActiveLoad(loadToken)) {
          return;
        }

        this.#onSnapshot({ currentTime: Number(this.#howl?.seek() ?? 0), error: undefined });
        this.#startTicking();
      },
      onloaderror: (_id: number, message: unknown) => {
        if (!this.#isActiveLoad(loadToken)) {
          return;
        }

        this.#onSnapshot({ state: 'error', error: String(message) });
      },
      onplayerror: (_id: number, message: unknown) => {
        if (!this.#isActiveLoad(loadToken)) {
          return;
        }

        this.#onSnapshot({ state: 'error', error: String(message) });
      }
    });

  }

  play(): void {
    this.#howl?.play();
  }

  pause(): void {
    this.#howl?.pause();
  }

  stop(): void {
    this.#howl?.stop();
  }

  seek(seconds: number): void {
    const wasPlaying = this.#howl?.playing() ?? false;

    if (wasPlaying) {
      this.#shouldTrackProgress = true;
    }

    this.#howl?.seek(seconds);
    this.#onSnapshot({ currentTime: seconds, error: undefined });

    if (wasPlaying) {
      this.#startTicking();
    }
  }

  setVolume(volume: number): void {
    this.#howl?.volume(volume);
    this.#onSnapshot({ volume });
  }

  destroy(): void {
    this.#loadToken += 1;
    this.#autoPlayOnLoad = false;
    this.#shouldTrackProgress = false;
    this.#stopTicking();
    this.#howl?.unload();
    this.#howl = null;
  }

  #startTicking(): void {
    if (this.#tickFrame !== null) {
      return;
    }

    this.#tick();
  }

  #stopTicking(): void {
    if (this.#tickFrame === null) {
      return;
    }

    cancelAnimationFrame(this.#tickFrame);
    this.#tickFrame = null;
  }

  #tick(): void {
    this.#tickFrame = null;

    if (!this.#howl) {
      return;
    }

    const isPlaying = this.#howl.playing();

    if (!isPlaying) {
      if (this.#shouldTrackProgress) {
        this.#tickFrame = requestAnimationFrame(() => this.#tick());
      }
      return;
    }

    const currentTime = Number(this.#howl.seek() ?? 0);
    const duration = this.#howl.duration();

    this.#onSnapshot({ currentTime, duration, error: undefined });
    this.#tickFrame = requestAnimationFrame(() => this.#tick());
  }

  #isActiveLoad(loadToken: number): boolean {
    return this.#howl !== null && loadToken === this.#loadToken;
  }
}
