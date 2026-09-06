import type {
  LyricsDisplayStyle,
  MenuActionItem,
  ModulePatternSnapshot,
  PlaybackSnapshot,
  TrackItem,
  RepeatMode,
  TrackSelection,
  VideoFitMode,
  WorkspaceJumpRequest,
  WorkspaceLibraryGroupRequest,
  WorkspacePanelId,
  WorkspaceResizeHandle,
  WorkspaceTab
} from '$lib/types';
import type { LoadedStreamArtwork } from '$lib/services/stream-artwork';
import type {
  TrackLibraryNavigationTarget,
  TrackLibraryNavigationTargets
} from '$lib/services/library-navigation';
import type { Readable } from 'svelte/store';
import type {
  MultiplayerChatMessage,
  MultiplayerChatTrackLink
} from '$lib/services/multiplayer-protocol';

export const WORKSPACE_DOCK_SCOPE = 'main-workspace';

export interface WorkspacePanelProps {
  items: TrackItem[];
  selectedIds: string[];
  selectionAnchorId?: string | null;
  playingId: string | null;
  favoriteItems?: TrackItem[];
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
  repeatMode?: RepeatMode;
  jumpToItemRequest?: WorkspaceJumpRequest | null;
  libraryGroupRequest?: WorkspaceLibraryGroupRequest | null;
  keyboardActive?: boolean;
  readOnly?: boolean;
  mobilePresentation?: boolean;
  getContextMenuActions?: (ids: string[]) => MenuActionItem[];
}

export interface UpNextPanelProps {
  items: TrackItem[];
  playingId: string | null;
  getContextMenuActions?: (ids: string[]) => MenuActionItem[];
}

export interface UpNextPanelHandlers {
  activate: (event: CustomEvent<string>) => void;
  contextAction: (event: CustomEvent<{ actionId: string; ids: string[] }>) => void;
}

export interface WorkspacePanelHandlers {
  addFiles: (event: FileList | File[]) => void;
  addFolders?: (handles: FileSystemDirectoryHandle[]) => void;
  openFiles: () => void;
  select: (event: CustomEvent<{ id: string; range: boolean; toggle: boolean }>) => void;
  setSelection?: (event: CustomEvent<TrackSelection>) => void;
  activate: (event: CustomEvent<string>) => void;
  contextAction: (event: CustomEvent<{ actionId: string; ids: string[] }>) => void;
  libraryGroupRequestHandled?: (event: CustomEvent<number>) => void;
  toggleShuffle?: () => void;
  cycleRepeat?: () => void;
}

export interface WorkspaceTabDefinition {
  id: WorkspaceTab;
  icon: string;
  label: string;
  closeable?: boolean;
}

export interface WorkspaceTabContentProps {
  snapshotStore: Readable<PlaybackSnapshot>;
  playbackSnapshot: PlaybackSnapshot | null;
  queuePanelProps: WorkspacePanelProps;
  queuePanelHandlers: WorkspacePanelHandlers;
  libraryPanelProps: WorkspacePanelProps;
  libraryPanelHandlers: WorkspacePanelHandlers;
  upNextPanelProps: UpNextPanelProps;
  upNextPanelHandlers: UpNextPanelHandlers;
  selectedItem: TrackItem | null;
  lyricsTrack: TrackItem | null;
  patternTrack: TrackItem | null;
  modulePatternSnapshot: ModulePatternSnapshot;
  detailsArtwork: LoadedStreamArtwork | null;
  detailsLibraryTargets: TrackLibraryNavigationTargets;
  navigateTrackDetailsToLibrary: (target: TrackLibraryNavigationTarget) => void;
  lyricsDisplayStyle: LyricsDisplayStyle;
  lyricsAutoScroll: boolean;
  lyricsFontSize: number;
  lyricsTheaterDowntimeDots: boolean;
  lyricsTheaterDowntimeThresholdSeconds: number;
  lyricsTheaterSmoothScroll: boolean;
  lyricsResumeAutoScrollToken: number;
  chatMessages: Readable<MultiplayerChatMessage[]>;
  chatMotd: string;
  chatMotdHostName: string | null;
  sendChatMessage: (text: string) => boolean;
  sendChatNowPlaying: (track: MultiplayerChatTrackLink) => boolean;
  chatNowPlayingTrack: MultiplayerChatTrackLink | null;
  activateChatTrack: (track: MultiplayerChatTrackLink) => void;
  chatConnected: boolean;
  videoElement: HTMLVideoElement | null;
  videoParkingHost: HTMLDivElement | null;
  videoTheaterActive: boolean;
  videoFitMode: VideoFitMode;
  videoPictureInPictureSupported: boolean;
  videoSeekFeedback: VideoSeekFeedback | null;
}

export interface VideoSeekFeedback {
  id: number;
  deltaSeconds: number;
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
