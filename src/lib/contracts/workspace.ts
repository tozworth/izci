export type SortDirection = 'asc' | 'desc';
export type LibraryColumnId =
  | 'title'
  | 'artist'
  | 'album'
  | 'discAndTrack'
  | 'folder'
  | 'format'
  | 'duration'
  | 'rating'
  | 'plays';
export type LibraryViewId =
  | 'favorites'
  | 'ratings'
  | 'songs'
  | 'artists'
  | 'albums'
  | 'genres'
  | 'years'
  | 'formats'
  | 'folders';
export type LibraryGroupViewId = Exclude<
  LibraryViewId,
  'favorites' | 'ratings' | 'songs'
>;
export type WorkspaceCollection = 'playlist' | 'library';
export type WorkspaceTab =
  WorkspaceCollection | 'details' | 'lyrics' | 'patterns' | 'video';
export type ContextualWorkspaceTab = Extract<
  WorkspaceTab,
  'lyrics' | 'patterns'
>;
export type ContextualTabAutomation = 'manual' | 'open' | 'open-close';
export type ContextualTabSettings = Record<
  ContextualWorkspaceTab,
  ContextualTabAutomation
>;
export type WorkspacePanelId = 'left' | 'center' | 'right';

export const WORKSPACE_TABS: WorkspaceTab[] = [
  'playlist',
  'library',
  'details',
  'lyrics',
  'patterns',
  'video',
];
export const WORKSPACE_PANEL_IDS: WorkspacePanelId[] = [
  'left',
  'center',
  'right',
];

export interface WorkspaceResizeHandle {
  before: WorkspacePanelId;
  after: WorkspacePanelId;
}

export interface LibraryViewColumnState {
  width: number;
  visible: boolean;
}

export interface LibraryViewSortState {
  columnId: LibraryColumnId;
  direction: SortDirection;
}

export interface LibraryViewTableSettings {
  order: LibraryColumnId[];
  columns: Record<LibraryColumnId, LibraryViewColumnState>;
  sort: LibraryViewSortState;
}

export interface LibraryViewSettings {
  activeView: LibraryViewId;
  views: Record<LibraryViewId, LibraryViewTableSettings>;
  pinnedGroupKeys: Record<LibraryGroupViewId, string[]>;
  searchQuery: string;
}

export interface WorkspacePanelLayoutSettings {
  leftFraction: number;
  centerFraction: number;
  rightFraction: number;
}

export type WorkspacePanelTabsSettings = Record<
  WorkspacePanelId,
  WorkspaceTab[]
>;
export type WorkspacePanelActiveTabsSettings = Record<
  WorkspacePanelId,
  WorkspaceTab | null
>;
export type WorkspaceTabPanelMemorySettings = Record<
  WorkspaceTab,
  WorkspacePanelId
>;

export interface WorkspacePanelStateSettings {
  activeWorkspaceTab: WorkspaceTab;
  activeCollection: WorkspaceCollection;
  panels: WorkspacePanelTabsSettings;
  openPanels: WorkspacePanelId[];
  activeTabsByPanel: WorkspacePanelActiveTabsSettings;
  lastPanelByTab: WorkspaceTabPanelMemorySettings;
  tabbedTabOrder: WorkspaceTab[];
}

export interface WorkspaceJumpRequest {
  id: string;
  token: number;
}

export interface WorkspaceLibraryGroupRequest {
  view: LibraryGroupViewId;
  groupKey: string;
  trackId: string;
  token: number;
}
