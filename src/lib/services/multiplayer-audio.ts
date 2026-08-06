import { audioBusService } from '$lib/services/audio-bus';

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
  #remoteTrack: MediaStreamTrack | null = null;
  #onStatus: StatusHandler = () => undefined;

  getHostTrack(postRaf: boolean): MediaStreamTrack | null {
    return audioBusService.getBroadcastTrack(postRaf);
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
    // The same live track already feeds this pipeline: keep the element and just
    // refresh the status handler + resume. Tearing down and rebuilding on every
    // redundant `audio` message is what made streamed Freeplay stutter (the host
    // re-broadcasts availability on each 250 ms progress publish).
    if (this.#remoteTrack === track && this.#remoteElement) {
      if (!this.#remoteSource) {
        // Drained state (source-file interlude): the element stayed attached and
        // playing (muted, out of the graph) so the jitter buffer kept advancing.
        // Reconnect the WebAudio route on the SAME element — no teardown/creation
        // churn, so the next streamed track starts without a mid-stream glitch.
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
    this.#onStatus = onStatus;
    this.#remoteTrack = track;
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
    this.#publish(audible ? 'playing' : running && playing ? 'connecting' : 'blocked');
    return audible;
  }

  /**
   * Keeps the remote element attached and playing while the current track is
   * delivered as a source file, but disconnects the WebAudio route so nothing
   * is audible. A live consumer is what advances the receiver's jitter buffer:
   * without one, the playout freezes holding the previous streamed track's
   * tail, and the next streamed track replays it (~1 s of leftover audio).
   * The drained audio is silence (the sender stops or emits silence), so the
   * next `attachRemoteTrack` (which rebuilds because the route is gone) starts
   * clean.
   */
  drainRemoteTrack(): void {
    if (!this.#remoteElement || !this.#remoteTrack) return;
    audioBusService.disconnect(this.#remoteSource);
    this.#remoteSource = null;
    void this.#remoteElement.play().catch(() => undefined);
  }

  clearRemoteTrack(): void {
    if (this.#remoteTrack) {
      this.#remoteTrack.onmute = null;
      this.#remoteTrack.onunmute = null;
      this.#remoteTrack.onended = null;
    }
    audioBusService.disconnect(this.#remoteSource);
    if (this.#remoteElement) {
      this.#remoteElement.pause();
      this.#remoteElement.srcObject = null;
      this.#remoteElement.removeAttribute('src');
      this.#remoteElement.load();
      this.#remoteElement.remove();
    }
    this.#remoteElement = null;
    this.#remoteSource = null;
    this.#remoteTrack = null;
    this.#publish('idle');
    this.#onStatus = () => undefined;
  }

  #publish(status: MultiplayerReceiverAudioStatus): void {
    this.#onStatus(status);
  }
}

export const multiplayerAudioService = new MultiplayerAudioService();
