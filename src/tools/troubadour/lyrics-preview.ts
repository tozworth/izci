import { writable, type Readable } from 'svelte/store';
import { createChiptunePlayer } from '$lib/services/chiptune-loader';
import { MODULE_EXTENSIONS, type TrackKind } from '$lib/types';
import type { ChiptuneJsPlayer } from 'chiptune3';

type PreviewBackend = 'stream' | 'module';

export interface LyricsPreviewState {
  currentTime: number;
  duration: number;
  playing: boolean;
  ready: boolean;
  /** i18n error code: 'unsupported' when the format has no preview backend, 'decode' on failure. */
  error: '' | 'unsupported' | 'decode';
}

interface LyricsPreviewController {
  setFile(file: File | null, kind: TrackKind | null): void;
}

/** Swaps the previewed file only when the selected item changed. */
export function syncLyricsFile(
  preview: LyricsPreviewController,
  file: File | null,
  kind: TrackKind | null,
  previousFile: File | null,
  previousKind: TrackKind | null
): File | null {
  if (file === previousFile && kind === previousKind) return previousFile;
  preview.setFile(file, kind);
  return file;
}

const EMPTY_STATE: LyricsPreviewState = {
  currentTime: 0,
  duration: 0,
  playing: false,
  ready: false,
  error: ''
};

export function isPreviewableKind(kind: TrackKind | null | undefined): boolean {
  return kind === 'stream' || kind === 'module';
}

export function previewBackendFor(extension: string): PreviewBackend | null {
  const normalized = extension.toLowerCase();
  if ((MODULE_EXTENSIONS as readonly string[]).includes(normalized)) {
    // Hively modules (ahx/hvl) have no in-window player; everything else renders via libopenmpt.
    return normalized === 'ahx' || normalized === 'hvl' ? null : 'module';
  }
  return 'stream';
}

