import { writable } from 'svelte/store';
import { HowlerPlayerService } from '$lib/services/howler-player';
import { ModulePlayerService } from '$lib/services/module-player';
import { metadataSettings } from '$lib/stores/metadata-settings';
import { modulePlaybackSettings } from '$lib/stores/module-playback-settings';
import { playbackSettings } from '$lib/stores/playback-settings';
import { DEFAULT_PLAYER_VOLUME, playerVolume } from '$lib/stores/player-volume';
import type { PlaybackSnapshot, PlaybackState, PlaylistItem, TrackKind, TrackMetadata } from '$lib/types';
import { mergeInferredArtistTitle } from '$lib/utils/files';

interface PlaybackStatusSnapshot {
  state: PlaybackState;
  volume: number;
  backend: TrackKind | null;
  error?: string;
}

const initialSnapshot: PlaybackSnapshot = {
  state: 'idle',
  currentTime: 0,
  duration: 0,
  volume: DEFAULT_PLAYER_VOLUME,
  backend: null
};

const initialStatusSnapshot: PlaybackStatusSnapshot = {
  state: initialSnapshot.state,
  volume: initialSnapshot.volume,
  backend: initialSnapshot.backend,
  error: initialSnapshot.error
};

function createPlayerController() {
  let volume = playerVolume.getSnapshot();
  let playbackConfig = playbackSettings.getSnapshot();
  const snapshot = writable<PlaybackSnapshot>({ ...initialSnapshot, volume });
  const status = writable<PlaybackStatusSnapshot>({ ...initialStatusSnapshot, volume });
  const currentTrack = writable<PlaylistItem | null>(null);

  let activeTrack: PlaylistItem | null = null;
  let metadataConfig = metadataSettings.getSnapshot();

  const onSnapshot = (partial: Partial<PlaybackSnapshot>) => {
    snapshot.update((state) => ({ ...state, ...partial }));

    if (
      partial.state !== undefined ||
      partial.volume !== undefined ||
      partial.backend !== undefined ||
      Object.prototype.hasOwnProperty.call(partial, 'error')
    ) {
      status.update((state) => ({
        ...state,
        ...(partial.state !== undefined ? { state: partial.state } : {}),
        ...(partial.volume !== undefined ? { volume: partial.volume } : {}),
        ...(partial.backend !== undefined ? { backend: partial.backend } : {}),
        ...(Object.prototype.hasOwnProperty.call(partial, 'error') ? { error: partial.error } : {})
      }));
    }
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
  const unsubscribePlaybackSettings = playbackSettings.subscribe((settings) => {
    playbackConfig = settings;
    services.stream.setVolume(volume, playbackConfig.logarithmicVolume);
    services.module.setVolume(volume, playbackConfig.logarithmicVolume);
  });

  return {
    snapshot,
    status,
    currentTrack,
    async load(track: PlaylistItem, options: { autoPlay?: boolean } = {}) {
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
        services.stream.load(preparedTrack, { autoPlay: options.autoPlay === true });
        services.stream.setVolume(volume, playbackConfig.logarithmicVolume);
      } else {
        await services.module.load(preparedTrack);
        services.module.setVolume(volume, playbackConfig.logarithmicVolume);

        if (options.autoPlay === true) {
          services.module.play();
        }
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
    seek(seconds: number) {
      if (!activeTrack) {
        return;
      }

      services[activeTrack.kind].seek(seconds);
    },
    setVolume(nextVolume: number) {
      nextVolume = Math.min(Math.max(nextVolume, 0), 1);
      volume = nextVolume;
      playerVolume.set(nextVolume);
      services.stream.setVolume(nextVolume, playbackConfig.logarithmicVolume);
      services.module.setVolume(nextVolume, playbackConfig.logarithmicVolume);
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
    reportError(message: string) {
      onSnapshot({
        state: 'error',
        error: message
      });
    },
    destroy() {
      unsubscribeModuleSettings();
      unsubscribeMetadataSettings();
      unsubscribePlaybackSettings();
      services.stream.destroy();
      services.module.destroy();
    }
  };
}

export const playerController = createPlayerController();
