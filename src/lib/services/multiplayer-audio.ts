import { audioBusService } from '$lib/services/audio-bus';
import { logDebug, logInfo, logWarning } from '$lib/services/logging';

export type MultiplayerReceiverAudioStatus =
  | 'idle'
  | 'connecting'
  | 'playing'
  | 'blocked'
  | 'unavailable';

type StatusHandler = (status: MultiplayerReceiverAudioStatus) => void;

export class MultiplayerAudioService {
  #remoteElement: HTMLAudioElement | null = null;
  #remoteSource: MediaStreamAudioSourceNode | null = null;
  #remoteStream: MediaStream | null = null;
  #remoteTrack: MediaStreamTrack | null = null;
  #onStatus: StatusHandler = () => undefined;

  getHostTrack(postRaf: boolean): MediaStreamTrack | null {
    return audioBusService.getBroadcastTrack(postRaf);
  }

  /** Position of the remote element's playout (ms) — the receiver's emitted timeline. */
  get remoteElementPositionMs(): number {
    return this.#remoteElement ? this.#remoteElement.currentTime * 1000 : 0;
  }

  setHostAudible(audible: boolean): void {
    audioBusService.setBroadcastGain(audible ? 1 : 0);
  }

  releaseHostTrack(): void {
    audioBusService.releaseBroadcastTrack();
  }

  async attachRemoteTrack(
    track: MediaStreamTrack,
    stream: MediaStream,
    onStatus: StatusHandler
  ): Promise<void> {
    // Same live track already feeds this pipeline: keep the element and just
    // refresh the status handler + resume. Tearing down and rebuilding on every
    // redundant `audio` message is what made streamed Freeplay stutter.
    if (this.#remoteTrack === track && this.#remoteElement) {
      if (!this.#remoteSource) {
        // Route previously disconnected (e.g. unavailable attach): reconnect the
        // WebAudio route on the SAME element — no teardown/creation churn.
        logDebug('multiplayer', 'Reconnecting remote audio route on existing element');
        this.#remoteStream = stream;
        this.#remoteSource = audioBusService.connectMediaStream(stream);
        if (!this.#remoteSource) {
          this.#publish('unavailable');
          return;
        }
        track.onmute = () => this.#publish('connecting');
        track.onunmute = () => void this.resumeRemoteAudio();
        track.onended = () => this.#publish('unavailable');
      }
      this.#onStatus = onStatus;
      await this.resumeRemoteAudio();
      return;
    }
    this.clearRemoteTrack();
    logInfo('multiplayer', 'Remote audio pipeline built (new track)');
    this.#onStatus = onStatus;
    this.#remoteTrack = track;
    this.#remoteStream = stream;
    const element = new Audio();
    element.autoplay = true;
    element.muted = true;
    element.preload = 'auto';
    element.srcObject = stream;
    element.setAttribute('playsinline', '');
    element.setAttribute('aria-hidden', 'true');
    element.style.position = 'fixed';
    element.style.width = '1px';
    element.style.height = '1px';
    element.style.opacity = '0';
    element.style.pointerEvents = 'none';
    document.body?.appendChild(element);
    this.#remoteElement = element;
    // The sender's post-Raf flag describes the transmitted signal; it must not
    // take control of the listener's rack. Always enter through the local Raf
    // input so each listener can independently enable or bypass their effects.
    this.#remoteSource = audioBusService.connectMediaStream(stream);

    if (!this.#remoteSource) {
      this.#publish('unavailable');
      return;
    }

    track.onmute = () => this.#publish('connecting');
    track.onunmute = () => void this.resumeRemoteAudio();
    track.onended = () => this.#publish('unavailable');
    this.#publish('connecting');
    await this.resumeRemoteAudio();
  }

