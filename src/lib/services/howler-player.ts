import { Howl } from 'howler';
import type { PlaybackSnapshot, PlaylistItem, TrackMetadata } from '$lib/types';

type SnapshotHandler = (snapshot: Partial<PlaybackSnapshot>) => void;
type MetadataHandler = (metadata: TrackMetadata) => void;
type EndHandler = () => void;

export class HowlerPlayerService {
  #howl: Howl | null = null;
  #onSnapshot: SnapshotHandler;
  #onMetadata: MetadataHandler;
  #onEnded: EndHandler;

  constructor(onSnapshot: SnapshotHandler, onMetadata: MetadataHandler, onEnded: EndHandler) {
    this.#onSnapshot = onSnapshot;
    this.#onMetadata = onMetadata;
    this.#onEnded = onEnded;
  }

  load(track: PlaylistItem): void {
    if (!track.objectUrl) {
      throw new Error('Expected an object URL for streamable audio.');
    }

    this.destroy();
    this.#onSnapshot({
      backend: 'stream',
      state: 'loading',
      currentTime: 0,
      duration: 0,
      error: undefined
    });

    this.#howl = new Howl({
      src: [track.objectUrl],
      html5: false,
      format: [track.extension],
      onload: () => {
        const duration = this.#howl?.duration() ?? 0;
        this.#onMetadata({
          title: track.name.replace(/\.[^.]+$/, ''),
          duration
        });
        this.#onSnapshot({ duration, state: 'paused' });
      },
      onplay: () => {
        this.#tick();
        this.#onSnapshot({ state: 'playing' });
      },
      onpause: () => {
        this.#onSnapshot({ state: 'paused' });
      },
      onstop: () => {
        this.#onSnapshot({ currentTime: 0, state: 'paused' });
      },
      onend: () => {
        this.#onSnapshot({ state: 'ended' });
        this.#onEnded();
      },
      onloaderror: (_id: number, message: unknown) => {
        this.#onSnapshot({ state: 'error', error: String(message) });
      },
      onplayerror: (_id: number, message: unknown) => {
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
    this.#howl?.seek(seconds);
    this.#onSnapshot({ currentTime: seconds });
  }

  setVolume(volume: number): void {
    this.#howl?.volume(volume);
    this.#onSnapshot({ volume });
  }

  destroy(): void {
    this.#howl?.unload();
    this.#howl = null;
  }

  #tick(): void {
    if (!this.#howl || !this.#howl.playing()) {
      return;
    }

    const currentTime = Number(this.#howl.seek() ?? 0);
    const duration = this.#howl.duration();

    this.#onSnapshot({ currentTime, duration });
    requestAnimationFrame(() => this.#tick());
  }
}
