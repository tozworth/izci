import { Howl } from 'howler';
import { audioBusService } from '$lib/services/audio-bus';
import { logDebug, logError, logInfo, logWarning } from '$lib/services/logging';
import type { PlaybackSnapshot, TrackItem, ReplayGainMetadata, ReplayGainMode, TrackMetadata } from '$lib/types';
import { applyReplayGain, sliderVolumeToGain } from '$lib/services/volume';

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
  initialPosition?: number;
}

const PROGRESS_PUBLISH_INTERVAL_SECONDS = 0.125;
const PROGRESS_POLL_INTERVAL_MILLISECONDS = 125;
// Concurrent blob loads on mobile Chromium contend badly; keep the previous media
// element alive until the incoming load reaches its media event, then unload it.
const DEFERRED_UNLOAD_MS = 4_000;

function describeMediaElement(element: HTMLMediaElement | null | undefined): Record<string, unknown> {
  if (!element) return { element: 'none' };
  const bufferedEnd = element.buffered?.length > 0
    ? Math.round(element.buffered.end(element.buffered.length - 1) * 10) / 10
    : 0;
  return {
    readyState: element.readyState,
    networkState: element.networkState,
    bufferedEnd,
    errorCode: element.error?.code ?? null
  };
}

export class HowlerPlayerService {
  #howl: Howl | null = null;
  #pendingUnloadTimer: number | null = null;
  #pendingUnloadHowl: { unload(): unknown } | null = null;
  #audioSource: MediaElementAudioSourceNode | null = null;
  #loadToken = 0;
  #autoPlayOnLoad = false;
  #initialPosition = 0;
  #tickTimer: number | null = null;
  #shouldTrackProgress = false;
  #useLogarithmicVolume = true;
  #replayGainMode: ReplayGainMode = 'track';
  #replayGain: ReplayGainMetadata | undefined;
  #replayGainPreampDb = 0;
  #fallbackVolume = 1;
  #transitionGain = 1;
  #fallbackRampFrame: number | null = null;
  #playbackRate = 1;
  #trueSpeed = false;
  #lastPublishedCurrentTime = -1;
  #lastPublishedDuration = -1;
  #pendingLoadResolve: (() => void) | null = null;
  #pendingLoadReject: ((error: Error) => void) | null = null;
  #loaded = false;
  #playPending = false;
  #onSnapshot: SnapshotHandler;
  #onMetadata: MetadataHandler;
  #onEnded: EndHandler;

  constructor(onSnapshot: SnapshotHandler, onMetadata: MetadataHandler, onEnded: EndHandler) {
    this.#onSnapshot = onSnapshot;
    this.#onMetadata = onMetadata;
    this.#onEnded = onEnded;
  }