export function createLyricsPreview(): Readable<LyricsPreviewState> & {
  setFile(file: File | null, kind: TrackKind | null): void;
  togglePlayback(): Promise<void>;
  pause(): void;
  seek(position: number): void;
  getCurrentTime(): number;
  destroy(): void;
} {
  const store = writable<LyricsPreviewState>(EMPTY_STATE);
  let state = EMPTY_STATE;
  store.subscribe((value) => (state = value));

  const audio = new Audio();
  let objectUrl = '';
  let audioClock = 0;

  let modulePlayer: ChiptuneJsPlayer | null = null;
  let moduleBuffer: ArrayBuffer | null = null;
  let moduleLoadToken = 0;
  let modulePlaying = false;
  let moduleStarted = false;
  let moduleCurrentTime = 0;
  let moduleDuration = 0;
  let backend: PreviewBackend | null = null;

  const publish = (patch: Partial<LyricsPreviewState>) => {
    state = { ...state, ...patch };
    store.set(state);
  };

  const stopAudioClock = () => cancelAnimationFrame(audioClock);
  const tick = () => {
    publish({ currentTime: audio.currentTime });
    if (!audio.paused) audioClock = requestAnimationFrame(tick);
  };

  const disposeModulePlayer = () => {
    const player = modulePlayer;
    modulePlayer = null;
    moduleBuffer = null;
    modulePlaying = false;
    moduleStarted = false;
    if (!player) return;
    try {
      player.stop();
    } catch {
      // Ignore teardown failures.
    }
    try {
      player.gain.disconnect();
    } catch {
      // Ignore disconnect failures during teardown.
    }
    void player.context.close().catch(() => undefined);
  };

  const handleAudioMetadata = () => publish({
    currentTime: audio.currentTime,
    duration: Number.isFinite(audio.duration) ? audio.duration : 0,
    ready: audio.readyState >= HTMLMediaElement.HAVE_METADATA,
    error: ''
  });
  const handleAudioPlay = () => {
    stopAudioClock();
    publish({ playing: true, error: '' });
    audioClock = requestAnimationFrame(tick);
  };
  const handleAudioPause = () => {
    stopAudioClock();
    publish({ currentTime: audio.currentTime, playing: false });
  };
  const handleAudioError = () => {
    stopAudioClock();
    publish({ playing: false, ready: false, error: 'decode' });
  };
  audio.preload = 'metadata';
  audio.addEventListener('loadedmetadata', handleAudioMetadata);
  audio.addEventListener('durationchange', handleAudioMetadata);
  audio.addEventListener('play', handleAudioPlay);
  audio.addEventListener('pause', handleAudioPause);
  audio.addEventListener('ended', handleAudioPause);
  audio.addEventListener('error', handleAudioError);

  const detachAudio = () => {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = '';
  };

  const loadModule = async (file: File, loadToken: number) => {
    publish({ ...EMPTY_STATE });
    let buffer: ArrayBuffer;
    try {
      buffer = await file.arrayBuffer();
    } catch {
      if (loadToken === moduleLoadToken) publish({ error: 'decode' });
      return;
    }
    if (loadToken !== moduleLoadToken) return;
    let player: ChiptuneJsPlayer;
    try {
      player = await createChiptunePlayer({ repeatCount: 0 });
    } catch {
      if (loadToken === moduleLoadToken) publish({ error: 'decode' });
      return;
    }
    if (loadToken !== moduleLoadToken) {
      try {
        player.stop();
      } catch {
        // Ignore teardown failures.
      }
      void player.context.close().catch(() => undefined);
      return;
    }
    modulePlayer = player;
    moduleBuffer = buffer;
    player.setVol(1);
    player.onEnded(() => {
      if (player !== modulePlayer) return;
      modulePlaying = false;
      moduleStarted = false;
      moduleCurrentTime = moduleDuration;
      publish({ currentTime: moduleCurrentTime, duration: moduleDuration, playing: false });
    });
    player.onError(() => {
      if (player !== modulePlayer) return;
      modulePlaying = false;
      moduleStarted = false;
      publish({ playing: false, ready: false, error: 'decode' });
    });
    player.onMetadata((metadata) => {
      if (player !== modulePlayer) return;
      const duration = typeof metadata.dur === 'number' && Number.isFinite(metadata.dur)
        ? (metadata.dur > 1000 ? metadata.dur / 1000 : metadata.dur)
        : 0;
      moduleDuration = duration;
      publish({ duration, ready: true, error: '' });
    });
    player.onProgress((progress) => {
      if (player !== modulePlayer || !modulePlaying) return;
      moduleCurrentTime = typeof progress.pos === 'number' && progress.pos > 1000
        ? progress.pos / 1000
        : progress.pos;
      publish({ currentTime: moduleCurrentTime });
    });
  };

  const playModule = async () => {
    const player = modulePlayer;
    if (!player || !moduleBuffer) return;
    try {
      if (player.context.state === 'suspended') await player.context.resume();
    } catch {
      // Autoplay policies surface as a decode error only when play itself fails.
    }
    if (!moduleStarted) {
      player.play(moduleBuffer);
      moduleStarted = true;
      modulePlaying = true;
    } else if (!modulePlaying) {
      player.unpause();
      modulePlaying = true;
    } else {
      return;
    }
    publish({ playing: true, error: '' });
  };

  return {
    subscribe: store.subscribe,
    setFile(file, kind) {
      moduleLoadToken += 1;
      const loadToken = moduleLoadToken;
      disposeModulePlayer();
      detachAudio();
      stopAudioClock();
      moduleCurrentTime = 0;
      moduleDuration = 0;
      if (!file || !kind) {
        backend = null;
        store.set(EMPTY_STATE);
        state = EMPTY_STATE;
        return;
      }
      backend = previewBackendFor(file.name.split('.').pop() ?? '');
      if (backend === 'module') {
        store.set(EMPTY_STATE);
        state = EMPTY_STATE;
        void loadModule(file, loadToken);
        return;
      }
      if (backend === 'stream') {
        objectUrl = URL.createObjectURL(file);
        audio.src = objectUrl;
        audio.load();
        store.set(EMPTY_STATE);
        state = EMPTY_STATE;
        return;
      }
      publish({ error: 'unsupported' });
    },
    async togglePlayback() {
      if (backend === 'module') {
        if (!modulePlayer) return;
        if (modulePlaying) {
          modulePlayer?.pause();
          modulePlaying = false;
          publish({ playing: false });
          return;
        }
        await playModule();
        return;
      }
      if (backend !== 'stream' || !objectUrl) return;
      if (!audio.paused) {
        audio.pause();
        return;
      }
      if (audio.duration && audio.currentTime >= audio.duration - 0.001) audio.currentTime = 0;
      try {
        await audio.play();
      } catch (error) {
        if ((error as DOMException)?.name !== 'AbortError') {
          publish({ error: 'decode' });
        }
      }
    },
    pause() {
      if (backend === 'module') {
        if (modulePlaying) {
          modulePlayer?.pause();
          modulePlaying = false;
          publish({ playing: false });
        }
        return;
      }
      audio.pause();
    },
    seek(position) {
      if (backend === 'module') {
        if (!modulePlayer || !moduleStarted) return;
        modulePlayer.seek(Math.max(0, Math.min(position, moduleDuration || Number.POSITIVE_INFINITY)));
        moduleCurrentTime = Math.max(0, position);
        publish({ currentTime: moduleCurrentTime });
        return;
      }
      if (!objectUrl) return;
      const duration = Number.isFinite(audio.duration) ? audio.duration : state.duration;
      audio.currentTime = Math.max(0, Math.min(position, duration || Number.POSITIVE_INFINITY));
      publish({ currentTime: audio.currentTime });
    },
    getCurrentTime: () => backend === 'module' ? moduleCurrentTime : audio.currentTime,
    destroy() {
      moduleLoadToken += 1;
      stopAudioClock();
      disposeModulePlayer();
      audio.removeEventListener('loadedmetadata', handleAudioMetadata);
      audio.removeEventListener('durationchange', handleAudioMetadata);
      audio.removeEventListener('play', handleAudioPlay);
      audio.removeEventListener('pause', handleAudioPause);
      audio.removeEventListener('ended', handleAudioPause);
      audio.removeEventListener('error', handleAudioError);
      detachAudio();
    }
  };
}
