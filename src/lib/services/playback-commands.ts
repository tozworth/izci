import { writable } from 'svelte/store';
import { playerController } from '$lib/services/player-controller';
import { playlistStore } from '$lib/stores/playlist';
import type {
  PlaybackSnapshot,
  PlaybackTransitionMode,
  PlaylistItem,
  PlaylistRepeatMode,
  WorkspaceCollection,
  WorkspaceTab
} from '$lib/types';
import { buildPlaylistItems, clonePlaylistItems } from '$lib/utils/files';
import { prepareImportedFiles } from '$lib/services/file-verification';

interface PlaybackCommandsState {
  pendingPlaybackTrackId: string | null;
}

interface CreatePlaybackCommandsControllerOptions {
  getPlayingTrack: () => PlaylistItem | null;
  getSelectedPlaylistTrack: () => PlaylistItem | null;
  getPlaybackState: () => PlaybackSnapshot['state'];
  getPlaybackCurrentTime: () => number;
  getPlaybackDuration: () => number;
  shouldRestartCurrentTrackOnPrevious: () => boolean;
  getTransitionMode: () => PlaybackTransitionMode;
  getGaplessPlaybackEnabled: () => boolean;
  getFadeDurationSeconds: () => number;
  getFadeOnManualTrackChange: () => boolean;
  getShuffleEnabled: () => boolean;
  getRepeatMode: () => PlaylistRepeatMode;
  getTrackById: (collection: WorkspaceCollection, id: string) => PlaylistItem | null;
  selectTrack: (collection: WorkspaceCollection, id: string) => void;
  setActiveWorkspaceTab: (tab: WorkspaceTab) => void;
  cleanupRemovedItems: (items: PlaylistItem[]) => void;
  resolveResumePosition?: (track: PlaylistItem) => Promise<number>;
  notifyTrackResumed?: (track: PlaylistItem, currentTime: number) => void;
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
  getFadeOnManualTrackChange,
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
    track: PlaylistItem,
    options: { manualTransition?: boolean } = {}
  ): Promise<void> {
    const requestId = ++playRequestSequence;
    setPendingPlaybackTrackId(track.id);
    const playableTrack = await playlistStore.ensureLoaded(track.id, { prompt: true });

    if (requestId !== playRequestSequence) {
      clearPendingPlaybackTrackId(track.id);
      return;
    }

    if (!playableTrack) {
      clearPendingPlaybackTrackId(track.id);
      playerController.reportError('Could not access this file. Re-add it or grant file access.');
      return;
    }

    if (getPlayingTrack()?.id !== playableTrack.id) {
      const initialPosition = await resolveResumePosition(playableTrack);

      if (requestId !== playRequestSequence) {
        clearPendingPlaybackTrackId(playableTrack.id);
        return;
      }

      const mode = effectiveTransitionMode();
      const shouldTransition =
        options.manualTransition === true &&
        getFadeOnManualTrackChange() &&
        mode !== 'none' &&
        initialPosition === 0;

      if (shouldTransition) {
        manualTransitionCount += 1;
        try {
          await playerController.transitionTo(playableTrack, mode, getFadeDurationSeconds());
        } finally {
          manualTransitionCount = Math.max(manualTransitionCount - 1, 0);
        }
      } else {
        await playerController.load(playableTrack, { autoPlay: true, initialPosition });
      }

      if (requestId !== playRequestSequence) {
        clearPendingPlaybackTrackId(playableTrack.id);
        return;
      }

      if (initialPosition > 0) notifyTrackResumed(playableTrack, initialPosition);

      return;
    }

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

    selectTrack('playlist', id);
    await playTrack(track, { manualTransition: true });
  }

  async function activateLibraryTrack(id: string): Promise<void> {
    const track = getTrackById('library', id);

    if (!track) {
      return;
    }

    const [addedTrack] = playlistStore.add(clonePlaylistItems([track]));
    const playlistTrack = addedTrack ?? playlistStore.findEquivalent(track);

    if (!playlistTrack) {
      return;
    }

    selectTrack('playlist', playlistTrack.id);
    await playTrack(playlistTrack, { manualTransition: true });
  }

  async function activateFavoriteTrack(track: PlaylistItem): Promise<void> {
    const [addedTrack] = playlistStore.add(clonePlaylistItems([track]));
    const playlistTrack = addedTrack ?? playlistStore.findEquivalent(track);

    if (!playlistTrack) {
      return;
    }

    selectTrack('playlist', playlistTrack.id);
    await playTrack(playlistTrack, { manualTransition: true });
  }

  async function importLaunchedFiles(files: File[], action: 'add' | 'replace'): Promise<void> {
    const nextItems = buildPlaylistItems(await prepareImportedFiles(files));

    if (nextItems.length === 0) {
      return;
    }

    await playlistStore.ready();
    setActiveWorkspaceTab('playlist');

    let addedItems: PlaylistItem[];

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
      return;
    }

    selectTrack('playlist', startTrack.id);
    await playTrack(startTrack);
  }

  function pause(): void {
    if (!getPlayingTrack()) {
      return;
    }

    playerController.pause();
  }

  function stop(): void {
    if (!getPlayingTrack()) {
      return;
    }

    playerController.pause();
    playerController.seek(0);
  }

  function seek(seconds: number): void {
    if (!getPlayingTrack()) {
      return;
    }

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
      playerController.seek(0);
      return;
    }

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
    const playableTrack = await playlistStore.ensureLoaded(nextTrack.id, { prompt: false });
    if (
      requestId !== preparationSequence ||
      getPlayingTrack()?.id !== currentTrack.id ||
      !playableTrack
    ) return;
    await playerController.prepareNext(playableTrack);
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
      return;
    }

    selectTrack('playlist', nextTrack.id);
    if (playerController.commitPrepared(nextTrack.id)) return;
    await playTrack(nextTrack);
  }

  return {
    subscribe: store.subscribe,
    getSnapshot(): PlaybackCommandsState {
      return state;
    },
    notifyCurrentTrackChanged(track: PlaylistItem | null): void {
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
