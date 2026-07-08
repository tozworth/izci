import type {
  WorkspaceCollection,
  WorkspacePanelStateSettings,
  WorkspaceTab
} from '$lib/types';
import { createPersistentStore } from './persistent-store';

export const WORKSPACE_PANEL_STATE_STORAGE_KEY = 'izci.workspace-panel-state.v1';
export const WORKSPACE_PANEL_STATE_CHANNEL = 'izci-workspace-panel-state';

export const DEFAULT_WORKSPACE_PANEL_STATE: WorkspacePanelStateSettings = {
  detailsVisible: false,
  lyricsVisible: false,
  activeWorkspaceTab: 'playlist',
  activeCollection: 'playlist'
};

function normalizeWorkspaceTab(value: unknown): WorkspaceTab {
  return value === 'library' || value === 'details' || value === 'lyrics' ? value : 'playlist';
}

function normalizeWorkspaceCollection(value: unknown): WorkspaceCollection {
  return value === 'library' ? value : 'playlist';
}

function normalizePanelState(value: unknown): WorkspacePanelStateSettings {
  const source =
    value && typeof value === 'object' ? (value as Partial<WorkspacePanelStateSettings>) : {};
  const detailsVisible = source.detailsVisible === true;
  const lyricsVisible = source.lyricsVisible === true;
  const activeWorkspaceTab = normalizeWorkspaceTab(source.activeWorkspaceTab);
  const activeCollection =
    activeWorkspaceTab === 'playlist' || activeWorkspaceTab === 'library'
      ? activeWorkspaceTab
      : normalizeWorkspaceCollection(source.activeCollection);

  return {
    detailsVisible,
    lyricsVisible,
    activeWorkspaceTab:
      (activeWorkspaceTab === 'details' && !detailsVisible) ||
      (activeWorkspaceTab === 'lyrics' && !lyricsVisible)
        ? activeCollection
        : activeWorkspaceTab,
    activeCollection
  };
}

const store = createPersistentStore({
  storageKey: WORKSPACE_PANEL_STATE_STORAGE_KEY,
  channelName: WORKSPACE_PANEL_STATE_CHANNEL,
  defaultValue: DEFAULT_WORKSPACE_PANEL_STATE,
  normalize: normalizePanelState
});

export const workspacePanelState = {
  subscribe: store.subscribe,
  getSnapshot: store.getSnapshot,
  set(nextValue: WorkspacePanelStateSettings): WorkspacePanelStateSettings {
    return store.set(nextValue);
  },
  update(patch: Partial<WorkspacePanelStateSettings>): WorkspacePanelStateSettings {
    return store.update((settings) => ({ ...settings, ...patch }));
  },
  reset: store.reset
};
