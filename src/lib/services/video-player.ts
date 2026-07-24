import { audioBusService } from '$lib/services/audio-bus';
import type { PlaybackSnapshot, PlaylistItem, TrackMetadata } from '$lib/types';

type SnapshotHandler = (snapshot: Partial<PlaybackSnapshot>) => void;
type MetadataHandler = (metadata: TrackMetadata) => void;
type EndHandler = () => void;

interface VideoLoadOptions {
  autoPlay?: boolean;
  initialPosition?: number;
}

export class VideoPlayerService {
  #element: HTMLVideoElement | null = null;
  #audioSource: MediaElementAudioSourceNode | null = null;
  #active = false;
  #autoPlay = false;
  #initialPosition = 0;
  #initialPositionApplied = false;
  #fallbackVolume = 1;
  #trackSize = 0;

  constructor(
    readonly onSnapshot: SnapshotHandler,
    readonly onMetadata: MetadataHandler,
    readonly onEnded: EndHandler
  ) {}

  get element(): HTMLVideoElement | null {
    return this.#ensureElement();
  }

  get pictureInPictureSupported(): boolean {
    const element = this.#ensureElement();

    return Boolean(
      element &&
      typeof document !== 'undefined' &&
      document.pictureInPictureEnabled &&
      typeof element.requestPictureInPicture === 'function'
    );
  }

  async togglePictureInPicture(): Promise<boolean> {
    const element = this.#element;

    if (!element || !this.#active || !this.pictureInPictureSupported) {
      return false;
    }

    try {
      if (document.pictureInPictureElement === element) {
        await document.exitPictureInPicture();
        return false;
      }

      await element.requestPictureInPicture();
      return true;
    } catch {
      return false;
    }
  }

  load(track: PlaylistItem, options: VideoLoadOptions = {}): void {
    if (!track.objectUrl) {
      throw new Error('Expected an object URL for video playback.');
    }

    const element = this.#ensureElement();

    if (!element) {
      throw new Error('Video playback is unavailable outside a browser window.');
    }

    this.unload();
    this.#active = true;
    this.#autoPlay = options.autoPlay === true;
    this.#initialPosition = Math.max(options.initialPosition ?? 0, 0);
    this.#initialPositionApplied = false;
    this.#trackSize = track.size;
    this.onSnapshot({
      backend: 'video',
      state: 'loading',
      currentTime: 0,
      duration: track.metadata?.duration ?? 0,
      error: undefined
    });

    element.src = track.objectUrl;
    element.load();

    if (this.#autoPlay) {
      this.#requestPlay();
    }
  }

  play(): void {
    this.#autoPlay = true;
    this.#requestPlay();
  }

  pause(): void {
    this.#autoPlay = false;
    this.#element?.pause();
  }

  seek(seconds: number): void {
    const element = this.#element;

    if (!element || !this.#active) {
      return;
    }

    this.#initialPosition = Math.max(seconds, 0);
    const duration = Number.isFinite(element.duration) ? element.duration : Number.POSITIVE_INFINITY;
    element.currentTime = Math.min(this.#initialPosition, duration);
    this.#publishProgress();
  }

  setFallbackVolume(gain: number): void {
    this.#fallbackVolume = Math.min(Math.max(gain, 0), 1);
    this.#applyOutputVolume();
  }

  unload(): void {
    const element = this.#element;

    this.#active = false;
    this.#autoPlay = false;
    this.#initialPosition = 0;
    this.#initialPositionApplied = false;
    this.#trackSize = 0;
    audioBusService.disconnect(this.#audioSource);
    this.#audioSource = null;

    if (!element) {
      return;
    }

    element.pause();
    if (typeof document !== 'undefined' && document.pictureInPictureElement === element) {
      void document.exitPictureInPicture().catch(() => undefined);
    }
    element.removeAttribute('src');
    element.load();
  }

  destroy(): void {
    this.unload();
    this.#element?.remove();
    this.#element = null;
  }

  #ensureElement(): HTMLVideoElement | null {
    if (this.#element || typeof document === 'undefined') {
      return this.#element;
    }

    const element = document.createElement('video');
    element.preload = 'metadata';
    element.playsInline = true;
    element.controls = false;
    element.disablePictureInPicture = false;
    element.setAttribute('aria-label', 'Video playback');
    element.addEventListener('loadedmetadata', () => this.#handleLoadedMetadata());
    element.addEventListener('durationchange', () => this.#publishProgress());
    element.addEventListener('timeupdate', () => this.#publishProgress());
    element.addEventListener('seeked', () => this.#publishProgress());
    element.addEventListener('playing', () => {
      if (!this.#active) return;
      this.#connectAudioBus();
      audioBusService.resume();
      this.#publishProgress();
      this.onSnapshot({ state: 'playing', error: undefined });
    });
    element.addEventListener('pause', () => {
      if (!this.#active || element.ended) return;
      this.#publishProgress();
      this.onSnapshot({ state: 'paused', error: undefined });
    });
    element.addEventListener('waiting', () => {
      if (this.#active && this.#autoPlay) {
        this.onSnapshot({ state: 'loading', error: undefined });
      }
    });
    element.addEventListener('ended', () => {
      if (!this.#active) return;
      this.#publishProgress();
      this.onSnapshot({ state: 'ended', error: undefined });
      this.onEnded();
    });
    element.addEventListener('error', () => {
      if (!this.#active) return;
      this.onSnapshot({ state: 'error', error: this.#resolveErrorMessage(element.error) });
    });

    this.#element = element;
    return element;
  }

  #handleLoadedMetadata(): void {
    const element = this.#element;

    if (!element || !this.#active) {
      return;
    }

    this.#connectAudioBus();
    const duration = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : 0;

    if (!this.#initialPositionApplied) {
      this.#initialPositionApplied = true;
      element.currentTime = Math.min(this.#initialPosition, duration || this.#initialPosition);
    }

    const bitrate = duration > 0 ? Math.round((this.#trackSize * 8) / duration / 1000) : undefined;
    this.onMetadata({ duration, bitrate });
    this.#publishProgress();

    if (this.#autoPlay) {
      this.#requestPlay();
    } else {
      this.onSnapshot({ state: 'paused', error: undefined });
    }
  }

  #requestPlay(): void {
    const element = this.#element;

    if (!element || !this.#active) {
      return;
    }

    void element.play().catch((error: unknown) => {
      if (!this.#active || !this.#autoPlay) {
        return;
      }

      this.onSnapshot({ state: 'error', error: error instanceof Error ? error.message : String(error) });
    });
  }

  #connectAudioBus(): void {
    const element = this.#element;

    if (!element || this.#audioSource) {
      return;
    }

    this.#audioSource = audioBusService.connectHtmlMediaElement(element);
    this.#applyOutputVolume();
  }

  #applyOutputVolume(): void {
    if (this.#element) {
      this.#element.volume = this.#audioSource ? 1 : this.#fallbackVolume;
    }
  }

  #publishProgress(): void {
    const element = this.#element;

    if (!element || !this.#active) {
      return;
    }

    this.onSnapshot({
      currentTime: Number.isFinite(element.currentTime) ? element.currentTime : 0,
      duration: Number.isFinite(element.duration) ? element.duration : 0,
      error: undefined
    });
  }

  #resolveErrorMessage(error: MediaError | null): string {
    if (error?.code === 3 || error?.code === 4) {
      return 'Chromium could not decode this video.';
    }

    return error?.message || 'Video playback failed.';
  }
}