  load(track: TrackItem, options: StreamLoadOptions = {}): Promise<void> {
    if (!track.objectUrl) {
      throw new Error('Expected an object URL for streamable audio.');
    }

    this.#deferPreviousUnload();
    logInfo('playback', 'Stream load started', { id: track.id, name: track.name, extension: track.extension });
    const loadStartedAt = performance.now();
    const loadToken = ++this.#loadToken;
    this.#resetPublishedProgress();
    this.#replayGain = track.metadata?.replayGain;
    this.#autoPlayOnLoad = options.autoPlay === true;
    this.#initialPosition = Math.max(options.initialPosition ?? 0, 0);
    this.#onSnapshot({
      backend: 'stream',
      state: 'loading',
      currentTime: 0,
      duration: 0,
      error: undefined
    });

    const ready = new Promise<void>((resolve, reject) => {
      this.#pendingLoadResolve = resolve;
      this.#pendingLoadReject = reject;
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

        this.#loaded = true;
        this.#connectAudioBus();
        const duration = this.#howl?.duration() ?? 0;
        const initialPosition = Math.min(this.#initialPosition, duration);
        const bitrate = duration > 0 ? Math.round((track.size * 8) / duration / 1000) : undefined;
        this.#onMetadata({
          duration,
          bitrate
        });
        this.#settlePendingLoad();
        logInfo('playback', 'Stream loaded', {
          id: track.id,
          duration,
          bitrate,
          loadMs: Math.round(performance.now() - loadStartedAt),
          media: describeMediaElement(this.#activeMediaElement())
        });

        if (initialPosition > 0) {
          this.#howl?.seek(initialPosition);
        }

        if (this.#autoPlayOnLoad) {
          this.#startPlayback();
          return;
        }

        this.#onSnapshot({ currentTime: initialPosition, duration, state: 'paused' });
      },
      onplay: () => {
        if (!this.#isActiveLoad(loadToken)) {
          return;
        }

        this.#flushDeferredUnload();
        this.#playPending = false;
        this.#connectAudioBus();
        audioBusService.resume();
        this.#shouldTrackProgress = true;
        this.#publishProgress(true);
        this.#startTicking();
        this.#onSnapshot({ state: 'playing' });
        logInfo('playback', 'Stream playing', { id: track.id });
      },
      onpause: () => {
        if (!this.#isActiveLoad(loadToken)) {
          return;
        }

        this.#flushDeferredUnload();
        this.#playPending = false;
        this.#shouldTrackProgress = false;
        this.#stopTicking();
        this.#publishProgress(true);
        this.#onSnapshot({ state: 'paused' });
      },
      onstop: () => {
        if (!this.#isActiveLoad(loadToken)) {
          return;
        }

        this.#flushDeferredUnload();
        this.#playPending = false;
        this.#shouldTrackProgress = false;
        this.#stopTicking();
        this.#resetPublishedProgress();
        this.#onSnapshot({ currentTime: 0, state: 'paused' });
      },
      onend: () => {
        if (!this.#isActiveLoad(loadToken)) {
          return;
        }

        this.#playPending = false;
        this.#shouldTrackProgress = false;
        this.#stopTicking();
        this.#publishProgress(true, this.#howl?.duration() ?? 0, this.#howl?.duration() ?? 0);
        this.#onSnapshot({ state: 'ended' });
        logInfo('playback', 'Stream ended', { id: track.id });
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

        this.#loaded = false;
        this.#playPending = false;
        const error = new Error(String(message));
        logError('playback', 'Stream load failed', {
          id: track.id,
          error: error.message,
          loadMs: Math.round(performance.now() - loadStartedAt),
          media: describeMediaElement(this.#activeMediaElement())
        });
        this.#onSnapshot({ state: 'error', error: error.message });
        this.#settlePendingLoad(error);
      },
      onplayerror: (_id: number, message: unknown) => {
        if (!this.#isActiveLoad(loadToken)) {
          return;
        }

        this.#playPending = false;
        logWarning('playback', 'Stream play blocked', { id: track.id, error: String(message) });
        this.#onSnapshot({ state: 'error', error: String(message) });
      }
    });
    this.#howl.rate(this.#playbackRate);
    return ready;
  }

  play(): void {
    this.#autoPlayOnLoad = true;
    void audioBusService.resume();
    this.#startPlayback();
  }

  pause(): void {
    this.#autoPlayOnLoad = false;
    this.#playPending = false;
    this.#howl?.pause();
  }

  seek(seconds: number): void {
    const nextPosition = Math.max(seconds, 0);
    const wasPlaying = this.#howl?.playing() ?? false;
    this.#initialPosition = nextPosition;
    logDebug('playback', 'Stream seek', { seconds: nextPosition });

    if (wasPlaying) {
      this.#shouldTrackProgress = true;
    }

    this.#howl?.seek(nextPosition);
    this.#publishProgress(true, nextPosition);

    if (wasPlaying) {
      this.#startTicking();
    }
  }

  setVolume(
    volume: number,
    logarithmicVolume: boolean = this.#useLogarithmicVolume,
    replayGain: ReplayGainMetadata | undefined = this.#replayGain,
    replayGainMode: ReplayGainMode = this.#replayGainMode,
    replayGainPreampDb: number = this.#replayGainPreampDb
  ): void {
    this.#useLogarithmicVolume = logarithmicVolume;
    this.#replayGain = replayGain;
    this.#replayGainMode = replayGainMode;
    this.#replayGainPreampDb = replayGainPreampDb;
    this.#fallbackVolume = applyReplayGain(
      sliderVolumeToGain(volume, this.#useLogarithmicVolume),
      replayGain,
      replayGainMode,
      replayGainPreampDb
    );
    this.#applyOutputVolume();
  }

  setPlaybackRate(playbackRate: number, trueSpeed: boolean): void {
    this.#playbackRate = playbackRate;
    this.#trueSpeed = trueSpeed;
    this.#howl?.rate(playbackRate);
    this.#applyPitchPreservation();
  }

  setTransitionGain(gain: number, durationSeconds = 0): void {
    this.#transitionGain = Math.max(gain, 0);

    if (this.#audioSource) {
      audioBusService.setSourceGain(this.#audioSource, this.#transitionGain, durationSeconds);
      return;
    }

    const target = this.#fallbackVolume * this.#transitionGain;
    if (durationSeconds > 0 && this.#howl) {
      this.#rampFallbackVolume(target, durationSeconds);
    } else {
      this.#cancelFallbackRamp();
      this.#howl?.volume(target);
    }
  }

  destroy(): void {
    this.#settlePendingLoad();
    this.#loadToken += 1;
    this.#autoPlayOnLoad = false;
    this.#loaded = false;
    this.#playPending = false;
    this.#initialPosition = 0;
    this.#shouldTrackProgress = false;
    this.#replayGain = undefined;
    this.#replayGainPreampDb = 0;
    this.#resetPublishedProgress();
    this.#stopTicking();
    this.#cancelFallbackRamp();
    this.#flushDeferredUnload();
    audioBusService.disconnect(this.#audioSource);
    this.#audioSource = null;
    this.#howl?.unload();
    this.#howl = null;
  }

  // The previous Howl keeps its media element and decoded data alive briefly so the
  // incoming load never competes with a synchronous unload on mobile Chromium.
  #deferPreviousUnload(): void {
    const previous = this.#howl;
    if (!previous) return;

    this.#howl = null;
    this.#flushDeferredUnload();
    this.#pendingUnloadHowl = previous;
    this.#pendingUnloadTimer = window.setTimeout(() => {
      this.#pendingUnloadTimer = null;
      const howl = this.#pendingUnloadHowl;
      this.#pendingUnloadHowl = null;
      howl?.unload();
      logDebug('playback', 'Deferred stream unload completed');
    }, DEFERRED_UNLOAD_MS);
  }

  #flushDeferredUnload(): void {
    if (this.#pendingUnloadTimer !== null) {
      window.clearTimeout(this.#pendingUnloadTimer);
      this.#pendingUnloadTimer = null;
    }
    const howl = this.#pendingUnloadHowl;
    if (!howl) return;
    this.#pendingUnloadHowl = null;
    howl.unload();
    logDebug('playback', 'Deferred stream unloaded');
  }

  #activeMediaElement(): HTMLMediaElement | null {
    return (this.#howl as HowlWithSounds | null)?._sounds?.find(
      (sound) => sound._node instanceof HTMLMediaElement
    )?._node ?? null;
  }

  #connectAudioBus(): void {
    const mediaElement = this.#activeMediaElement();

    if (!mediaElement || this.#audioSource?.mediaElement === mediaElement) {
      return;
    }

    audioBusService.disconnect(this.#audioSource);
    this.#audioSource = audioBusService.connectHtmlMediaElement(mediaElement);
    if (this.#audioSource) this.#cancelFallbackRamp();
    audioBusService.setSourceGain(this.#audioSource, this.#transitionGain);
    this.#applyPitchPreservation();
    this.#applyOutputVolume();
  }

  #startPlayback(): void {
    const howl = this.#howl;
    if (!howl || !this.#loaded || this.#playPending || howl.playing()) return;

    this.#playPending = true;
    const soundId = howl.play();
    if (soundId === null) this.#playPending = false;
  }

  #applyPitchPreservation(): void {
    const mediaElement = this.#activeMediaElement();

    if (mediaElement) {
      mediaElement.preservesPitch = !this.#trueSpeed;
    }
  }

  #applyOutputVolume(): void {
    // Routed streams receive ReplayGain locally and master volume in the shared graph.
    // The multiplayer program branch splits before this gain.
    audioBusService.setSourceReplayGain(
      this.#audioSource,
      applyReplayGain(1, this.#replayGain, this.#replayGainMode, this.#replayGainPreampDb)
    );
    // Keep native Howler gain handling only for the progressive fallback path.
    this.#howl?.volume(this.#audioSource ? 1 : this.#fallbackVolume * this.#transitionGain);
  }

  #startTicking(): void {
    if (this.#tickTimer !== null) {
      return;
    }

    this.#tick();
  }

  #stopTicking(): void {
    if (this.#tickTimer === null) {
      return;
    }

    window.clearTimeout(this.#tickTimer);
    this.#tickTimer = null;
  }

  #tick(): void {
    this.#tickTimer = null;

    if (!this.#howl) {
      return;
    }

    const isPlaying = this.#howl.playing();

    if (!isPlaying) {
      if (this.#shouldTrackProgress) {
        this.#scheduleTick();
      }
      return;
    }

    const currentTime = Number(this.#howl.seek() ?? 0);
    const duration = this.#howl.duration();

    this.#publishProgress(false, currentTime, duration);
    this.#scheduleTick();
  }

  #scheduleTick(): void {
    this.#tickTimer = window.setTimeout(
      () => this.#tick(),
      PROGRESS_POLL_INTERVAL_MILLISECONDS
    );
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

  #rampFallbackVolume(target: number, durationSeconds: number): void {
    const howl = this.#howl;
    if (!howl) return;
    this.#cancelFallbackRamp();
    const startedAt = performance.now();
    const start = Number(howl.volume());
    const durationMilliseconds = Math.max(durationSeconds * 1000, 1);
    const tick = (now: number) => {
      if (!this.#howl) return;
      const progress = Math.min(Math.max((now - startedAt) / durationMilliseconds, 0), 1);
      const shapedProgress = 1 - (1 - progress) ** 2;
      this.#howl.volume(start + (target - start) * shapedProgress);
      if (progress < 1) this.#fallbackRampFrame = requestAnimationFrame(tick);
      else this.#fallbackRampFrame = null;
    };
    this.#fallbackRampFrame = requestAnimationFrame(tick);
  }

  #cancelFallbackRamp(): void {
    if (this.#fallbackRampFrame === null) return;
    cancelAnimationFrame(this.#fallbackRampFrame);
    this.#fallbackRampFrame = null;
  }

  #settlePendingLoad(error?: Error): void {
    const resolve = this.#pendingLoadResolve;
    const reject = this.#pendingLoadReject;
    this.#pendingLoadResolve = null;
    this.#pendingLoadReject = null;
    if (error) reject?.(error);
    else resolve?.();
  }
}
