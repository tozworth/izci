import type {
  LyricsDisplayStyle,
  MenuActionItem,
  ModulePatternSnapshot,
  PlaybackSnapshot,
  PlaylistItem,
  PlaylistRepeatMode,
  PlaylistSelection,
  WorkspaceJumpRequest,
  WorkspacePanelId,
  WorkspaceResizeHandle,
  WorkspaceTab
} from '$lib/types';
import type { LoadedStreamArtwork } from '$lib/services/stream-artwork';
import type { Readable } from 'svelte/store';

export interface WorkspacePanelProps {
  items: PlaylistItem[];
  selectedIds: string[];
  selectionAnchorId?: string | null;
  playingId: string | null;
  favoriteItems?: PlaylistItem[];
  favoriteSelectedIds?: string[];
  favoriteSelectionAnchorId?: string | null;
  favoritePlayingId?: string | null;
  panelTitle: string;
  regionLabel: string;
  layout?: 'list' | 'columns';
  fillParent?: boolean;
  hideEyebrow?: boolean;
  showShuffleControl?: boolean;
  showRepeatControl?: boolean;
  showSearchControl?: boolean;
  shuffleEnabled?: boolean;
  repeatMode?: PlaylistRepeatMode;
  jumpToItemRequest?: WorkspaceJumpRequest | null;
  getContextMenuActions?: (ids: string[]) => MenuActionItem[];
}

export interface WorkspacePanelHandlers {
  addFiles: (event: FileList | File[]) => void;
  addFolders?: (handles: FileSystemDirectoryHandle[]) => void;
  openFiles: () => void;
  select: (event: CustomEvent<{ id: string; range: boolean; toggle: boolean }>) => void;
  setSelection?: (event: CustomEvent<PlaylistSelection>) => void;
  activate: (event: CustomEvent<string>) => void;
  contextAction: (event: CustomEvent<{ actionId: string; ids: string[] }>) => void;
  toggleShuffle?: () => void;
  cycleRepeat?: () => void;
}

export interface WorkspaceTabDefinition {
  id: WorkspaceTab;
  icon: string;
  label: string;
}

export interface WorkspaceTabContentProps {
  snapshotStore: Readable<PlaybackSnapshot>;
  playbackSnapshot: PlaybackSnapshot | null;
  playlistPanelProps: WorkspacePanelProps;
  playlistPanelHandlers: WorkspacePanelHandlers;
  libraryPanelProps: WorkspacePanelProps;
  libraryPanelHandlers: WorkspacePanelHandlers;
  selectedItem: PlaylistItem | null;
  lyricsTrack: PlaylistItem | null;
  patternTrack: PlaylistItem | null;
  modulePatternSnapshot: ModulePatternSnapshot;
  detailsArtwork: LoadedStreamArtwork | null;
  lyricsDisplayStyle: LyricsDisplayStyle;
  lyricsAutoScroll: boolean;
  lyricsFontSize: number;
  lyricsTheaterDowntimeDots: boolean;
  lyricsTheaterDowntimeThresholdSeconds: number;
  lyricsTheaterSmoothScroll: boolean;
  lyricsResumeAutoScrollToken: number;
}

export interface WorkspacePanelDefinition {
  id: WorkspacePanelId;
  tabs: WorkspaceTabDefinition[];
  activeTab: WorkspaceTab | null;
  backdropPanelId: WorkspacePanelId;
  isOpen: boolean;
  isResponsiveCollapsed: boolean;
}

export interface WorkspaceTabDragDetail {
  tabId: WorkspaceTab;
  sourcePanelId?: WorkspacePanelId;
}

export interface WorkspaceTabMoveDetail {
  tabId: WorkspaceTab;
  sourcePanelId?: WorkspacePanelId;
  targetPanelId?: WorkspacePanelId;
  targetTabId?: WorkspaceTab;
  position: 'before' | 'after' | 'end';
}

export interface WideWorkspaceResizeStartDetail {
  event: PointerEvent;
  handle: WorkspaceResizeHandle;
}
