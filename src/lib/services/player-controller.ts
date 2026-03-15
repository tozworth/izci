import { writable } from 'svelte/store';
import { HowlerPlayerService } from '$lib/services/howler-player';
import { ModulePlayerService } from '$lib/services/module-player';
import { metadataSettings } from '$lib/stores/metadata-settings';
import { modulePlaybackSettings } from '$lib/stores/module-playback-settings';
import type { PlaybackSnapshot, PlaylistItem, TrackMetadata } from '$lib/types';
import { mergeInferredArtistTitle } from '$lib/utils/files';

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
  let metadataConfig = metadataSettings.getSnapshot();

  const onSnapshot = (partial: Partial<PlaybackSnapshot>) => {
    snapshot.update((state) => ({ ...state, ...partial }));
  };

  const applyMetadataInference = (track: PlaylistItem, metadata: TrackMetadata = {}): PlaylistItem => {
    return {
      ...track,
      metadata: mergeInferredArtistTitle({ ...track.metadata, ...metadata }, track.name, metadataConfig.inferFromFilename)
    };
  };

  const onMetadata = (metadata: TrackMetadata) => {
    currentTrack.update((track) => {
      if (!track) {
        return null;
      }

      const nextTrack = applyMetadataInference(track, metadata);
      activeTrack = nextTrack;
      return nextTrack;
    });
  };

  const services = {
    stream: new HowlerPlayerService(onSnapshot, onMetadata, () => onSnapshot({ state: 'ended' })),
    module: new ModulePlayerService(onSnapshot, onMetadata, () => onSnapshot({ state: 'ended' }))
  };
  const unsubscribeModuleSettings = modulePlaybackSettings.subscribe((settings) => {
    void services.module.applySettings(settings);
  });
  const unsubscribeMetadataSettings = metadataSettings.subscribe((settings) => {
    metadataConfig = settings;

    currentTrack.update((track) => {
      if (!track) {
        return null;
      }

      const nextTrack = applyMetadataInference(track);
      activeTrack = nextTrack;
      return nextTrack;
    });
  });

  return {
    snapshot,
    currentTrack,
    async load(track: PlaylistItem) {
      const preparedTrack = applyMetadataInference(track);
      activeTrack = preparedTrack;
      currentTrack.set(preparedTrack);
      services.stream.stop();
      services.stream.destroy();
      services.module.stop();
      onSnapshot({
        state: 'loading',
        currentTime: 0,
        duration: preparedTrack.metadata?.duration ?? 0,
        backend: preparedTrack.kind,
        error: undefined
      });

      if (preparedTrack.kind === 'stream') {
        services.stream.load(preparedTrack);
        services.stream.setVolume(volume);
      } else {
        await services.module.load(preparedTrack);
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
    setVolume(nextVolume: number) {
      nextVolume = Math.min(Math.max(nextVolume, 0), 1);
      volume = nextVolume;
      services.stream.setVolume(nextVolume);
      services.module.setVolume(nextVolume);
      onSnapshot({ volume: nextVolume });
    },
    unload() {
      activeTrack = null;
      currentTrack.set(null);
      services.stream.stop();
      services.stream.destroy();
      services.module.stop();
      onSnapshot({
        ...initialSnapshot,
        volume,
        currentTime: 0,
        duration: 0,
        backend: null,
        error: undefined
      });
    },
    destroy() {
      unsubscribeModuleSettings();
      unsubscribeMetadataSettings();
      services.stream.destroy();
      services.module.destroy();
    }
  };
}

export const playerController = createPlayerController();
