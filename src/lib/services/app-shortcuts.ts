import type { PlaybackSnapshot } from '$lib/contracts/playback';
import type { MediaEntity } from '$lib/contracts/catalog';
import type { WorkspaceCollection } from '$lib/contracts/workspace';

const KEYBOARD_SEEK_STEP_SECONDS = 5;
const KEYBOARD_VOLUME_STEP = 0.05;

export interface AppShortcutState {
  isNowPlayingLayoutActive: boolean;
  videoTrackActive: boolean;
  isRightPanelVisible: boolean;
  activeCollection: WorkspaceCollection;
  playlistSelectionIds: string[];
  librarySelectionIds: string[];
  selectedMediaEntity: MediaEntity | null;
  selectedLibraryItem: MediaEntity | null;
  playingTrack: MediaEntity | null;
  playbackSnapshot: PlaybackSnapshot;
}

interface AppShortcutHandlers {
  toggleFullscreenPresentation: () => void | Promise<void>;
  closeNowPlayingView: () => void;
  closeActiveRightPanel: () => void;
  removeMediaEntities: (ids: string[]) => void;
  removeLibraryItems: (ids: string[]) => void;
  cycleWorkspaceTab: (direction: -1 | 1) => boolean;
  seek: (seconds: number) => void;
  stepTrack: (direction: -1 | 1) => void | Promise<void>;
  setVolume: (volume: number) => void;
  activatePlaylistTrack: (id: string) => void | Promise<void>;
  activateLibraryTrack: (id: string) => void | Promise<void>;
  togglePlayback: () => void | Promise<void>;
  toggleMute: () => void;
  selectAllTracks: (collection: WorkspaceCollection) => void;
  openFiles: () => void | Promise<void>;
  openOptions: () => void;
  toggleMiniPlayer: () => void;
  exit: () => void;
}

interface CreateAppShortcutsOptions {
  getState: () => AppShortcutState;
  handlers: AppShortcutHandlers;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function shouldIgnoreKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName;
  return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
}

function isTrackRowKeyboardTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('[data-track-row-button]'));
}

function shouldIgnorePlaybackKeyboardTarget(target: EventTarget | null): boolean {
  if (shouldIgnoreKeyboardTarget(target)) {
    return true;
  }

  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tagName = target.tagName;
  return (tagName === 'BUTTON' || tagName === 'A') && !isTrackRowKeyboardTarget(target);
}

export function createAppShortcuts({ getState, handlers }: CreateAppShortcutsOptions) {
  function handleContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  function handleKeydown(event: KeyboardEvent): void {
    const state = getState();

    if (event.key === 'Enter' && event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey) {
      event.preventDefault();
      void handlers.toggleFullscreenPresentation();
      return;
    }

    if (
      state.videoTrackActive &&
      event.key === 'F11' &&
      !event.repeat &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      void handlers.toggleFullscreenPresentation();
      return;
    }

    if (
      state.videoTrackActive &&
      event.key.toLowerCase() === 'f' &&
      !event.repeat &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey &&
      !shouldIgnoreKeyboardTarget(event.target)
    ) {
      event.preventDefault();
      void handlers.toggleFullscreenPresentation();
      return;
    }

    if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      if (state.isNowPlayingLayoutActive) {
        event.preventDefault();
        handlers.closeNowPlayingView();
      } else if (state.isRightPanelVisible) {
        event.preventDefault();
        handlers.closeActiveRightPanel();
      }

      return;
    }

    if (event.key === 'Delete' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      if (shouldIgnoreKeyboardTarget(event.target)) {
        return;
      }

      const ids =
        state.activeCollection === 'library'
          ? state.librarySelectionIds
          : state.playlistSelectionIds;

      if (ids.length === 0) {
        return;
      }

      event.preventDefault();
      (state.activeCollection === 'library'
        ? handlers.removeLibraryItems
        : handlers.removeMediaEntities)(ids);
      return;
    }

    if (event.key === 'Tab' && event.ctrlKey && !event.altKey && !event.metaKey) {
      if (!shouldIgnoreKeyboardTarget(event.target) && handlers.cycleWorkspaceTab(event.shiftKey ? -1 : 1)) {
        event.preventDefault();
      }
      return;
    }

    if (
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey
    ) {
      if (shouldIgnoreKeyboardTarget(event.target)) {
        return;
      }

      event.preventDefault();

      if (!state.playingTrack || state.playbackSnapshot.duration <= 0) {
        return;
      }

      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      handlers.seek(
        clamp(
          state.playbackSnapshot.currentTime + direction * KEYBOARD_SEEK_STEP_SECONDS,
          0,
          state.playbackSnapshot.duration
        )
      );
      return;
    }

    if (
      event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey &&
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
    ) {
      if (!shouldIgnoreKeyboardTarget(event.target)) {
        event.preventDefault();
        void handlers.stepTrack(event.key === 'ArrowLeft' ? -1 : 1);
      }
      return;
    }

    if (
      event.ctrlKey &&
      !event.altKey &&
      !event.shiftKey &&
      !event.metaKey &&
      (event.key === 'ArrowUp' || event.key === 'ArrowDown')
    ) {
      if (!shouldIgnoreKeyboardTarget(event.target)) {
        event.preventDefault();
        handlers.setVolume(
          clamp(
            state.playbackSnapshot.volume +
              (event.key === 'ArrowUp' ? KEYBOARD_VOLUME_STEP : -KEYBOARD_VOLUME_STEP),
            0,
            1
          )
        );
      }
      return;
    }

    if (event.key === 'Enter' && !event.repeat && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      if (shouldIgnorePlaybackKeyboardTarget(event.target)) {
        return;
      }

      const selectedTrack =
        state.activeCollection === 'library'
          ? state.selectedLibraryItem
          : state.selectedMediaEntity;

      if (!selectedTrack) {
        return;
      }

      event.preventDefault();
      void (state.activeCollection === 'library'
        ? handlers.activateLibraryTrack
        : handlers.activatePlaylistTrack)(selectedTrack.id);
      return;
    }

    if (event.key === ' ' && !event.repeat && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      if (!shouldIgnorePlaybackKeyboardTarget(event.target)) {
        event.preventDefault();
        void handlers.togglePlayback();
      }
      return;
    }

    if (event.key.toLowerCase() === 'm' && !event.repeat && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      if (!shouldIgnorePlaybackKeyboardTarget(event.target)) {
        event.preventDefault();
        handlers.toggleMute();
      }
      return;
    }

    if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey || shouldIgnoreKeyboardTarget(event.target)) {
      return;
    }

    switch (event.key.toLowerCase()) {
      case 'a':
        event.preventDefault();
        handlers.selectAllTracks(state.activeCollection);
        break;
      case 'o':
        event.preventDefault();
        void handlers.openFiles();
        break;
      case 'p':
        event.preventDefault();
        handlers.openOptions();
        break;
      case 'm':
        event.preventDefault();
        handlers.toggleMiniPlayer();
        break;
      case 'q':
        event.preventDefault();
        handlers.exit();
        break;
    }
  }

  return {
    handleContextMenu,
    handleKeydown
  };
}
