import { writable } from 'svelte/store';
import { HowlerPlayerService } from '$lib/services/howler-player';
import { ModulePlayerService } from '$lib/services/module-player';
import type { PlaybackSnapshot, PlaylistItem, TrackMetadata } from '$lib/types';

const initialSnapshot: PlaybackSnapshot = {
  state: 'idle',
  currentTime: 0,
  duration: 0,
  volume: 0.85,
  backend: null
};

function createPlayerController() {
  const snapshot = writable<PlaybackSnapshot>(initialSnapshot);
  const currentTrack = writable<PlaylistItem | null>(null);

  let activeTrack: PlaylistItem | null = null;
  let volume = initialSnapshot.volume;

  const onSnapshot = (partial: Partial<PlaybackSnapshot>) => {
    snapshot.update((state) => ({ ...state, ...partial }));
  };

  const onMetadata = (metadata: TrackMetadata) => {
    currentTrack.update((track) => {
      if (!track) {
        return null;
      }

      return { ...track, metadata: { ...track.metadata, ...metadata } };
    });
  };

  const services = {
    stream: new HowlerPlayerService(onSnapshot, onMetadata, () => onSnapshot({ state: 'ended' })),
    module: new ModulePlayerService(onSnapshot, onMetadata, () => onSnapshot({ state: 'ended' }))
  };

  return {
    snapshot,
    currentTrack,
    async load(track: PlaylistItem) {
      activeTrack = track;
      currentTrack.set(track);
      services.stream.stop();
      services.stream.destroy();
      services.module.stop();
      onSnapshot({
        state: 'loading',
        currentTime: 0,
        duration: track.metadata?.duration ?? 0,
        backend: track.kind,
        error: undefined
      });

      if (track.kind === 'stream') {
        services.stream.load(track);
        services.stream.setVolume(volume);
      } else {
        await services.module.load(track);
        services.module.setVolume(volume);
      }
    },
    play() {
      if (!activeTrack) {
        return;
      }

      services[activeTrack.kind].play();
    },
    pause() {
      if (!activeTrack) {
        return;
      }

      services[activeTrack.kind].pause();
    },
    togglePlayback(state: PlaybackSnapshot['state']) {
      if (state === 'playing') {
        this.pause();
      } else {
        this.play();
      }
    },
    seek(seconds: number) {
      if (!activeTrack) {
        return;
      }

      services[activeTrack.kind].seek(seconds);
    },
    setVolume(volume: number) {
      volume = Math.min(Math.max(volume, 0), 1);
      services.stream.setVolume(volume);
      services.module.setVolume(volume);
      onSnapshot({ volume });
    },
    destroy() {
      services.stream.destroy();
      services.module.stop();
    }
  };
}

export const playerController = createPlayerController();
