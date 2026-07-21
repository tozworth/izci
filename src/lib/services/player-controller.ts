import { writable } from 'svelte/store';
import { audioBusService } from '$lib/services/audio-bus';
import { HowlerPlayerService } from '$lib/services/howler-player';
import { ModulePlayerService } from '$lib/services/module-player';
import { metadataSettings } from '$lib/stores/metadata-settings';
import { modulePlaybackSettings } from '$lib/stores/module-playback-settings';
import { playbackSettings } from '$lib/stores/playback-settings';
import { DEFAULT_PLAYER_VOLUME, playerVolume } from '$lib/stores/player-volume';
import { applyReplayGain, sliderVolumeToGain } from '$lib/services/volume';
import type {
  ModulePatternSnapshot,
  PlaybackSnapshot,
  PlaybackState,
  PlaylistItem,
  TrackKind,
  TrackMetadata
} from '$lib/types';
import { mergeInferredArtistTitle } from '$lib/utils/files';
import type { StemPlaybackAsset } from '$lib/services/stem-separation/types';

interface PlaybackStatusSnapshot {
  state: PlaybackState;
  volume: number;
  muted: boolean;
  backend: TrackKind | null;
  error?: string;
}

const initialSnapshot: PlaybackSnapshot = {
  state: 'idle',
  currentTime: 0,
  duration: 0,
  volume: DEFAULT_PLAYER_VOLUME,
  muted: false,
  backend: null
};

const initialStatusSnapshot: PlaybackStatusSnapshot = {
  state: initialSnapshot.state,
  volume: initialSnapshot.volume,
  muted: initialSnapshot.muted,
  backend: initialSnapshot.backend,
  error: initialSnapshot.error
};

const initialModulePatternSnapshot: ModulePatternSnapshot = {
  trackId: null,
  song: null,
  order: 0,
  pattern: 0,
  row: 0
};

