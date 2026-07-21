import { setAudioParam } from '$lib/services/raf-effects/shared';
import type { StemPeakPoint, StemPlaybackAsset } from '$lib/services/stem-separation/types';

export interface StemMixGains {
  original: number;
  vocal: number;
}

export function getStemMixGains(value: number): StemMixGains {
  const mix = Math.min(Math.max(Number.isFinite(value) ? value : 0, -1), 1);
  return mix <= 0 ? { original: 1, vocal: mix } : { original: 1 - mix, vocal: mix };
}

export function interpolateStemPeakGain(table: StemPeakPoint[], value: number): number {
  if (table.length === 0) {
    return 1;
  }

  const mix = Math.min(Math.max(Number.isFinite(value) ? value : 0, -1), 1);
  const points = [...table].sort((left, right) => left.mix - right.mix);

  if (mix <= points[0].mix) return points[0].gain;
  if (mix >= points[points.length - 1].mix) return points[points.length - 1].gain;

  for (let index = 1; index < points.length; index += 1) {
    const right = points[index];
    const left = points[index - 1];
    if (mix <= right.mix) {
      const fraction = (mix - left.mix) / (right.mix - left.mix);
      return left.gain + (right.gain - left.gain) * fraction;
    }
  }

  return 1;
}

interface AudioBusRouting {
  context: AudioContext;
  adoptHtmlMediaElement(element: HTMLMediaElement | null): MediaElementAudioSourceNode | null;
  connectAudioNode(node: AudioNode | null): AudioNode | null;
  disconnect(source: AudioNode | MediaElementAudioSourceNode | null): void;
}

export class StemPlaybackService {
  #bus: AudioBusRouting;
  #originalElement: HTMLMediaElement | null = null;
  #vocalElement: HTMLAudioElement | null = null;
  #originalSource: MediaElementAudioSourceNode | null = null;
  #vocalSource: MediaElementAudioSourceNode | null = null;
  #originalGain: GainNode | null = null;
  #vocalGain: GainNode | null = null;
  #headroomGain: GainNode | null = null;
  #output: GainNode | null = null;
  #asset: StemPlaybackAsset | null = null;
  #mix = 0;
  #cleanupListeners: Array<() => void> = [];

  constructor(bus: AudioBusRouting) {
    this.#bus = bus;
  }

  attach(originalElement: HTMLMediaElement, asset: StemPlaybackAsset): boolean {
    this.destroy();
    const originalSource = this.#bus.adoptHtmlMediaElement(originalElement);
    if (!originalSource) return false;

    const vocalElement = new Audio(asset.url);
    vocalElement.preload = 'auto';
    vocalElement.loop = originalElement.loop;
    vocalElement.playbackRate = originalElement.playbackRate;
    const vocalSource = this.#bus.adoptHtmlMediaElement(vocalElement);
    if (!vocalSource) return false;

    const context = this.#bus.context;
    const originalGain = context.createGain();
    const vocalGain = context.createGain();
    const headroomGain = context.createGain();
    const output = context.createGain();
    this.#originalElement = originalElement;
    this.#vocalElement = vocalElement;
    this.#originalSource = originalSource;
    this.#vocalSource = vocalSource;
    this.#originalGain = originalGain;
    this.#vocalGain = vocalGain;
    this.#headroomGain = headroomGain;
    this.#output = output;
    this.#asset = asset;
    try {
      originalSource.connect(originalGain);
      vocalSource.connect(vocalGain);
      originalGain.connect(headroomGain);
      vocalGain.connect(headroomGain);
      headroomGain.connect(output);
      if (!this.#bus.connectAudioNode(output)) throw new Error('The stem mixer could not reach the audio bus.');
      this.#bindTransport();
      this.setMix(this.#mix);
      this.#synchronize(true);
      return true;
    } catch {
      this.destroy();
      return false;
    }
  }

  setMix(value: number): void {
    this.#mix = Math.min(Math.max(Number.isFinite(value) ? value : 0, -1), 1);
    if (!this.#originalGain || !this.#vocalGain || !this.#headroomGain) return;

    const context = this.#bus.context;
    const gains = getStemMixGains(this.#mix);
    setAudioParam(this.#originalGain.gain, gains.original, context, 0.03);
    setAudioParam(this.#vocalGain.gain, gains.vocal, context, 0.03);
    setAudioParam(
      this.#headroomGain.gain,
      interpolateStemPeakGain(this.#asset?.peakTable ?? [], this.#mix),
      context,
      0.03
    );
  }

  destroy(): void {
    for (const cleanup of this.#cleanupListeners.splice(0)) cleanup();
    this.#vocalElement?.pause();
    this.#vocalElement?.removeAttribute('src');
    this.#vocalElement?.load();
    this.#bus.disconnect(this.#output);

    for (const node of [
      this.#originalSource,
      this.#vocalSource,
      this.#originalGain,
      this.#vocalGain,
      this.#headroomGain,
      this.#output
    ]) {
      try {
        node?.disconnect();
      } catch {
        // The media owner may already have torn down its half of the graph.
      }
    }

    this.#originalElement = null;
    this.#vocalElement = null;
    this.#originalSource = null;
    this.#vocalSource = null;
    this.#originalGain = null;
    this.#vocalGain = null;
    this.#headroomGain = null;
    this.#output = null;
    this.#asset = null;
  }

  #bindTransport(): void {
    const original = this.#originalElement;
    if (!original) return;

    const listen = (type: string, handler: EventListener) => {
      original.addEventListener(type, handler);
      this.#cleanupListeners.push(() => original.removeEventListener(type, handler));
    };

    listen('play', () => this.#synchronize(true));
    listen('pause', () => this.#vocalElement?.pause());
    listen('seeking', () => this.#synchronize(false));
    listen('seeked', () => this.#synchronize(!original.paused));
    listen('ratechange', () => {
      if (this.#vocalElement) this.#vocalElement.playbackRate = original.playbackRate;
    });
    listen('timeupdate', () => this.#synchronize(false));
    listen('ended', () => this.#vocalElement?.pause());
  }

  #synchronize(play: boolean): void {
    const original = this.#originalElement;
    const vocal = this.#vocalElement;
    if (!original || !vocal) return;

    if (Math.abs(vocal.currentTime - original.currentTime) > 0.045) {
      try {
        vocal.currentTime = original.currentTime;
      } catch {
        return;
      }
    }

    if (play && !original.paused) {
      void vocal.play().catch(() => undefined);
    }
  }
}
