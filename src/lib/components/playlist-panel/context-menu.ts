import type { LibraryGroupViewId } from '$lib/contracts/workspace';

export type PlaylistPanelContextMenu =
  | {
      kind: 'items';
      x: number;
      y: number;
      ids: string[];
    }
  | {
      kind: 'library-group';
      x: number;
      y: number;
      ids: string[];
      view: LibraryGroupViewId;
      key: string;
      pinned: boolean;
    };
