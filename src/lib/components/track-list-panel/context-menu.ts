import type { LibraryGroupViewId } from '$lib/types';

export type TrackListPanelContextMenu =
  | {
      kind: 'items';
      x: number;
      y: number;
      ids: string[];
    }
  | {
      kind: 'panel';
      x: number;
      y: number;
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
