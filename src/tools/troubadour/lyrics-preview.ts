import { writable, type Readable } from 'svelte/store';

export interface LyricsPreviewState {
  currentTime: number;
  duration: number;
  playing: boolean;
  ready: boolean;
  error: string;
}

const EMPTY_STATE: LyricsPreviewState = {
  currentTime: 0,
  duration: 0,
  playing: false,
  ready: false,
  error: ''
};

export function createLyricsPreview(): Readable<LyricsPreviewState> & {
  setFile(file: File | null): void;
  togglePlayback(): Promise<void>;
  pause(): void;
  seek(position: number): void;
  getCurrentTime(): number;
  destroy(): void;
} {
  const audio = new Audio();
  const store = writable<LyricsPreviewState>(EMPTY_STATE);
  let state = EMPTY_STATE;
  let objectUrl = '';
  let animationFrame = 0;
  store.subscribe((value) => (state = value));

  const publish = (patch: Partial<LyricsPreviewState>) => {
    state = { ...state, ...patch };
    store.set(state);
  };
  const stopClock = () => cancelAnimationFrame(animationFrame);
  const tick = () => {
    publish({ currentTime: audio.currentTime });
    if (!audio.paused) animationFrame = requestAnimationFrame(tick);
  };
  const handleMetadata = () => publish({
    currentTime: audio.currentTime,
    duration: Number.isFinite(audio.duration) ? audio.duration : 0,
    ready: audio.readyState >= HTMLMediaElement.HAVE_METADATA,
    error: ''
  });
  const handlePlay = () => {
    stopClock();
    publish({ playing: true, error: '' });
    animationFrame = requestAnimationFrame(tick);
  };
  const handlePause = () => {
    stopClock();
    publish({ currentTime: audio.currentTime, playing: false });
  };
  const handleError = () => {
    stopClock();
    publish({ playing: false, ready: false, error: 'This track cannot be previewed by the browser.' });
  };

  audio.preload = 'metadata';
  audio.addEventListener('loadedmetadata', handleMetadata);
  audio.addEventListener('durationchange', handleMetadata);
  audio.addEventListener('play', handlePlay);
  audio.addEventListener('pause', handlePause);
  audio.addEventListener('ended', handlePause);
  audio.addEventListener('error', handleError);

  return {
    subscribe: store.subscribe,
    setFile(file) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = file ? URL.createObjectURL(file) : '';
      store.set(EMPTY_STATE);
      state = EMPTY_STATE;
      if (objectUrl) {
        audio.src = objectUrl;
        audio.load();
      }
    },
    async togglePlayback() {
      if (!objectUrl) return;
      if (!audio.paused) {
        audio.pause();
        return;
      }
      if (audio.duration && audio.currentTime >= audio.duration - 0.001) audio.currentTime = 0;
      try {
        await audio.play();
      } catch (error) {
        if ((error as DOMException)?.name !== 'AbortError') {
          publish({ error: error instanceof Error ? error.message : 'Playback could not start.' });
        }
      }
    },
    pause: () => audio.pause(),
    seek(position) {
      if (!objectUrl) return;
      const duration = Number.isFinite(audio.duration) ? audio.duration : state.duration;
      audio.currentTime = Math.max(0, Math.min(position, duration || Number.POSITIVE_INFINITY));
      publish({ currentTime: audio.currentTime });
    },
    getCurrentTime: () => audio.currentTime,
    destroy() {
      stopClock();
      audio.pause();
      audio.removeEventListener('loadedmetadata', handleMetadata);
      audio.removeEventListener('durationchange', handleMetadata);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handlePause);
      audio.removeEventListener('error', handleError);
      audio.removeAttribute('src');
      audio.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  };
}