  /**
   * Attaches the remote track to a FRESH element that stays out of the audible
   * graph (muted, no route) but is PLAYING — it is the receiver's sink, which
   * is what lets NetEq's delay management run and build the jitter-buffer
   * level toward the target while nothing is heard. The caller drives the
   * phases and calls `connectRemoteRoute()` to make playback audible. Unlike
   * `attachRemoteTrack`, this never reports 'playing' — the caller reports
   * readiness once the cushion is built.
   */
  async attachRemoteTrackPrerolled(
    track: MediaStreamTrack,
    stream: MediaStream,
    onStatus: StatusHandler
  ): Promise<boolean> {
    if (this.#remoteTrack === track && this.#remoteElement) {
      // Redundant attach of the same live track: the element is already the
      // preroll sink. Just refresh the status handler and keep playing.
      this.#onStatus = onStatus;
      this.#remoteStream = stream;
      await this.#remoteElement.play().catch(() => undefined);
      return true;
    }
    this.clearRemoteTrack();
    logDebug('multiplayer', 'Remote audio preroll element built (muted sink)');
    this.#onStatus = onStatus;
    this.#remoteTrack = track;
    this.#remoteStream = stream;
    const element = new Audio();
    element.autoplay = true;
    element.muted = true;
    element.preload = 'auto';
    element.srcObject = stream;
    element.setAttribute('playsinline', '');
    element.setAttribute('aria-hidden', 'true');
    element.style.position = 'fixed';
    element.style.width = '1px';
    element.style.height = '1px';
    element.style.opacity = '0';
    element.style.pointerEvents = 'none';
    document.body?.appendChild(element);
    this.#remoteElement = element;
    // Connect the audible route NOW, muted (gain 0): the AudioContext and the
    // MediaStreamAudioSourceNode warm up and sync to the live track DURING the
    // preroll; making it audible later is just a gain ramp (connectRemoteRoute).
    // A cold route garbles/stretches the first ~1-3 s even with a perfect cushion.
    this.#remoteSource = audioBusService.connectMediaStreamSilent(stream);
    if (!this.#remoteSource) {
      this.#publish('unavailable');
      return false;
    }
    // AWAITED (not fire-and-forget): the muted route only warms the source node
    // while the AudioContext is actually RUNNING — a suspended context pulls
    // nothing. The preroll runs from a data-channel message, not a gesture, so
    // this can fail under the autoplay policy; the gesture-origin command/join
    // handlers (sendCommand) are the reliable warm-up.
    const contextRunning = await audioBusService.resume();
    if (!contextRunning) {
      logWarning('multiplayer', 'Remote preroll AudioContext not running', {
        state: safeContextState()
      });
    }
    track.onmute = () => this.#publish('connecting');
    track.onunmute = () => void this.resumeRemoteAudio();
    track.onended = () => this.#publish('unavailable');
    this.#publish('connecting');
    await this.#remoteElement.play().catch(() => {
      logWarning('multiplayer', 'Remote preroll element play failed (autoplay policy)');
    });
    return true;
  }

  /**
   * Makes the prerolled element audible: ramps the route's bus gain from 0
   * (the route was connected muted during the preroll, so the graph is warm)
   * and resumes. No-op when nothing is prerolled.
   */
  async connectRemoteRoute(): Promise<boolean> {
    if (!this.#remoteElement || !this.#remoteTrack || !this.#remoteStream) {
      return false;
    }
    if (!this.#remoteSource) {
      // Defensive fallback: a drained/rebuilt pipeline can reach the route without
      // a muted connect. Connect SILENT (gain 0) and ramp below — an audible cold
      // connect is the same garbled-start regression.
      this.#remoteSource = audioBusService.connectMediaStreamSilent(this.#remoteStream);
      if (!this.#remoteSource) {
        this.#publish('unavailable');
        return false;
      }
    }
    audioBusService.setMediaStreamSourceGain(this.#remoteSource, 1);
    logDebug('multiplayer', 'Remote audio route connected (audible)', {
      contextState: safeContextState()
    });
    return this.resumeRemoteAudio();
  }

  async resumeRemoteAudio(): Promise<boolean> {
    if (!this.#remoteElement || !this.#remoteSource || !this.#remoteTrack
      || this.#remoteTrack.readyState === 'ended') {
      this.#publish('unavailable');
      return false;
    }

    const [running, playing] = await Promise.all([
      audioBusService.resume(),
      this.#remoteElement.play().then(() => true).catch(() => false)
    ]);
    const audible = running && playing && !this.#remoteTrack.muted;
    logDebug('multiplayer', 'Remote audio resume', { audible });
    this.#publish(audible ? 'playing' : running && playing ? 'connecting' : 'blocked');
    return audible;
  }

  /**
   * Keeps the remote element attached and playing (muted, out of the graph)
   * while the current track is delivered as a source file. The element is the
   * receiver's only sink: without one the playout freezes holding the previous
   * streamed track's tail, which the next streamed track would replay. With
   * the host's silence anchor, the buffer advances through silence instead.
   */
  drainRemoteTrack(): void {
    if (!this.#remoteElement || !this.#remoteTrack) return;
    logDebug('multiplayer', 'Remote element drained (silent sink for interlude)');
    audioBusService.disconnect(this.#remoteSource);
    this.#remoteSource = null;
    void this.#remoteElement.play().catch(() => undefined);
  }

  clearRemoteTrack(): void {
    logDebug('multiplayer', 'Remote audio pipeline cleared');
    if (this.#remoteTrack) {
      this.#remoteTrack.onmute = null;
      this.#remoteTrack.onunmute = null;
      this.#remoteTrack.onended = null;
    }
    if (this.#remoteSource) audioBusService.disconnect(this.#remoteSource);
    if (this.#remoteElement) {
      this.#remoteElement.pause();
      this.#remoteElement.srcObject = null;
      this.#remoteElement.removeAttribute('src');
      this.#remoteElement.load();
      this.#remoteElement.remove();
    }
    this.#remoteElement = null;
    this.#remoteSource = null;
    this.#remoteStream = null;
    this.#remoteTrack = null;
    this.#publish('idle');
    this.#onStatus = () => undefined;
  }

  #publish(status: MultiplayerReceiverAudioStatus): void {
    this.#onStatus(status);
  }
}

export const multiplayerAudioService = new MultiplayerAudioService();

/**
 * Reads the shared AudioContext state without letting the bus's graph-ensuring
 * getter throw (it can while the graph is still coming up). Diagnostics around
 * the preroll/route only, never control flow.
 */
function safeContextState(): string | null {
  try {
    return audioBusService.context?.state ?? null;
  } catch {
    return null;
  }
}
