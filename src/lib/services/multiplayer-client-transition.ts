import type {
  MultiplayerDeliveryState,
  MultiplayerPlayback,
  MultiplayerPlaybackPreparation
} from './multiplayer-protocol';

/**
 * Owns generation-scoped source-file readiness. Buffered Opus readiness is
 * reported by the render playback service through render.ready.
 */
export class MultiplayerClientTransition {
  #delivery: MultiplayerDeliveryState | null = null;
  #playbackTrackId: string | null = null;
  #preparation: MultiplayerPlaybackPreparation | null = null;
  #sourceReady: { generationId: string; trackId: string } | null = null;
  #receiveAudio = true;
  #readySent = false;

  setReceiveAudio(enabled: boolean): void {
    this.#receiveAudio = enabled;
  }

  beginDelivery(delivery: MultiplayerDeliveryState): boolean | null {
    if (this.#delivery?.generationId === delivery.generationId) {
      return this.#delivery.trackId === delivery.trackId
        && this.#delivery.mode === delivery.mode
        && this.#delivery.reason === delivery.reason
        ? false
        : null;
    }
    this.#delivery = delivery;
    this.#playbackTrackId = null;
    this.#preparation = null;
    this.#sourceReady = null;
    this.#readySent = false;
    return true;
  }

  acceptPlayback(playback: MultiplayerPlayback): boolean {
    if (!this.#delivery || playback.generationId !== this.#delivery.generationId) return false;
    const trackId = playback.track?.id ?? null;
    if (trackId !== this.#delivery.trackId) return false;
    this.#playbackTrackId = trackId;
    return true;
  }

  acceptPreparation(preparation: MultiplayerPlaybackPreparation): boolean {
    const delivery = this.#delivery;
    if (!delivery
      || preparation.generationId !== delivery.generationId
      || preparation.trackId !== delivery.trackId
      || preparation.delivery !== delivery.mode) return false;
    this.#preparation = preparation;
    this.#readySent = false;
    return true;
  }

  setSourceReady(generationId: string, trackId: string, ready: boolean): boolean {
    if (!this.isCurrent(generationId, trackId, 'source-file')) return false;
    this.#sourceReady = ready ? { generationId, trackId } : null;
    return true;
  }

  takeReadyGeneration(): string | null {
    const preparation = this.#preparation;
    if (!preparation || this.#readySent || this.#playbackTrackId !== preparation.trackId) return null;
    const ready = !this.#receiveAudio
      || preparation.delivery === 'none'
      || (preparation.delivery === 'source-file'
        && this.#sourceReady?.generationId === preparation.generationId
        && this.#sourceReady.trackId === preparation.trackId);
    if (!ready) return null;
    this.#readySent = true;
    return preparation.generationId;
  }

  isCurrent(
    generationId: string,
    trackId: string | null,
    delivery?: MultiplayerDeliveryState['mode']
  ): boolean {
    return this.#delivery?.generationId === generationId
      && this.#delivery.trackId === trackId
      && (delivery === undefined || this.#delivery.mode === delivery);
  }

  reset(): void {
    this.#delivery = null;
    this.#playbackTrackId = null;
    this.#preparation = null;
    this.#sourceReady = null;
    this.#readySent = false;
  }
}
