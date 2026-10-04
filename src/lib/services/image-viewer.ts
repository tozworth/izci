import type { TrackItem, TrackMetadata } from '$lib/types';

type SnapshotHandler = (snapshot: { state: 'loading' | 'ready' | 'error'; error?: string }) => void;
type MetadataHandler = (metadata: TrackMetadata) => void;

export class ImageViewerService {
  #element: HTMLImageElement | null = null;
  #loadToken = 0;
  #settlePendingLoad: (() => void) | null = null;
  #onSnapshot: SnapshotHandler;
  #onMetadata: MetadataHandler;

  constructor(onSnapshot: SnapshotHandler, onMetadata: MetadataHandler) {
    this.#onSnapshot = onSnapshot;
    this.#onMetadata = onMetadata;
  }

  get element(): HTMLImageElement | null {
    return this.#element;
  }

  load(track: TrackItem): Promise<void> {
    if (!track.objectUrl) {
      return Promise.reject(new Error('Expected an object URL for image display.'));
    }

    this.unload();
    const loadToken = ++this.#loadToken;
    const element = new Image();
    this.#element = element;
    element.alt = '';
    element.decoding = 'async';
    element.draggable = false;
    this.#onSnapshot({
      state: 'loading',
      error: undefined
    });

    return new Promise((resolve, reject) => {
      this.#settlePendingLoad = resolve;
      element.addEventListener('load', () => {
        if (loadToken !== this.#loadToken || this.#element !== element) return;
        this.#settlePendingLoad = null;
        this.#onMetadata({ width: element.naturalWidth, height: element.naturalHeight });
        this.#onSnapshot({ state: 'ready', error: undefined });
        resolve();
      }, { once: true });
      element.addEventListener('error', () => {
        if (loadToken !== this.#loadToken || this.#element !== element) return;
        this.#settlePendingLoad = null;
        const error = 'Chromium could not decode this image.';
        this.#onSnapshot({ state: 'error', error });
        reject(new Error(error));
      }, { once: true });
      element.src = track.objectUrl!;
    });
  }

  unload(): void {
    this.#loadToken += 1;
    this.#settlePendingLoad?.();
    this.#settlePendingLoad = null;
    if (this.#element) {
      this.#element.removeAttribute('src');
      this.#element.remove();
      this.#element = null;
    }
  }
}