function createPlayerController() {
  let volume = playerVolume.getSnapshot();
  let lastAudibleVolume = volume > 0 ? volume : DEFAULT_PLAYER_VOLUME;
  let muted = false;
  let playbackConfig = playbackSettings.getSnapshot();
  let desiredPlaybackState: 'playing' | 'paused' = 'paused';
  let latestState: PlaybackState = initialSnapshot.state;
  const snapshot = writable<PlaybackSnapshot>({ ...initialSnapshot, volume });
  const status = writable<PlaybackStatusSnapshot>({ ...initialStatusSnapshot, volume });
  const currentTrack = writable<PlaylistItem | null>(null);
  const modulePattern = writable<ModulePatternSnapshot>({ ...initialModulePatternSnapshot });

  let activeTrack: PlaylistItem | null = null;
  let metadataConfig = metadataSettings.getSnapshot();

  const onSnapshot = (partial: Partial<PlaybackSnapshot>) => {
    if (partial.state !== undefined) {
      latestState = partial.state;
    }

    snapshot.update((state) => ({ ...state, ...partial }));

    if (
      partial.state !== undefined ||
      partial.volume !== undefined ||
      partial.muted !== undefined ||
      partial.backend !== undefined ||
      Object.prototype.hasOwnProperty.call(partial, 'error')
    ) {
      status.update((state) => ({
        ...state,
        ...(partial.state !== undefined ? { state: partial.state } : {}),
        ...(partial.volume !== undefined ? { volume: partial.volume } : {}),
        ...(partial.muted !== undefined ? { muted: partial.muted } : {}),
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

  const hasSameMetadata = (left: TrackMetadata | undefined, right: TrackMetadata | undefined): boolean =>
    JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});

  const applyBackendVolume = () => {
    const effectiveVolume = muted ? 0 : volume;
    const streamReplayGain = activeTrack?.kind === 'stream' ? activeTrack.metadata?.replayGain : undefined;

    audioBusService.setInputGain(
      activeTrack?.kind === 'stream'
        ? applyReplayGain(1, streamReplayGain, playbackConfig.replayGainMode)
        : 1
    );
    audioBusService.setOutputGain(sliderVolumeToGain(effectiveVolume, playbackConfig.logarithmicVolume));

    // This is audible only if Chromium cannot route Howler's media element
    // through the shared Web Audio graph.
    services.stream.setVolume(
      effectiveVolume,
      playbackConfig.logarithmicVolume,
      streamReplayGain,
      playbackConfig.replayGainMode
    );
  };

  const setConfiguredVolume = (nextVolume: number) => {
    volume = Math.min(Math.max(nextVolume, 0), 1);

    if (volume > 0) {
      lastAudibleVolume = volume;
    }

    playerVolume.set(volume);
  };

  const onMetadata = (metadata: TrackMetadata) => {
    currentTrack.update((track) => {
      if (!track) {
        return null;
      }

      const nextTrack = applyMetadataInference(track, metadata);
      activeTrack = nextTrack;
      applyBackendVolume();
      return nextTrack;
    });
  };

  const onModulePattern = (partial: Partial<ModulePatternSnapshot> | null) => {
    if (!partial || activeTrack?.kind !== 'module') {
      modulePattern.set({ ...initialModulePatternSnapshot });
      return;
    }

    modulePattern.update((state) => ({
      ...state,
      ...partial,
      trackId: activeTrack?.id ?? null
    }));
  };

  const services = {
    stream: new HowlerPlayerService(onSnapshot, onMetadata, () => onSnapshot({ state: 'ended' })),
    module: new ModulePlayerService(
      onSnapshot,
      onMetadata,
      onModulePattern,
      () => onSnapshot({ state: 'ended' })
    )
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
    applyBackendVolume();
  });

  return {
    snapshot,
    status,
    currentTrack,
    modulePattern,
    async load(
      track: PlaylistItem,
      options: { autoPlay?: boolean; initialPosition?: number } = {}
    ) {
      const autoPlay = options.autoPlay === true;
      const initialPosition = Math.max(options.initialPosition ?? 0, 0);
      const preparedTrack = applyMetadataInference(track);
      desiredPlaybackState = autoPlay ? 'playing' : 'paused';
      activeTrack = preparedTrack;
      currentTrack.set(preparedTrack);
      services.stream.destroy();
      services.module.stop({ silent: true });

      if (preparedTrack.kind === 'stream') {
        services.stream.load(preparedTrack, { autoPlay, initialPosition });
        applyBackendVolume();
      } else {
        const pendingDuration = preparedTrack.metadata?.duration ?? 0;
        const loadPromise = services.module.load(preparedTrack);

        onSnapshot({
          state: autoPlay ? 'playing' : 'loading',
          currentTime: 0,
          duration: pendingDuration,
          backend: preparedTrack.kind,
          subsong: preparedTrack.subsong ?? 0,
          subsongCount: Math.max(1, preparedTrack.metadata?.subsongs ?? 1),
          error: undefined
        });

        await loadPromise;
        applyBackendVolume();

        if (desiredPlaybackState === 'playing') {
          services.module.play();
          if (initialPosition > 0) {
            services.module.seek(initialPosition);
          }
        } else if (initialPosition > 0) {
          services.module.play();
          services.module.seek(initialPosition);
          services.module.pause();
        } else if (latestState === 'loading') {
          onSnapshot({ state: 'paused', error: undefined });
        }

        return;
      }

      onSnapshot({
        state: autoPlay ? 'playing' : 'loading',
        currentTime: initialPosition,
        duration: preparedTrack.metadata?.duration ?? 0,
        backend: preparedTrack.kind,
        subsong: undefined,
        subsongCount: undefined,
        error: undefined
      });
    },
    play() {
      if (!activeTrack) {
        return;
      }

      desiredPlaybackState = 'playing';
      services[activeTrack.kind].play();
    },
    pause() {
      if (!activeTrack) {
        return;
      }

      desiredPlaybackState = 'paused';
      services[activeTrack.kind].pause();

      if (latestState === 'loading' || latestState === 'playing') {
        onSnapshot({ state: 'paused', error: undefined });
      }
    },
    seek(seconds: number) {
      if (!activeTrack) {
        return;
      }

      services[activeTrack.kind].seek(seconds);
    },
    stepSubsong(direction: -1 | 1) {
      if (!activeTrack || activeTrack.kind !== 'module') {
        return;
      }

      const subsong = services.module.stepSubsong(direction);

      if (subsong === null) {
        return;
      }

      const nextTrack = { ...activeTrack, subsong };
      activeTrack = nextTrack;
      currentTrack.set(nextTrack);
    },
    setVolume(nextVolume: number) {
      setConfiguredVolume(nextVolume);
      muted = false;
      applyBackendVolume();
      onSnapshot({ volume, muted });
    },
    toggleMute() {
      if (muted || volume <= 0) {
        setConfiguredVolume(lastAudibleVolume);
        muted = false;
      } else {
        muted = true;
      }

      applyBackendVolume();
      onSnapshot({ volume, muted });
    },
    setStemPlaybackAsset(asset: StemPlaybackAsset | null) {
      services.stream.setStemPlaybackAsset(activeTrack?.kind === 'stream' ? asset : null);
    },
    setStemMix(value: number) {
      services.stream.setStemMix(value);
    },
    unload() {
      desiredPlaybackState = 'paused';
      activeTrack = null;
      currentTrack.set(null);
      services.stream.destroy();
      services.module.stop();
      onSnapshot({
        ...initialSnapshot,
        volume,
        currentTime: 0,
        duration: 0,
        backend: null,
        subsong: undefined,
        subsongCount: undefined,
        error: undefined
      });
    },
    reportError(message: string) {
      onSnapshot({
        state: 'error',
        error: message
      });
    },
    refreshCurrentTrackMetadata(id: string, metadata: TrackMetadata | undefined) {
      if (!activeTrack || activeTrack.id !== id || hasSameMetadata(activeTrack.metadata, metadata)) {
        return;
      }

      const nextTrack = applyMetadataInference(activeTrack, metadata);
      activeTrack = nextTrack;
      currentTrack.set(nextTrack);
      applyBackendVolume();
    },
    destroy() {
      unsubscribeModuleSettings();
      unsubscribeMetadataSettings();
      unsubscribePlaybackSettings();
      services.stream.destroy();
      services.module.destroy();
      audioBusService.destroy();
    }
  };
}

export const playerController = createPlayerController();
