import { writable } from 'svelte/store';
import { playerController } from '$lib/services/player-controller';
import { queueStore } from '$lib/stores/queue';
import { upNext } from '$lib/stores/up-next';
import { logDebug, logInfo, logWarning } from '$lib/services/logging';
import type {
  PlaybackSnapshot,
  PlaybackTransitionMode,
  TrackItem,
  RepeatMode,
  WorkspaceCollection,
  WorkspaceTab
} from '$lib/types';
import {
  buildTrackItems,
  cloneTrackItems,
  getFavoriteIdentity,
  isVisualMediaFileName
} from '$lib/utils/files';
import { prepareImportedFiles } from '$lib/services/file-verification';
import { videoSettings } from '$lib/stores/video-settings';
import type { AbLoopRange } from '$lib/services/ab-loop';

interface PlaybackCommandsState {
  pendingPlaybackTrackId: string | null;
}

interface CreatePlaybackCommandsControllerOptions {
  getPlayingTrack: () => TrackItem | null;
  getSelectedQueueTrack: () => TrackItem | null;
  getPlaybackState: () => PlaybackSnapshot['state'];
  getPlaybackCurrentTime: () => number;
  getPlaybackDuration: () => number;
  shouldRestartCurrentTrackOnPrevious: () => boolean;
  getTransitionMode: () => PlaybackTransitionMode;
  getGaplessPlaybackEnabled: () => boolean;
  getFadeDurationSeconds: () => number;
  getManualTrackChangeFadePercent: () => number;
  getShuffleEnabled: () => boolean;
  getRepeatMode: () => RepeatMode;
  getTrackById: (collection: WorkspaceCollection, id: string) => TrackItem | null;
  selectTrack: (collection: WorkspaceCollection, id: string) => void;
  setActiveWorkspaceTab: (tab: WorkspaceTab) => void;
  cleanupRemovedItems: (items: TrackItem[]) => void;
  resolveResumePosition?: (track: TrackItem) => Promise<number>;
  notifyTrackResumed?: (track: TrackItem, currentTime: number) => void;
  getStopAfterCurrentTrack?: () => boolean;
  clearStopAfterCurrentTrack?: () => void;
  getActiveLoopRange?: () => AbLoopRange | null;
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

/**
 * A crossfade needs room on both sides: the outgoing track must outlive the
 * fade-in of the incoming one, and the incoming one must reach its own fade
 * window only after the previous crossfade has completed. When a track is
 * shorter than twice its effective fade, the fade window covers the whole
 * track (or the next crossfade would start mid-fade), so overlapping bundles
 * pile up. Skip the automatic crossfade and let the end-of-track path switch
 * plainly instead.
 */
export function shouldSkipAutomaticCrossfade(
  currentDurationSeconds: number,
  nextDurationSeconds: number | undefined,
  fadeDurationSeconds: number
): boolean {
  const currentFade = Math.min(Math.max(fadeDurationSeconds, 0), currentDurationSeconds);
  if (currentDurationSeconds < 2 * currentFade) return true;
  if (
    nextDurationSeconds === undefined ||
    !Number.isFinite(nextDurationSeconds) ||
    nextDurationSeconds <= 0
  ) return false;
  const nextFade = Math.min(Math.max(fadeDurationSeconds, 0), nextDurationSeconds);
  return nextDurationSeconds < 2 * nextFade;
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
  getSelectedQueueTrack,
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
  notifyTrackResumed = () => undefined,
  getStopAfterCurrentTrack = () => false,
  clearStopAfterCurrentTrack = () => undefined,
  getActiveLoopRange = () => null
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

  function resolveQueuedTrack(): TrackItem | null {
    const queueEntry = upNext.peek();

    if (!queueEntry) {
      return null;
    }

    const queuedTrack = getTrackById('queue', queueEntry.id);

    if (!queuedTrack) {
      upNext.removeFirstById(queueEntry.id);
      return null;
    }

    return queuedTrack;
  }

  function resolveNextTrack(): TrackItem | null {
    const queuedTrack = resolveQueuedTrack();

    if (queuedTrack) {
      return queuedTrack;
    }

    return queueStore.resolveTrackEnd({
      currentId: getPlayingTrack()?.id,
      shuffle: getShuffleEnabled(),
      repeatMode: getRepeatMode()
    });
  }

  function consumeQueuedTrack(track: TrackItem): void {
    upNext.removeFirstById(track.id);
  }

  async function playTrack(
    track: TrackItem,
    options: { manualTransition?: boolean } = {}
  ): Promise<void> {
    // Start (or resume) the shared context while the initiating tap still carries
    // mobile browser user activation; file permission/materialization may await.
    if (track.kind !== 'image') void playerController.resumeAudio();
    const requestId = ++playRequestSequence;
    setPendingPlaybackTrackId(track.id);
    logInfo('playback', 'Play request', { id: track.id, name: track.name, kind: track.kind });
    const playableTrack = await queueStore.ensureLoaded(track.id, { prompt: true });

    if (requestId !== playRequestSequence) {
      clearPendingPlaybackTrackId(track.id);
      return;
    }

    if (!playableTrack) {
      clearPendingPlaybackTrackId(track.id);
      logWarning('playback', 'Playback refused because file access is unavailable', { id: track.id });
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
      const manualTransitionDurationSeconds = resolveManualTransitionDurationSeconds(
        getFadeDurationSeconds(),
        getManualTrackChangeFadePercent()
      );
      const shouldTransition =
        playableTrack.kind !== 'image' &&
        getPlayingTrack()?.kind !== 'image' &&
        options.manualTransition === true &&
        manualTransitionDurationSeconds > 0 &&
        mode !== 'none' &&
        initialPosition === 0;

      if (shouldTransition) {
        manualTransitionCount += 1;
        try {
          await playerController.transitionTo(playableTrack, mode, manualTransitionDurationSeconds);
        } finally {
          manualTransitionCount = Math.max(manualTransitionCount - 1, 0);
        }
      } else {
        await playerController.load(playableTrack, {
          autoPlay: playableTrack.kind !== 'image',
          initialPosition: playableTrack.kind === 'image' ? 0 : initialPosition
        });
      }

      if (requestId !== playRequestSequence) {
        clearPendingPlaybackTrackId(playableTrack.id);
        return;
      }

      if (initialPosition > 0) notifyTrackResumed(playableTrack, initialPosition);

      return;
    }

    clearPendingPlaybackTrackId(playableTrack.id);

    if (playableTrack.kind === 'image') return;

    const playbackState = getPlaybackState();

    if (playbackState === 'playing' || playbackState === 'paused' || playbackState === 'ended') {
      playerController.restart();
    }

    if (playbackState !== 'playing') {
      playerController.play();
    }
  }

  async function activateQueueTrack(id: string): Promise<void> {
    const track = getTrackById('queue', id);

    if (!track) {
      return;
    }

    logDebug('playback', 'Queue track activation', { id });
    selectTrack('queue', id);
    await playTrack(track, { manualTransition: true });
  }

  async function activateLibraryTrack(id: string): Promise<void> {
    const track = getTrackById('library', id);

    if (!track) {
      return;
    }

    logDebug('playback', 'Library track activation', { id });
    const [addedTrack] = queueStore.add(cloneTrackItems([track]));
    const queueTrack = addedTrack ?? queueStore.findEquivalent(track);

    if (!queueTrack) {
      return;
    }

    selectTrack('queue', queueTrack.id);
    await playTrack(queueTrack, { manualTransition: true });
  }

  async function activateFavoriteTrack(track: TrackItem): Promise<void> {
    const [addedTrack] = queueStore.add(cloneTrackItems([track]));
    const queueTrack = addedTrack ?? queueStore.findEquivalent(track);

    if (!queueTrack) {
      return;
    }

    selectTrack('queue', queueTrack.id);
    await playTrack(queueTrack, { manualTransition: true });
  }

  async function importLaunchedFiles(files: File[], action: 'add' | 'replace'): Promise<void> {
    logInfo('files', 'Launch import started', { files: files.length, action });
    // Keep the early theater pre-arm (see the launch-handles preview) from
    // being undone by the queue-tab switch while the import resolves.
    const prearmedVisualTheater = videoSettings.getSnapshot().autoEnterTheater
      && files.some((file) => isVisualMediaFileName(file.name));
    const nextItems = buildTrackItems(await prepareImportedFiles(files));

    if (nextItems.length === 0) {
      logWarning('files', 'Launch import contained no playable files', { files: files.length });
      return;
    }

    await queueStore.ready();
    setActiveWorkspaceTab(prearmedVisualTheater ? 'media' : 'queue');

    let addedItems: TrackItem[];

    if (action === 'add') {
      addedItems = queueStore.add(nextItems);
    } else {
      const replacement = queueStore.replaceAll(nextItems);
      addedItems = replacement.addedItems;
      // Mark the incoming visual track pending before unloading: the unload
      // nulls the current track and syncPresentation would otherwise tear
      // down theater across the gap, flashing the workspace.
      const incoming = addedItems[0];
      if (incoming && (incoming.kind === 'video' || incoming.kind === 'image')) {
        setPendingPlaybackTrackId(incoming.id);
      }
      playerController.unload();
      cleanupRemovedItems(replacement.removedItems);
    }

    const targetTrack = addedItems[0]
      ?? (action === 'add' ? queueStore.findEquivalent(nextItems[0]) : null);

    if (!targetTrack) {
      return;
    }

    selectTrack('queue', targetTrack.id);
    await playTrack(targetTrack);
  }

  async function play(): Promise<void> {
    void playerController.resumeAudio();
    const playingTrack = getPlayingTrack();

    if (playingTrack) {
      playerController.play();
      return;
    }

    const queuedTrack = resolveQueuedTrack();

    if (queuedTrack) {
      consumeQueuedTrack(queuedTrack);
      selectTrack('queue', queuedTrack.id);
      await playTrack(queuedTrack);
      return;
    }

    const selectedQueueTrack = getSelectedQueueTrack();
    const startTrack = queueStore.resolveStartTrack({
      selectedId: selectedQueueTrack?.id,
      shuffle: getShuffleEnabled()
    });

    if (!startTrack) {
      logInfo('playback', 'Play requested with an empty queue');
      return;
    }

    selectTrack('queue', startTrack.id);
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
      playerController.restart();
      return;
    }

    logDebug('playback', 'Track step command', { direction });
    const queuedTrack = direction > 0 ? resolveQueuedTrack() : null;
    const nextTrack = queuedTrack ?? queueStore.resolveStepTrack({
      currentId: getPlayingTrack()?.id,
      selectedId: getSelectedQueueTrack()?.id,
      direction,
      shuffle: getShuffleEnabled(),
      wrap: getRepeatMode() === 'all'
    });

    if (!nextTrack) {
      return;
    }

    if (queuedTrack) {
      consumeQueuedTrack(queuedTrack);
    }

    selectTrack('queue', nextTrack.id);
    await playTrack(nextTrack, { manualTransition: true });
  }

