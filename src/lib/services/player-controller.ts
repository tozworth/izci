import { writable } from 'svelte/store';
import { audioBusService } from '$lib/services/audio-bus';
import { HivelyPlayerService } from '$lib/services/ahx-player';
import { HowlerPlayerService } from '$lib/services/howler-player';
import { logDebug, logError, logInfo, logWarning } from '$lib/services/logging';
import { mediaSessionService } from '$lib/services/media-session';
import { ModulePlayerService } from '$lib/services/module-player';
import { loadTrackMetadata } from '$lib/services/stream-artwork';
import { VideoPlayerService } from '$lib/services/video-player';
import { metadataSettings } from '$lib/stores/metadata-settings';
import { modulePlaybackSettings } from '$lib/stores/module-playback-settings';
import { playbackSettings } from '$lib/stores/playback-settings';
import { DEFAULT_PLAYER_VOLUME, playerVolume } from '$lib/stores/player-volume';
import { sliderVolumeToGain } from '$lib/services/volume';
import {
  HIVELY_MODULE_EXTENSIONS,
  type ModulePatternSnapshot,
  type PlaybackSnapshot,
  type PlaybackState,
  type PlaylistItem,
  type TrackKind,
  type TrackMetadata
} from '$lib/types';
import { mergeInferredArtistTitle } from '$lib/utils/files';

interface PlaybackStatusSnapshot {
  state: PlaybackState;
  volume: number;
  muted: boolean;
  backend: TrackKind | null;
  error?: string;
}

interface PlaybackBundle {
  id: number;
  loadSequence: number;
  targetTrackId: string | null;
  ready: boolean;
  readiness: Promise<boolean> | null;
  track: PlaylistItem | null;
  snapshot: PlaybackSnapshot;
  transitionGain: number;
  stream: HowlerPlayerService;
  module: ModulePlayerService;
  hively: HivelyPlayerService;
  video: VideoPlayerService;
}

export type CurrentTrackExternalUpdate = Partial<
  Pick<
    PlaylistItem,
    | 'fileHandle'
    | 'path'
    | 'sourceFolderId'
    | 'name'
    | 'extension'
    | 'kind'
    | 'size'
    | 'lastModified'
    | 'metadata'
  >
>;

const initialSnapshot: PlaybackSnapshot = {
  state: 'idle',
  currentTime: 0,
  duration: 0,
  volume: DEFAULT_PLAYER_VOLUME,
  muted: false,
  backend: null
};

const initialModulePatternSnapshot: ModulePatternSnapshot = {
  trackId: null,
  song: null,
  order: 0,
  pattern: 0,
  row: 0
};

