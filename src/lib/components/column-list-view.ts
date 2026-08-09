export type ColumnListViewColumn = {
  id: string;
  label: string;
  width: number;
  minWidth: number;
  visible: boolean;
  icon?: string;
  rightAligned?: boolean;
};

export type ColumnListDropIndicator = {
  columnId: string;
  position: 'before' | 'after';
};