  async function prepareUpcomingTrack(): Promise<void> {
    const currentTrack = getPlayingTrack();

    if (!currentTrack || currentTrack.kind === 'image' || !getGaplessPlaybackEnabled() || getStopAfterCurrentTrack() || getActiveLoopRange()) return;
    const nextTrack = resolveNextTrack();
    if (!nextTrack || nextTrack.kind === 'image') return;

    const requestId = ++preparationSequence;
    logDebug('playback', 'Preparing upcoming track', { id: nextTrack.id });
    const playableTrack = await queueStore.ensureLoaded(nextTrack.id, { prompt: false });
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
    // An active A-B loop owns the timeline: no auto fades or crossfades.
    if (getActiveLoopRange()) return;
    const fadeSeconds = Math.min(getFadeDurationSeconds(), duration);
    if (!isAutomaticFadeWindow(currentTime, duration, fadeSeconds)) return;

    if (mode === 'fadeout' && automaticFadeTrackId !== currentTrack.id) {
      automaticFadeTrackId = currentTrack.id;
      playerController.fadeOut(fadeSeconds);
      return;
    }

    if (mode === 'crossfade' && automaticCrossfadeTrackId !== currentTrack.id) {
      if (getStopAfterCurrentTrack()) return;
      automaticCrossfadeTrackId = currentTrack.id;
      const nextTrack = resolveNextTrack();
      if (!nextTrack) return;
      if (!playerController.hasPreparedTrack(nextTrack.id)) await prepareUpcomingTrack();
      if (getPlayingTrack()?.id !== currentTrack.id) return;
      // A crossfade needs room on both sides. When the current track (or the
      // prepared next one) is shorter than twice the effective fade, the fade
      // window covers the whole track and consecutive crossfades overlap
      // bundles on top of each other. Skip the crossfade; the end-of-track
      // path still switches gaplessly through the prepared bundle.
      if (shouldSkipAutomaticCrossfade(
        duration,
        playerController.preparedTrackDurationSeconds() ?? nextTrack.metadata?.duration,
        fadeSeconds
      )) {
        logDebug('playback', 'Automatic crossfade skipped for short track',
          { id: nextTrack.id, currentDuration: duration, fadeSeconds });
        return;
      }
      if (playerController.commitPrepared(nextTrack.id, fadeSeconds)) {
        logInfo('playback', 'Automatic crossfade committed', { id: nextTrack.id, fadeSeconds });
        consumeQueuedTrack(nextTrack);
        selectTrack('queue', nextTrack.id);
      }
    }
  }

