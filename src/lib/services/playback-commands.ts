import { writable } from 'svelte/store';
import { playerController } from '$lib/services/player-controller';
import { playlistStore } from '$lib/stores/playlist';
import { logDebug, logInfo, logWarning } from '$lib/logging/api';
import type { PlaybackSnapshot, PlaybackTransitionMode } from '$lib/contracts/playback';
import type { MediaEntity, PlaylistRepeatMode } from '$lib/contracts/catalog';
import type { WorkspaceCollection, WorkspaceTab } from '$lib/contracts/workspace';
import { buildMediaEntities, cloneMediaEntities } from '$lib/utils/files';
import { prepareImportedFiles } from '$lib/services/file-verification';

interface PlaybackCommandsState {
  pendingPlaybackTrackId: string | null;
}

interface CreatePlaybackCommandsControllerOptions {
  getPlayingTrack: () => MediaEntity | null;
  getSelectedPlaylistTrack: () => MediaEntity | null;
  getPlaybackState: () => PlaybackSnapshot['state'];
  getPlaybackCurrentTime: () => number;
  getPlaybackDuration: () => number;
  shouldRestartCurrentTrackOnPrevious: () => boolean;
  getTransitionMode: () => PlaybackTransitionMode;
  getGaplessPlaybackEnabled: () => boolean;
  getFadeDurationSeconds: () => number;
  getManualTrackChangeFadePercent: () => number;
  getShuffleEnabled: () => boolean;
  getRepeatMode: () => PlaylistRepeatMode;
  getTrackById: (collection: WorkspaceCollection, id: string) => MediaEntity | null;
  selectTrack: (collection: WorkspaceCollection, id: string) => void;
  setActiveWorkspaceTab: (tab: WorkspaceTab) => void;
  cleanupRemovedItems: (items: MediaEntity[]) => void;
  resolveResumePosition?: (track: MediaEntity) => Promise<number>;
  notifyTrackResumed?: (track: MediaEntity, currentTime: number) => void;
}

const initialState: PlaybackCommandsState = {
  pendingPlaybackTrackId: null
};

export const PREVIOUS_TRACK_RESTART_THRESHOLD_SECONDS = 3;

export function resolveEffectiveTransitionMode(
  mode: PlaybackTransitionMode,
  gaplessPlayback: boolean
): PlaybackTransitionMode {
  return mode === 'crossfade' && !gaplessPlayback ? 'fadeout' : mode;
}

export function isAutomaticFadeWindow(
  currentTime: number,
  duration: number,
  fadeDurationSeconds: number
): boolean {
  return Number.isFinite(currentTime)
    && Number.isFinite(duration)
    && duration > 0
    && currentTime >= Math.max(duration - Math.min(Math.max(fadeDurationSeconds, 0), duration), 0);
}

export function resolveManualTransitionDurationSeconds(
  fadeDurationSeconds: number,
  manualTrackChangeFadePercent: number
): number {
  const duration = Number.isFinite(fadeDurationSeconds) ? Math.max(fadeDurationSeconds, 0) : 0;
  const percentage = Number.isFinite(manualTrackChangeFadePercent)
    ? Math.min(Math.max(manualTrackChangeFadePercent, 0), 100)
    : 0;
  return duration * percentage / 100;
}

export function shouldRestartForPrevious(
  direction: -1 | 1,
  enabled: boolean,
  hasPlayingTrack: boolean,
  currentTime: number
): boolean {
  return direction === -1
    && enabled
    && hasPlayingTrack
    && Number.isFinite(currentTime)
    && currentTime >= PREVIOUS_TRACK_RESTART_THRESHOLD_SECONDS;
}

