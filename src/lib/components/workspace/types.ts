import type {
  MenuActionItem,
  PlaylistItem,
  PlaylistRepeatMode,
  PlaylistSelection,
  WorkspaceJumpRequest,
  WorkspaceResizeHandle,
  WorkspaceTab
} from '$lib/types';

export interface WorkspacePanelProps {
  items: PlaylistItem[];
  selectedIds: string[];
  selectionAnchorId?: string | null;
  playingId: string | null;
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

export interface WideWorkspaceResizeStartDetail {
  event: PointerEvent;
  handle: WorkspaceResizeHandle;
}