function isHivelyModule(track: PlaylistItem): boolean {
  return HIVELY_MODULE_EXTENSIONS.includes(
    track.extension.toLowerCase() as (typeof HIVELY_MODULE_EXTENSIONS)[number]
  );
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function createPlayerController() {
  let volume = playerVolume.getSnapshot();
  let lastAudibleVolume = volume > 0 ? volume : DEFAULT_PLAYER_VOLUME;
  let muted = false;
  let playbackConfig = playbackSettings.getSnapshot();
  let metadataConfig = metadataSettings.getSnapshot();
  let desiredPlaybackState: 'playing' | 'paused' = 'paused';
  let latestState: PlaybackState = initialSnapshot.state;
  let operationSequence = 0;
  let prepareSequence = 0;
  let bundleSequence = 0;
  let outgoingTimer: number | null = null;
  const bundles = new Set<PlaybackBundle>();

  const snapshot = writable<PlaybackSnapshot>({ ...initialSnapshot, volume });
  const status = writable<PlaybackStatusSnapshot>({
    state: initialSnapshot.state,
    volume,
    muted,
    backend: null
  });
  const currentTrack = writable<PlaylistItem | null>(null);
  const modulePattern = writable<ModulePatternSnapshot>({ ...initialModulePatternSnapshot });

  let activeBundle: PlaybackBundle;
  let preparedBundle: PlaybackBundle | null = null;
  let outgoingBundle: PlaybackBundle | null = null;

  function publish(partial: Partial<PlaybackSnapshot>): void {
    if (partial.state !== undefined) latestState = partial.state;
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
  }

  function applyMetadataInference(track: PlaylistItem, metadata: TrackMetadata = {}): PlaylistItem {
    return {
      ...track,
      metadata: mergeInferredArtistTitle(
        { ...track.metadata, ...metadata },
        track.name,
        metadataConfig.inferFromFilename
      )
    };
  }

  function hasSameMetadata(left: TrackMetadata | undefined, right: TrackMetadata | undefined): boolean {
    return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
  }

  function updateBundleSnapshot(bundle: PlaybackBundle, partial: Partial<PlaybackSnapshot>): void {
    bundle.snapshot = { ...bundle.snapshot, ...partial };
    if (bundle === activeBundle) publish(partial);
  }

  function updateBundleMetadata(bundle: PlaybackBundle, metadata: TrackMetadata): void {
    if (!bundle.track) return;
    bundle.track = applyMetadataInference(bundle.track, metadata);
    applyBundleTransitionGain(bundle);
    if (bundle === activeBundle) currentTrack.set(bundle.track);
  }

  function updateBundlePattern(
    bundle: PlaybackBundle,
    partial: Partial<ModulePatternSnapshot> | null
  ): void {
    if (bundle !== activeBundle || !partial || bundle.track?.kind !== 'module') {
      if (bundle === activeBundle) modulePattern.set({ ...initialModulePatternSnapshot });
      return;
    }

    modulePattern.update((state) => ({
      ...state,
      ...partial,
      trackId: bundle.track?.id ?? null
    }));
  }

  function createBundle(): PlaybackBundle {
    const bundle = {
      id: ++bundleSequence,
      loadSequence: 0,
      targetTrackId: null,
      ready: false,
      readiness: null,
      track: null,
      snapshot: { ...initialSnapshot, volume, muted },
      transitionGain: 1
    } as PlaybackBundle;

    bundle.stream = new HowlerPlayerService(
      (partial) => updateBundleSnapshot(bundle, partial),
      (metadata) => updateBundleMetadata(bundle, metadata),
      () => handleBundleEnded(bundle)
    );
    bundle.module = new ModulePlayerService(
      (partial) => updateBundleSnapshot(bundle, partial),
      (metadata) => updateBundleMetadata(bundle, metadata),
      (partial) => updateBundlePattern(bundle, partial),
      () => handleBundleEnded(bundle)
    );
    bundle.hively = new HivelyPlayerService(
      (partial) => updateBundleSnapshot(bundle, partial),
      (metadata) => updateBundleMetadata(bundle, metadata),
      (partial) => updateBundlePattern(bundle, partial),
      () => handleBundleEnded(bundle)
    );
    bundle.video = new VideoPlayerService(
      (partial) => updateBundleSnapshot(bundle, partial),
      (metadata) => updateBundleMetadata(bundle, metadata),
      () => handleBundleEnded(bundle)
    );
    bundle.stream.setPlaybackRate(playbackConfig.playbackRate, playbackConfig.trueSpeed);
    bundle.video.setPlaybackRate(playbackConfig.playbackRate, playbackConfig.trueSpeed);
    bundles.add(bundle);
    return bundle;
  }

  activeBundle = createBundle();

  function resumeAudioAfterInterruption(): void {
    if (typeof document === 'undefined' || document.visibilityState === 'hidden'
      || desiredPlaybackState !== 'playing') return;
    void audioBusService.resume();
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', resumeAudioAfterInterruption);
  }
  if (typeof window !== 'undefined') window.addEventListener('pageshow', resumeAudioAfterInterruption);

  function bundleService(bundle: PlaybackBundle) {
    const track = bundle.track;
    if (!track) return null;
    if (track.kind === 'module') return isHivelyModule(track) ? bundle.hively : bundle.module;
    return bundle[track.kind];
  }

  function applyBundleTransitionGain(bundle: PlaybackBundle, durationSeconds = 0): void {
    bundle.stream.setTransitionGain(bundle.transitionGain, durationSeconds);
    bundle.module.setTransitionGain(bundle.transitionGain, durationSeconds);
    bundle.hively.setTransitionGain(bundle.transitionGain, durationSeconds);
    bundle.video.setTransitionGain(bundle.transitionGain, durationSeconds);
  }

  function setBundleTransitionGain(
    bundle: PlaybackBundle,
    gain: number,
    durationSeconds = 0
  ): void {
    bundle.transitionGain = Math.min(Math.max(gain, 0), 1);
    applyBundleTransitionGain(bundle, durationSeconds);
  }

  function applyBundleVolume(bundle: PlaybackBundle): void {
    const effectiveVolume = muted ? 0 : volume;
    const outputGain = sliderVolumeToGain(effectiveVolume, playbackConfig.logarithmicVolume);
    const replayGain = bundle.track?.kind === 'stream' ? bundle.track.metadata?.replayGain : undefined;

    bundle.stream.setVolume(
      effectiveVolume,
      playbackConfig.logarithmicVolume,
      replayGain,
      playbackConfig.replayGainMode
    );
    bundle.video.setFallbackVolume(outputGain);
  }

  function applyBackendVolume(refreshTransitionGains = false): void {
    const effectiveVolume = muted ? 0 : volume;
    const outputGain = sliderVolumeToGain(effectiveVolume, playbackConfig.logarithmicVolume);

    audioBusService.setInputGain(1);
    audioBusService.setOutputGain(outputGain);
    audioBusService.setRafEffectBypass('auto-amp', activeBundle.track?.kind === 'video');

    for (const bundle of bundles) {
      applyBundleVolume(bundle);
      if (refreshTransitionGains) applyBundleTransitionGain(bundle);
    }
  }

  function setConfiguredVolume(nextVolume: number): void {
    volume = Math.min(Math.max(nextVolume, 0), 1);
    if (volume > 0) lastAudibleVolume = volume;
    playerVolume.set(volume);
  }

  function destroyBundle(bundle: PlaybackBundle): void {
    bundle.loadSequence += 1;
    bundle.stream.destroy();
    bundle.module.stop({ silent: true });
    bundle.hively.stop({ silent: true });
    bundle.video.unload();
    bundle.track = null;
    bundle.ready = false;
    bundle.readiness = null;
    bundles.delete(bundle);
  }

  function clearPrepared(): void {
    prepareSequence += 1;
    if (!preparedBundle) return;
    destroyBundle(preparedBundle);
    preparedBundle = null;
  }

  function clearOutgoing(): void {
    if (outgoingTimer !== null) {
      window.clearTimeout(outgoingTimer);
      outgoingTimer = null;
    }
    if (!outgoingBundle) return;
    destroyBundle(outgoingBundle);
    outgoingBundle = null;
    syncModuleTransportAnchor();
  }

  function syncModuleTransportAnchor(): void {
    if (activeBundle.track?.kind !== 'module') {
      mediaSessionService.deactivateTransportAnchor();
      return;
    }
    mediaSessionService.activateTransportAnchor();
    if (desiredPlaybackState === 'playing') mediaSessionService.playTransportAnchor();
    else mediaSessionService.pauseTransportAnchor();
  }

  function handleBundleEnded(bundle: PlaybackBundle): void {
    if (bundle === outgoingBundle) clearOutgoing();
  }

  async function prepareTrackMetadata(track: PlaylistItem): Promise<PlaylistItem> {
    let preparedTrack = applyMetadataInference(track);
    if (
      preparedTrack.kind === 'stream' &&
      playbackConfig.replayGainMode !== 'off' &&
      preparedTrack.metadata?.embeddedMetadataLoaded !== true
    ) {
      const embeddedMetadata = await loadTrackMetadata(preparedTrack).catch(() => null);
      if (embeddedMetadata) preparedTrack = applyMetadataInference(preparedTrack, embeddedMetadata);
    }
    return preparedTrack;
  }

  async function loadIntoBundle(
    bundle: PlaybackBundle,
    track: PlaylistItem,
    options: { autoPlay?: boolean; initialPosition?: number } = {}
  ): Promise<boolean> {
    const autoPlay = options.autoPlay === true;
    const initialPosition = Math.max(options.initialPosition ?? 0, 0);
    const loadId = ++bundle.loadSequence;
    bundle.targetTrackId = track.id;
    bundle.ready = false;
    bundle.stream.destroy();
    bundle.module.stop({ silent: true });
    bundle.hively.stop({ silent: true });
    bundle.video.unload();
    const preparedTrack = await prepareTrackMetadata(track);
    if (loadId !== bundle.loadSequence) return false;
    bundle.track = preparedTrack;
    if (bundle === activeBundle) currentTrack.set(preparedTrack);
    bundle.snapshot = {
      ...initialSnapshot,
      state: autoPlay ? 'playing' : 'loading',
      currentTime: initialPosition,
      duration: preparedTrack.metadata?.duration ?? 0,
      volume,
      muted,
      backend: preparedTrack.kind
    };
    applyBundleVolume(bundle);
    applyBundleTransitionGain(bundle);

    if (preparedTrack.kind === 'stream') {
      await bundle.stream.load(preparedTrack, { autoPlay, initialPosition });
      if (loadId !== bundle.loadSequence) return false;
    } else if (preparedTrack.kind === 'module') {
      const service = isHivelyModule(preparedTrack) ? bundle.hively : bundle.module;
      await service.load(preparedTrack);
      if (loadId !== bundle.loadSequence) return false;
      applyBundleTransitionGain(bundle);
      if (autoPlay) {
        service.play();
        if (initialPosition > 0) service.seek(initialPosition);
      } else if (initialPosition > 0) {
        service.play();
        service.seek(initialPosition);
        service.pause();
      } else {
        updateBundleSnapshot(bundle, { state: 'paused', error: undefined });
      }
    } else {
      await bundle.video.load(preparedTrack, { autoPlay, initialPosition });
      if (loadId !== bundle.loadSequence) return false;
    }
    bundle.ready = true;
    return true;
  }

  function publishActiveBundle(state?: PlaybackState): void {
    const nextState = state ?? activeBundle.snapshot.state;
    publish({
      ...activeBundle.snapshot,
      state: nextState,
      volume,
      muted,
      backend: activeBundle.track?.kind ?? null,
      error: undefined
    });
  }

  async function loadActive(
    track: PlaylistItem,
    options: { autoPlay?: boolean; initialPosition?: number } = {}
  ): Promise<void> {
    const requestId = ++operationSequence;
    logInfo('playback', 'Track load requested', {
      id: track.id, name: track.name, kind: track.kind, autoPlay: options.autoPlay === true
    });
    clearPrepared();
    clearOutgoing();
    desiredPlaybackState = options.autoPlay === true ? 'playing' : 'paused';
    setBundleTransitionGain(activeBundle, 1);
    let loaded: boolean;
    try {
      loaded = await loadIntoBundle(activeBundle, track, options);
    } catch (error) {
      logError('playback', 'Track load failed', { id: track.id, kind: track.kind, error });
      throw error;
    }
    if (requestId !== operationSequence || !loaded || !activeBundle.track) return;
    currentTrack.set(activeBundle.track);
    publishActiveBundle(options.autoPlay ? 'playing' : activeBundle.snapshot.state);
    audioBusService.setRafEffectBypass('auto-amp', activeBundle.track.kind === 'video');
    logInfo('playback', 'Track load completed', { id: track.id, kind: track.kind });
    syncModuleTransportAnchor();
  }

  async function prepareNext(track: PlaylistItem): Promise<boolean> {
    if (preparedBundle?.targetTrackId === track.id) {
      return preparedBundle.ready || await (preparedBundle.readiness ?? Promise.resolve(false));
    }
    const requestId = ++prepareSequence;
    if (preparedBundle) destroyBundle(preparedBundle);
    const bundle = createBundle();
    preparedBundle = bundle;
    bundle.targetTrackId = track.id;
    setBundleTransitionGain(bundle, 0);
    logDebug('playback', 'Preparing next backend', { id: track.id, kind: track.kind });
    bundle.readiness = (async () => {
      try {
        const loaded = await loadIntoBundle(bundle, track, { autoPlay: false });
        return loaded && requestId === prepareSequence && preparedBundle === bundle;
      } catch {
        return false;
      }
    })();

    const ready = await bundle.readiness;
    if (!ready && requestId === prepareSequence && preparedBundle === bundle) {
      destroyBundle(bundle);
      preparedBundle = null;
    }
    if (!ready) {
      logWarning('playback', 'Prepared track failed', { id: track.id });
      syncModuleTransportAnchor();
      return false;
    }

    syncModuleTransportAnchor();
    logDebug('playback', 'Prepared track ready', { id: track.id });
    return true;
  }

  function commitPrepared(trackId: string, crossfadeSeconds = 0): boolean {
    if (!preparedBundle?.ready || !preparedBundle.track || preparedBundle.track.id !== trackId) return false;
    operationSequence += 1;
    logInfo('playback', 'Prepared track committed', { id: trackId, crossfadeSeconds });
    clearOutgoing();
    const previous = activeBundle;
    const incoming = preparedBundle;
    preparedBundle = null;
    activeBundle = incoming;
    outgoingBundle = previous;
    desiredPlaybackState = 'playing';
    currentTrack.set(incoming.track);
    setBundleTransitionGain(incoming, crossfadeSeconds > 0 ? 0 : 1);
    bundleService(incoming)?.play();
    publishActiveBundle('playing');

    if (crossfadeSeconds > 0) {
      setBundleTransitionGain(previous, 0, crossfadeSeconds);
      setBundleTransitionGain(incoming, 1, crossfadeSeconds);
      outgoingTimer = window.setTimeout(clearOutgoing, crossfadeSeconds * 1000 + 50);
    } else {
      clearOutgoing();
    }
    audioBusService.setRafEffectBypass('auto-amp', incoming.track?.kind === 'video');
    syncModuleTransportAnchor();
    return true;
  }

  const unsubscribeModuleSettings = modulePlaybackSettings.subscribe((settings) => {
    for (const bundle of bundles) {
      void bundle.module.applySettings(settings);
      void bundle.hively.applySettings(settings);
    }
  });
  const unsubscribeMetadataSettings = metadataSettings.subscribe((settings) => {
    metadataConfig = settings;
    for (const bundle of bundles) {
      if (bundle.track) bundle.track = applyMetadataInference(bundle.track);
    }
    if (activeBundle.track) currentTrack.set(activeBundle.track);
  });
  const unsubscribePlaybackSettings = playbackSettings.subscribe((settings) => {
    playbackConfig = settings;
    if (!settings.gaplessPlayback) clearPrepared();
    for (const bundle of bundles) {
      bundle.stream.setPlaybackRate(settings.playbackRate, settings.trueSpeed);
      bundle.video.setPlaybackRate(settings.playbackRate, settings.trueSpeed);
    }
    applyBackendVolume(true);
  });

  return {
    snapshot,
    status,
    currentTrack,
    modulePattern,
    get videoElement() {
      return activeBundle.video.element;
    },
    get videoPictureInPictureSupported() {
      return activeBundle.video.pictureInPictureSupported;
    },
    resumeAudio() {
      return audioBusService.resume();
    },
    toggleVideoPictureInPicture() {
      return activeBundle.video.togglePictureInPicture();
    },
    load: loadActive,
    prepareNext,
    commitPrepared,
    hasPreparedTrack(trackId: string): boolean {
      return preparedBundle?.ready === true && preparedBundle.track?.id === trackId;
    },
    fadeOut(durationSeconds: number): void {
      setBundleTransitionGain(activeBundle, 0, durationSeconds);
    },
    async transitionTo(
      track: PlaylistItem,
      mode: 'none' | 'fadeout' | 'crossfade',
      durationSeconds: number
    ): Promise<void> {
      const requestId = ++operationSequence;
      if (mode === 'crossfade') {
        const ready = await prepareNext(track);
        if (requestId !== operationSequence || !ready) return;
        commitPrepared(track.id, durationSeconds);
        return;
      }
      if (mode === 'fadeout' && activeBundle.track) {
        clearPrepared();
        setBundleTransitionGain(activeBundle, 0, durationSeconds);
        await wait(durationSeconds * 1000);
        if (requestId !== operationSequence) return;
      }
      if (requestId !== operationSequence) return;
      await loadActive(track, { autoPlay: true });
    },
    play() {
      if (!activeBundle.track) return;
      desiredPlaybackState = 'playing';
      setBundleTransitionGain(activeBundle, 1);
      bundleService(activeBundle)?.play();
      syncModuleTransportAnchor();
      logInfo('playback', 'Playback started', { id: activeBundle.track.id, kind: activeBundle.track.kind });
    },
    pause() {
      if (!activeBundle.track) return;
      desiredPlaybackState = 'paused';
      setBundleTransitionGain(activeBundle, 1);
      bundleService(activeBundle)?.pause();
      if (outgoingBundle) bundleService(outgoingBundle)?.pause();
      if (latestState === 'loading' || latestState === 'playing') {
        publish({ state: 'paused', error: undefined });
      }
      syncModuleTransportAnchor();
      logInfo('playback', 'Playback paused', { id: activeBundle.track.id });
    },
    seek(seconds: number) {
      if (!activeBundle.track) return;
      clearOutgoing();
      setBundleTransitionGain(activeBundle, 1);
      bundleService(activeBundle)?.seek(seconds);
    },
    stepSubsong(direction: -1 | 1) {
      const track = activeBundle.track;
      if (!track || track.kind !== 'module') return;
      const subsong = (isHivelyModule(track) ? activeBundle.hively : activeBundle.module)
        .stepSubsong(direction);
      if (subsong === null) return;
      activeBundle.track = { ...track, subsong };
      currentTrack.set(activeBundle.track);
    },
    setVolume(nextVolume: number) {
      setConfiguredVolume(nextVolume);
      muted = false;
      applyBackendVolume();
      publish({ volume, muted });
    },
    toggleMute() {
      if (muted || volume <= 0) {
        setConfiguredVolume(lastAudibleVolume);
        muted = false;
      } else {
        muted = true;
      }
      applyBackendVolume();
      publish({ volume, muted });
    },
    unload() {
      operationSequence += 1;
      desiredPlaybackState = 'paused';
      clearPrepared();
      clearOutgoing();
      destroyBundle(activeBundle);
      activeBundle = createBundle();
      currentTrack.set(null);
      logInfo('playback', 'Playback unloaded');
      modulePattern.set({ ...initialModulePatternSnapshot });
      publish({
        ...initialSnapshot,
        volume,
        muted,
        currentTime: 0,
        duration: 0,
        backend: null,
        error: undefined
      });
      syncModuleTransportAnchor();
    },
    reportError(message: string) {
      logError('playback', 'Playback error reported', { message });
      publish({ state: 'error', error: message });
    },
    refreshCurrentTrackMetadata(id: string, metadata: TrackMetadata | undefined) {
      if (!activeBundle.track || activeBundle.track.id !== id || hasSameMetadata(activeBundle.track.metadata, metadata)) return;
      activeBundle.track = applyMetadataInference(activeBundle.track, metadata);
      currentTrack.set(activeBundle.track);
      applyBackendVolume();
      applyBundleTransitionGain(activeBundle);
    },
    refreshCurrentTrack(id: string, patch: CurrentTrackExternalUpdate) {
      const activeTrack = activeBundle.track;
      if (!activeTrack || activeTrack.id !== id) return false;
      const existingPlayCount = activeTrack.metadata?.playCount;
      const { playCount: _externalPlayCount, ...externalMetadata } = patch.metadata ?? {};
      const metadata = patch.metadata === undefined
        ? activeTrack.metadata
        : { ...externalMetadata, ...(existingPlayCount === undefined ? {} : { playCount: existingPlayCount }) };
      activeBundle.track = {
        ...activeTrack,
        ...patch,
        id: activeTrack.id,
        file: activeTrack.file,
        objectUrl: activeTrack.objectUrl,
        subsong: activeTrack.subsong,
        metadata: mergeInferredArtistTitle(
          metadata ?? {},
          patch.name ?? activeTrack.name,
          metadataConfig.inferFromFilename
        )
      };
      currentTrack.set(activeBundle.track);
      applyBackendVolume();
      applyBundleTransitionGain(activeBundle);
      return true;
    },
    destroy() {
      operationSequence += 1;
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', resumeAudioAfterInterruption);
      }
      if (typeof window !== 'undefined') window.removeEventListener('pageshow', resumeAudioAfterInterruption);
      unsubscribeModuleSettings();
      unsubscribeMetadataSettings();
      unsubscribePlaybackSettings();
      if (outgoingTimer !== null) window.clearTimeout(outgoingTimer);
      for (const bundle of [...bundles]) destroyBundle(bundle);
      audioBusService.destroy();
    }
  };
}

export const playerController = createPlayerController();
