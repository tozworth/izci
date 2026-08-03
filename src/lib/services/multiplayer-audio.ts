import { audioBusService } from '$lib/services/audio-bus';

export type MultiplayerReceiverAudioStatus =
  | 'idle'
  | 'connecting'
  | 'playing'
  | 'blocked'
  | 'unavailable';

type StatusHandler = (status: MultiplayerReceiverAudioStatus) => void;

export class MultiplayerAudioService {
  #remoteSource: MediaStreamAudioSourceNode | null = null;
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
    this.#remoteSource = audioBusService.connectMediaStreamAfterRaf(stream);

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
    if (!this.#remoteSource || !this.#remoteTrack || this.#remoteTrack.readyState === 'ended') {
      this.#publish('unavailable');
      return false;
    }

    const running = await audioBusService.resume();
    this.#publish(running ? 'playing' : 'blocked');
    return running;
  }

  clearRemoteTrack(): void {
    if (this.#remoteTrack) {
      this.#remoteTrack.onmute = null;
      this.#remoteTrack.onunmute = null;
      this.#remoteTrack.onended = null;
    }
    audioBusService.disconnect(this.#remoteSource);
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
