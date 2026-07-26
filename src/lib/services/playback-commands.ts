import { writable } from 'svelte/store';
import { playerController } from '$lib/services/player-controller';
import { playlistStore } from '$lib/stores/playlist';
import type {
  PlaybackSnapshot,
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
  shouldRestartCurrentTrackOnPrevious: () => boolean;
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
  shouldRestartCurrentTrackOnPrevious,
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

  async function playTrack(track: PlaylistItem): Promise<void> {
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

      await playerController.load(playableTrack, { autoPlay: true, initialPosition });

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
    await playTrack(track);
  }

  async function activateLibraryTrack(id: string): Promise<void> {
    const track = getTrackById('library', id);

    if (!track) {
      return;
    }

    const [playlistTrack] = playlistStore.add(clonePlaylistItems([track]));

    if (!playlistTrack) {
      return;
    }

    selectTrack('playlist', playlistTrack.id);
    await playTrack(playlistTrack);
  }

  async function activateFavoriteTrack(track: PlaylistItem): Promise<void> {
    const [playlistTrack] = playlistStore.add(clonePlaylistItems([track]));

    if (!playlistTrack) {
      return;
    }

    selectTrack('playlist', playlistTrack.id);
    await playTrack(playlistTrack);
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

    if (addedItems.length === 0) {
      return;
    }

    selectTrack('playlist', addedItems[0].id);
    await playTrack(addedItems[0]);
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
    await playTrack(nextTrack);
  }

  async function handleTrackEnded(): Promise<void> {
    const nextTrack = playlistStore.resolveTrackEnd({
      currentId: getPlayingTrack()?.id,
      shuffle: getShuffleEnabled(),
      repeatMode: getRepeatMode()
    });

    if (!nextTrack) {
      return;
    }

    selectTrack('playlist', nextTrack.id);
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
    handleTrackEnded
  };
}
