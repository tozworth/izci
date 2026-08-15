import { writable } from 'svelte/store';
import { getTrackLyricsLoadKey, loadTrackLyrics } from '$lib/services/lyrics';
import type {
  ContextualTabAutomation,
  LyricsDisplayStyle,
  TrackItem,
  WorkspaceTab
} from '$lib/types';

export type LyricsAvailability = 'unknown' | 'loading' | 'available' | 'unavailable';

export interface LyricsPresentationState {
  availability: LyricsAvailability;
  trackKey: string;
  resumeAutoScrollToken: number;
}

interface LyricsWorkspaceState {
  activeWorkspaceTab: WorkspaceTab;
  isLyricsPanelVisible: boolean;
  workspaceTabs: Array<{ id: WorkspaceTab }>;
}

interface LyricsPresentationSyncInput {
  track: TrackItem | null;
  isNowPlayingLayoutActive: boolean;
  autoFocusInNowPlaying: boolean;
  displayStyle: LyricsDisplayStyle;
  automation: ContextualTabAutomation;
}

interface CreateLyricsPresentationControllerOptions {
  getWorkspaceState: () => LyricsWorkspaceState;
  showTrackLyrics: () => void;
  closeTrackLyrics: () => void;
  setActiveWorkspaceTab: (tab: WorkspaceTab) => void;
}

const initialState: LyricsPresentationState = {
  availability: 'unknown',
  trackKey: '',
  resumeAutoScrollToken: 0
};

export function createLyricsPresentationController({
  getWorkspaceState,
  showTrackLyrics,
  closeTrackLyrics,
  setActiveWorkspaceTab
}: CreateLyricsPresentationControllerOptions) {
  const state = writable<LyricsPresentationState>(initialState);
  let snapshot = initialState;
  let loadToken = 0;
  let automationSignature = '';
  let wasNowPlayingLayoutActive = false;
  let nowPlayingRestoreTab: WorkspaceTab | null = null;
  let nowPlayingAutoFocusedLyrics = false;
  let nowPlayingHadLyricsPanelVisible = false;
  let nowPlayingAutoFocusTrackKey = '';
  let nowPlayingAutoScrollSignature = '';

  function publish(patch: Partial<LyricsPresentationState>): void {
    snapshot = { ...snapshot, ...patch };
    state.set(snapshot);
  }

  function syncTrack(track: TrackItem | null): void {
    const nextTrackKey = getTrackLyricsLoadKey(track);

    if (nextTrackKey === snapshot.trackKey) {
      return;
    }

    const currentToken = ++loadToken;
    publish({
      trackKey: nextTrackKey,
      availability: track && nextTrackKey ? 'loading' : 'unavailable'
    });

    if (!track || !nextTrackKey) {
      return;
    }

    void loadTrackLyrics(track)
      .then((loadedLyrics) => {
        if (currentToken === loadToken) {
          publish({ availability: loadedLyrics ? 'available' : 'unavailable' });
        }
      })
      .catch(() => {
        if (currentToken === loadToken) {
          publish({ availability: 'unavailable' });
        }
      });
  }

  function restoreWorkspaceTab(tab: WorkspaceTab): void {
    if (getWorkspaceState().workspaceTabs.some((workspaceTab) => workspaceTab.id === tab)) {
      setActiveWorkspaceTab(tab);
    }
  }

  function syncLayoutTransition(isActive: boolean): void {
    if (isActive === wasNowPlayingLayoutActive) {
      return;
    }

    const workspace = getWorkspaceState();

    if (isActive) {
      nowPlayingRestoreTab = workspace.activeWorkspaceTab;
      nowPlayingAutoFocusedLyrics = false;
      nowPlayingHadLyricsPanelVisible = workspace.isLyricsPanelVisible;
      nowPlayingAutoFocusTrackKey = '';
      wasNowPlayingLayoutActive = true;
      return;
    }

    if (
      nowPlayingAutoFocusedLyrics &&
      workspace.activeWorkspaceTab === 'lyrics' &&
      nowPlayingRestoreTab
    ) {
      restoreWorkspaceTab(nowPlayingRestoreTab);
    }

    if (
      nowPlayingAutoFocusedLyrics &&
      !nowPlayingHadLyricsPanelVisible &&
      getWorkspaceState().isLyricsPanelVisible
    ) {
      closeTrackLyrics();
    }

    nowPlayingRestoreTab = null;
    nowPlayingAutoFocusedLyrics = false;
    nowPlayingHadLyricsPanelVisible = false;
    nowPlayingAutoFocusTrackKey = '';
    wasNowPlayingLayoutActive = false;
  }

  function syncPanelAvailability(automation: ContextualTabAutomation): void {
    const signature = `${snapshot.trackKey}:${snapshot.availability}:${automation}`;

    if (
      signature === automationSignature ||
      snapshot.availability === 'loading' ||
      snapshot.availability === 'unknown'
    ) {
      return;
    }

    automationSignature = signature;

    if (snapshot.availability === 'available' && automation !== 'manual') {
      showTrackLyrics();
    } else if (
      snapshot.availability === 'unavailable' &&
      automation === 'open-close' &&
      getWorkspaceState().isLyricsPanelVisible
    ) {
      closeTrackLyrics();
    }
  }

  function syncNowPlayingAutoFocus(isLayoutActive: boolean, enabled: boolean): void {
    const workspace = getWorkspaceState();

    if (
      !isLayoutActive ||
      !enabled ||
      snapshot.availability !== 'available' ||
      !snapshot.trackKey ||
      nowPlayingAutoFocusTrackKey === snapshot.trackKey
    ) {
      return;
    }

    nowPlayingAutoFocusTrackKey = snapshot.trackKey;

    if (workspace.activeWorkspaceTab !== 'lyrics') {
      nowPlayingRestoreTab ??= workspace.activeWorkspaceTab;
      nowPlayingAutoFocusedLyrics = true;
      showTrackLyrics();
    }
  }

  function syncNowPlayingAutoScroll(isLayoutActive: boolean, displayStyle: LyricsDisplayStyle): void {
    const workspace = getWorkspaceState();
    const signature =
      isLayoutActive && workspace.activeWorkspaceTab === 'lyrics'
        ? `${snapshot.trackKey}:${displayStyle}`
        : '';

    if (signature === nowPlayingAutoScrollSignature) {
      return;
    }

    nowPlayingAutoScrollSignature = signature;

    if (signature) {
      resumeAutoScroll();
    }
  }

  function sync(input: LyricsPresentationSyncInput): void {
    syncTrack(input.track);
    syncLayoutTransition(input.isNowPlayingLayoutActive);
    syncNowPlayingAutoFocus(input.isNowPlayingLayoutActive, input.autoFocusInNowPlaying);
    syncNowPlayingAutoScroll(input.isNowPlayingLayoutActive, input.displayStyle);
    syncPanelAvailability(input.automation);
  }

  function resumeAutoScroll(): void {
    publish({ resumeAutoScrollToken: snapshot.resumeAutoScrollToken + 1 });
  }

  function destroy(): void {
    loadToken += 1;
  }

  return {
    subscribe: state.subscribe,
    sync,
    resumeAutoScroll,
    destroy
  };
}
