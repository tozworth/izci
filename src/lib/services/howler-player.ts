import { Howl } from 'howler';
import type { PlaybackSnapshot, PlaylistItem, TrackMetadata } from '$lib/types';
import { sliderVolumeToGain } from '$lib/services/volume';
import { visualizerService } from '$lib/services/visualizer';

type SnapshotHandler = (snapshot: Partial<PlaybackSnapshot>) => void;
type MetadataHandler = (metadata: TrackMetadata) => void;
type EndHandler = () => void;
type HowlWithSounds = Howl & {
  _sounds?: Array<{
    _node?: HTMLMediaElement;
  }>;
};

interface StreamLoadOptions {
  autoPlay?: boolean;
}

const PROGRESS_PUBLISH_INTERVAL_SECONDS = 0.125;

export class HowlerPlayerService {
  #howl: Howl | null = null;
  #loadToken = 0;
  #autoPlayOnLoad = false;
  #tickFrame: number | null = null;
  #shouldTrackProgress = false;
  #useLogarithmicVolume = true;
  #lastPublishedCurrentTime = -1;
  #lastPublishedDuration = -1;
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
    this.#resetPublishedProgress();
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

        this.#connectVisualizer();
        this.#shouldTrackProgress = true;
        this.#publishProgress(true);
        this.#startTicking();
        this.#onSnapshot({ state: 'playing' });
      },
      onpause: () => {
        if (!this.#isActiveLoad(loadToken)) {
          return;
        }

        this.#shouldTrackProgress = false;
        this.#stopTicking();
        this.#publishProgress(true);
        this.#onSnapshot({ state: 'paused' });
      },
      onstop: () => {
        if (!this.#isActiveLoad(loadToken)) {
          return;
        }

        this.#shouldTrackProgress = false;
        this.#stopTicking();
        this.#resetPublishedProgress();
        this.#onSnapshot({ currentTime: 0, state: 'paused' });
      },
      onend: () => {
        if (!this.#isActiveLoad(loadToken)) {
          return;
        }

        this.#shouldTrackProgress = false;
        this.#stopTicking();
        this.#publishProgress(true, this.#howl?.duration() ?? 0, this.#howl?.duration() ?? 0);
        this.#onSnapshot({ state: 'ended' });
        this.#onEnded();
      },
      onseek: () => {
        if (!this.#isActiveLoad(loadToken)) {
          return;
        }

        this.#publishProgress(true);
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
    this.#autoPlayOnLoad = true;
    this.#howl?.play();
  }

  pause(): void {
    this.#autoPlayOnLoad = false;
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
    this.#publishProgress(true, seconds);

    if (wasPlaying) {
      this.#startTicking();
    }
  }

  setVolume(volume: number, logarithmicVolume: boolean = this.#useLogarithmicVolume): void {
    this.#useLogarithmicVolume = logarithmicVolume;
    this.#howl?.volume(sliderVolumeToGain(volume, this.#useLogarithmicVolume));
  }

  destroy(): void {
    this.#loadToken += 1;
    this.#autoPlayOnLoad = false;
    this.#shouldTrackProgress = false;
    this.#resetPublishedProgress();
    this.#stopTicking();
    this.#howl?.unload();
    this.#howl = null;
    visualizerService.clear();
  }

  #connectVisualizer(): void {
    const mediaElement = (this.#howl as HowlWithSounds | null)?._sounds?.find(
      (sound) => sound._node instanceof HTMLMediaElement
    )?._node;

    visualizerService.connectHtmlMediaElement(mediaElement ?? null);
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

    this.#publishProgress(false, currentTime, duration);
    this.#tickFrame = requestAnimationFrame(() => this.#tick());
  }

  #publishProgress(
    force = false,
    currentTime = Number(this.#howl?.seek() ?? 0),
    duration = this.#howl?.duration() ?? 0
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
    this.#onSnapshot({ currentTime, duration, error: undefined });
  }

  #resetPublishedProgress(): void {
    this.#lastPublishedCurrentTime = -1;
    this.#lastPublishedDuration = -1;
  }

  #isActiveLoad(loadToken: number): boolean {
    return this.#howl !== null && loadToken === this.#loadToken;
  }
}