  async function handleTrackEnded(): Promise<void> {
    if (manualTransitionCount > 0) return;

    if (getStopAfterCurrentTrack()) {
      clearStopAfterCurrentTrack();
      logInfo('playback', 'Stopped after current track');
      playerController.pause();
      playerController.seek(0);
      return;
    }

    const loopRange = getActiveLoopRange();
    if (loopRange) {
      logInfo('playback', 'A-B loop wrapped at track end', { start: loopRange.start });
      playerController.seek(loopRange.start);
      playerController.play();
      return;
    }

    const nextTrack = resolveNextTrack();

    if (!nextTrack) {
      logInfo('playback', 'Playback ended with no next track');
      return;
    }

    logInfo('playback', 'Track ended; advancing', { nextId: nextTrack.id });
    consumeQueuedTrack(nextTrack);
    selectTrack('queue', nextTrack.id);
    if (playerController.commitPrepared(nextTrack.id)) return;
    await playTrack(nextTrack);
  }

  return {
    subscribe: store.subscribe,
    getSnapshot(): PlaybackCommandsState {
      return state;
    },
    notifyCurrentTrackChanged(track: TrackItem | null): void {
      if (!track?.id) {
        return;
      }

      upNext.removeByIdentity(getFavoriteIdentity(track));
      clearPendingPlaybackTrackId(track.id);
      preparationSequence += 1;
      automaticFadeTrackId = null;
      automaticCrossfadeTrackId = null;
    },
    playTrack,
    activateQueueTrack,
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
