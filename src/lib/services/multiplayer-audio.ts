import { audioBusService } from '$lib/services/audio-bus';
import { logDebug, logInfo } from '$lib/services/logging';

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
  #remoteAudible = false;
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
  ): Promise<boolean> {
    if (this.#remoteTrack === track && track.readyState !== 'ended') {
      this.#onStatus = onStatus;
      return this.resumeRemoteAudio();
    }
    this.clearRemoteTrack();
    logInfo('multiplayer', 'Remote audio track attached', { trackId: track.id, muted: track.muted });
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
      return false;
    }
    audioBusService.setSourceGain(this.#remoteSource, 0);

    track.onmute = () => this.#publish('connecting');
    track.onunmute = () => void this.resumeRemoteAudio();
    track.onended = () => this.#publish('unavailable');
    this.#publish('connecting');
    return this.resumeRemoteAudio();
  }

  setRemoteAudible(audible: boolean, rampSeconds = 0.04): void {
    if (this.#remoteAudible === audible) return;
    this.#remoteAudible = audible;
    audioBusService.setSourceGain(this.#remoteSource, audible ? 1 : 0, rampSeconds);
    if (audible) void this.resumeRemoteAudio();
  }

  warmRemoteAudio(): Promise<boolean> {
    return audioBusService.resume();
  }

  async resumeRemoteAudio(): Promise<boolean> {
    const element = this.#remoteElement;
    const source = this.#remoteSource;
    const track = this.#remoteTrack;
    if (!element || !source || !track || track.readyState === 'ended') {
      this.#publish('unavailable');
      return false;
    }

    const [running, playing] = await Promise.all([
      audioBusService.resume(),
      element.play().then(() => true).catch(() => false)
    ]);
    if (this.#remoteElement !== element || this.#remoteSource !== source || this.#remoteTrack !== track) {
      return false;
    }
    const audible = running && playing && !track.muted && this.#remoteAudible;
    logDebug('multiplayer', 'Remote audio resume attempted', { running, playing, muted: track.muted, audible });
    this.#publish(audible ? 'playing' : running && playing ? 'connecting' : 'blocked');
    return running && playing;
  }

  clearRemoteTrack(): void {
    if (this.#remoteTrack) logDebug('multiplayer', 'Remote audio track cleared', { trackId: this.#remoteTrack.id });
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
    this.#remoteAudible = false;
    this.#publish('idle');
    this.#onStatus = () => undefined;
  }

  #publish(status: MultiplayerReceiverAudioStatus): void {
    this.#onStatus(status);
  }
}

export const multiplayerAudioService = new MultiplayerAudioService();