export function createPlaybackCommandsController({
  getPlayingTrack,
  getSelectedPlaylistTrack,
  getPlaybackState,
  getPlaybackCurrentTime,
  getPlaybackDuration,
  shouldRestartCurrentTrackOnPrevious,
  getTransitionMode,
  getGaplessPlaybackEnabled,
  getFadeDurationSeconds,
  getManualTrackChangeFadePercent,
  getShuffleEnabled,
  getRepeatMode,
  getTrackById,
  selectTrack,
  setActiveWorkspaceTab,
  cleanupRemovedItems,
  resolveResumePosition = async () => 0,
  notifyTrackResumed = () => undefined
}: CreatePlaybackCommandsControllerOptions) {
  let state = initialState;
  let playRequestSequence = 0;
  let preparationSequence = 0;
  let automaticFadeTrackId: string | null = null;
  let automaticCrossfadeTrackId: string | null = null;
  let manualTransitionCount = 0;
  const store = writable(state);

  function publishState(): void {
    store.set(state);
  }

  function setPendingPlaybackTrackId(trackId: string | null): void {
    if (state.pendingPlaybackTrackId === trackId) {
      return;
    }

    state = {
      pendingPlaybackTrackId: trackId
    };
    publishState();
  }

  function clearPendingPlaybackTrackId(trackId: string): void {
    if (state.pendingPlaybackTrackId !== trackId) {
      return;
    }

    setPendingPlaybackTrackId(null);
  }

  function effectiveTransitionMode(): PlaybackTransitionMode {
    return resolveEffectiveTransitionMode(getTransitionMode(), getGaplessPlaybackEnabled());
  }

  async function playTrack(
    track: MediaEntity,
    options: { manualTransition?: boolean } = {}
  ): Promise<void> {
    // Start (or resume) the shared context while the initiating tap still carries
    // mobile browser user activation; file permission/materialization may await.
    void playerController.resumeAudio();
    const requestId = ++playRequestSequence;
    setPendingPlaybackTrackId(track.id);
    logInfo('playback', 'Play request', { id: track.id, name: track.name, kind: track.kind });
    const playableLease = await playlistStore.ensureLoaded(track.id, { prompt: true, purpose: 'media-element' });

    if (requestId !== playRequestSequence) {
      playableLease?.release();
      clearPendingPlaybackTrackId(track.id);
      return;
    }

    if (!playableLease) {
      clearPendingPlaybackTrackId(track.id);
      logWarning('playback', 'Playback refused because file access is unavailable', { id: track.id });
      playerController.reportError('Could not access this file. Re-add it or grant file access.');
      return;
    }

    const playableTrack = playableLease.entity;
    if (getPlayingTrack()?.id !== playableTrack.id) {
      const initialPosition = await resolveResumePosition(playableTrack);

      if (requestId !== playRequestSequence) {
        playableLease.release();
        clearPendingPlaybackTrackId(playableTrack.id);
        return;
      }

      const mode = effectiveTransitionMode();
      const manualTransitionDurationSeconds = resolveManualTransitionDurationSeconds(
        getFadeDurationSeconds(),
        getManualTrackChangeFadePercent()
      );
      const shouldTransition =
        options.manualTransition === true &&
        manualTransitionDurationSeconds > 0 &&
        mode !== 'none' &&
        initialPosition === 0;

      if (shouldTransition) {
        manualTransitionCount += 1;
        try {
          await playerController.transitionTo(playableLease, mode, manualTransitionDurationSeconds);
        } finally {
          manualTransitionCount = Math.max(manualTransitionCount - 1, 0);
        }
      } else {
        await playerController.load(playableLease, { autoPlay: true, initialPosition });
      }

      if (requestId !== playRequestSequence) {
        clearPendingPlaybackTrackId(playableTrack.id);
        return;
      }

      if (initialPosition > 0) notifyTrackResumed(playableTrack, initialPosition);

      return;
    }

    playableLease.release();
    clearPendingPlaybackTrackId(playableTrack.id);

    const playbackState = getPlaybackState();

    if (playbackState === 'playing' || playbackState === 'paused' || playbackState === 'ended') {
      playerController.seek(0);
    }

    if (playbackState !== 'playing') {
      playerController.play();
    }
  }

  async function activatePlaylistTrack(id: string): Promise<void> {
    const track = getTrackById('playlist', id);

    if (!track) {
      return;
    }

    logDebug('playback', 'Playlist track activation', { id });
    selectTrack('playlist', id);
    await playTrack(track, { manualTransition: true });
  }

  async function activateLibraryTrack(id: string): Promise<void> {
    const track = getTrackById('library', id);

    if (!track) {
      return;
    }

    logDebug('playback', 'Library track activation', { id });
    const [addedTrack] = playlistStore.add(cloneMediaEntities([track]));
    const playlistTrack = addedTrack ?? playlistStore.findEquivalent(track);

    if (!playlistTrack) {
      return;
    }

    selectTrack('playlist', playlistTrack.id);
    await playTrack(playlistTrack, { manualTransition: true });
  }

  async function activateFavoriteTrack(track: MediaEntity): Promise<void> {
    const [addedTrack] = playlistStore.add(cloneMediaEntities([track]));
    const playlistTrack = addedTrack ?? playlistStore.findEquivalent(track);

    if (!playlistTrack) {
      return;
    }

    selectTrack('playlist', playlistTrack.id);
    await playTrack(playlistTrack, { manualTransition: true });
  }

  async function importLaunchedFiles(files: File[], action: 'add' | 'replace'): Promise<void> {
    logInfo('files', 'Launch import started', { files: files.length, action });
    const nextItems = buildMediaEntities(await prepareImportedFiles(files));

    if (nextItems.length === 0) {
      logWarning('files', 'Launch import contained no playable files', { files: files.length });
      return;
    }

    await playlistStore.ready();
    setActiveWorkspaceTab('playlist');

    let addedItems: MediaEntity[];

    if (action === 'add') {
      addedItems = playlistStore.add(nextItems);
    } else {
      const replacement = playlistStore.replaceAll(nextItems);
      addedItems = replacement.addedItems;
      playerController.unload();
      cleanupRemovedItems(replacement.removedItems);
    }

    const targetTrack = addedItems[0]
      ?? (action === 'add' ? playlistStore.findEquivalent(nextItems[0]) : null);

    if (!targetTrack) {
      return;
    }

    selectTrack('playlist', targetTrack.id);
    await playTrack(targetTrack);
  }

  async function play(): Promise<void> {
    void playerController.resumeAudio();
    const playingTrack = getPlayingTrack();

    if (playingTrack) {
      playerController.play();
      return;
    }

    const selectedPlaylistTrack = getSelectedPlaylistTrack();
    const startTrack = playlistStore.resolveStartTrack({
      selectedId: selectedPlaylistTrack?.id,
      shuffle: getShuffleEnabled()
    });

    if (!startTrack) {
      logInfo('playback', 'Play requested with an empty playlist');
      return;
    }

    selectTrack('playlist', startTrack.id);
    await playTrack(startTrack);
  }

  function pause(): void {
    if (!getPlayingTrack()) {
      return;
    }

    logDebug('playback', 'Pause command');
    playerController.pause();
  }

  function stop(): void {
    if (!getPlayingTrack()) {
      return;
    }

    logInfo('playback', 'Stop command');
    playerController.pause();
    playerController.seek(0);
  }

  function seek(seconds: number): void {
    if (!getPlayingTrack()) {
      return;
    }

    logDebug('playback', 'Seek command', { seconds });
    playerController.seek(seconds);
  }

  async function togglePlayback(): Promise<void> {
    if (getPlaybackState() === 'playing') {
      pause();
      return;
    }

    await play();
  }

  async function stepTrack(direction: -1 | 1): Promise<void> {
    if (shouldRestartForPrevious(
      direction,
      shouldRestartCurrentTrackOnPrevious(),
      getPlayingTrack() !== null,
      getPlaybackCurrentTime()
    )) {
      logDebug('playback', 'Previous command restarted current track');
      playerController.seek(0);
      return;
    }

    logDebug('playback', 'Track step command', { direction });
    const nextTrack = playlistStore.resolveStepTrack({
      currentId: getPlayingTrack()?.id,
      selectedId: getSelectedPlaylistTrack()?.id,
      direction,
      shuffle: getShuffleEnabled(),
      wrap: getRepeatMode() === 'all'
    });

    if (!nextTrack) {
      return;
    }

    selectTrack('playlist', nextTrack.id);
    await playTrack(nextTrack, { manualTransition: true });
  }

  async function prepareUpcomingTrack(): Promise<void> {
    const currentTrack = getPlayingTrack();

    if (!currentTrack || !getGaplessPlaybackEnabled()) return;
    const nextTrack = playlistStore.resolveTrackEnd({
      currentId: currentTrack.id,
      shuffle: getShuffleEnabled(),
      repeatMode: getRepeatMode()
    });
    if (!nextTrack) return;

    const requestId = ++preparationSequence;
    logDebug('playback', 'Preparing upcoming track', { id: nextTrack.id });
    const playableLease = await playlistStore.ensureLoaded(nextTrack.id, { prompt: false, purpose: 'media-element' });
    if (
      requestId !== preparationSequence ||
      getPlayingTrack()?.id !== currentTrack.id ||
      !playableLease
    ) {
      playableLease?.release();
      return;
    }
    await playerController.prepareNext(playableLease);
  }

  async function handlePlaybackProgress(): Promise<void> {
    const currentTrack = getPlayingTrack();
    if (!currentTrack || getPlaybackState() !== 'playing') return;
    const duration = getPlaybackDuration();
    const currentTime = getPlaybackCurrentTime();
    const mode = effectiveTransitionMode();
    if (mode === 'none') return;
    const fadeSeconds = Math.min(getFadeDurationSeconds(), duration);
    if (!isAutomaticFadeWindow(currentTime, duration, fadeSeconds)) return;

    if (mode === 'fadeout' && automaticFadeTrackId !== currentTrack.id) {
      automaticFadeTrackId = currentTrack.id;
      playerController.fadeOut(fadeSeconds);
      return;
    }

    if (mode === 'crossfade' && automaticCrossfadeTrackId !== currentTrack.id) {
      automaticCrossfadeTrackId = currentTrack.id;
      const nextTrack = playlistStore.resolveTrackEnd({
        currentId: currentTrack.id,
        shuffle: getShuffleEnabled(),
        repeatMode: getRepeatMode()
      });
      if (!nextTrack) return;
      if (!playerController.hasPreparedTrack(nextTrack.id)) await prepareUpcomingTrack();
      if (getPlayingTrack()?.id !== currentTrack.id) return;
      if (playerController.commitPrepared(nextTrack.id, fadeSeconds)) {
        logInfo('playback', 'Automatic crossfade committed', { id: nextTrack.id, fadeSeconds });
        selectTrack('playlist', nextTrack.id);
      }
    }
  }

  async function handleTrackEnded(): Promise<void> {
    if (manualTransitionCount > 0) return;
    const nextTrack = playlistStore.resolveTrackEnd({
      currentId: getPlayingTrack()?.id,
      shuffle: getShuffleEnabled(),
      repeatMode: getRepeatMode()
    });

    if (!nextTrack) {
      logInfo('playback', 'Playback ended with no next track');
      return;
    }

    logInfo('playback', 'Track ended; advancing', { nextId: nextTrack.id });
    selectTrack('playlist', nextTrack.id);
    if (playerController.commitPrepared(nextTrack.id)) return;
    await playTrack(nextTrack);
  }

  return {
    subscribe: store.subscribe,
    getSnapshot(): PlaybackCommandsState {
      return state;
    },
    notifyCurrentTrackChanged(track: MediaEntity | null): void {
      if (!track?.id) {
        return;
      }

      clearPendingPlaybackTrackId(track.id);
      preparationSequence += 1;
      automaticFadeTrackId = null;
      automaticCrossfadeTrackId = null;
    },
    playTrack,
    activatePlaylistTrack,
    activateLibraryTrack,
    activateFavoriteTrack,
    importLaunchedFiles,
    play,
    pause,
    stop,
    seek,
    togglePlayback,
    stepTrack,
    prepareUpcomingTrack,
    handlePlaybackProgress,
    handleTrackEnded
  };
}
