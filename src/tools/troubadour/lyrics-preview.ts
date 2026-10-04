import { writable, type Readable } from 'svelte/store';
import { OpenMptPlayer } from '$lib/services/openmpt/player';
import { DEFAULT_OPENMPT_SETTINGS } from '$lib/services/openmpt/protocol';
import { MODULE_EXTENSIONS, type TrackKind } from '$lib/types';

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

  let modulePlayer: OpenMptPlayer | null = null;
  let moduleLoadToken = 0;
  let modulePlaying = false;
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
    modulePlaying = false;
    if (!player) return;
    player.dispose();
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
    try { buffer = await file.arrayBuffer(); }
    catch { if (loadToken === moduleLoadToken) publish({ error: 'decode' }); return; }
    if (loadToken !== moduleLoadToken) return;
    const context = new AudioContext();
    let player: OpenMptPlayer;
    try { player = await OpenMptPlayer.create(context); }
    catch {
      void context.close().catch(() => undefined);
      if (loadToken === moduleLoadToken) publish({ error: 'decode' });
      return;
    }
    if (loadToken !== moduleLoadToken) {
      player.dispose();
      void context.close().catch(() => undefined);
      return;
    }
    modulePlayer = player;
    player.gain.connect(context.destination);
    player.handlers = {
      ended: () => {
        if (player !== modulePlayer) return;
        modulePlaying = false;
        moduleCurrentTime = moduleDuration;
        publish({ currentTime: moduleCurrentTime, duration: moduleDuration, playing: false });
      },
      error: () => {
        if (player !== modulePlayer) return;
        modulePlaying = false;
        publish({ playing: false, ready: false, error: 'decode' });
      },
      metadata: ({ metadata }) => {
        if (player !== modulePlayer) return;
        moduleDuration = metadata.duration ?? 0;
        publish({ duration: moduleDuration, ready: true, error: '' });
      },
      progress: (progress) => {
        if (player !== modulePlayer) return;
        moduleCurrentTime = progress.currentTime;
        publish({ currentTime: moduleCurrentTime });
      }
    };
    try {
      const { metadata } = await player.load(buffer, 0, DEFAULT_OPENMPT_SETTINGS);
      if (loadToken !== moduleLoadToken) return;
      moduleDuration = metadata.duration ?? 0;
      publish({ duration: moduleDuration, ready: true, error: '' });
    } catch {
      if (loadToken === moduleLoadToken) { disposeModulePlayer(); publish({ error: 'decode' }); }
    }
  };

  const playModule = async () => {
    const player = modulePlayer;
    if (!player || !state.ready) return;
    try { if (player.context.state === 'suspended') await player.context.resume(); }
    catch { return; }
    if (player !== modulePlayer || modulePlaying) return;
    player.play();
    modulePlaying = true;
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
        if (!modulePlayer || !state.ready) return;
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
