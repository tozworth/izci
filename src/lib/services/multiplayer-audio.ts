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
  #remoteSource: MediaElementAudioSourceNode | null = null;
  #remoteTrack: MediaStreamTrack | null = null;
  #onStatus: StatusHandler = () => undefined;

  getHostTrack(): MediaStreamTrack | null {
    return audioBusService.getBroadcastTrack();
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
    this.clearRemoteTrack();
    this.#onStatus = onStatus;
    this.#remoteTrack = track;
    const element = new Audio();
    element.autoplay = true;
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
    this.#remoteSource = audioBusService.connectHtmlMediaElementAfterRaf(element);

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
