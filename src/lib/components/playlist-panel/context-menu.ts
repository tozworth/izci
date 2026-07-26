export type PlaylistPanelContextMenu =
  | {
      kind: 'items';
      x: number;
      y: number;
      ids: string[];
    }
  | {
      kind: 'columns';
      x: number;
      y: number;
    };
