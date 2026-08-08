/**
 * Shared flat-list-with-columns view contract (see ColumnListView.svelte).
 * Both the main-window library columns view and the Logs popup render through
 * this component so column behavior stays in one place.
 */

export type ColumnListViewColumn = {
  id: string;
  label: string;
  /** Fitted width in px; parents compute fit/rebalance against their own widths. */
  width: number;
  minWidth: number;
  visible: boolean;
  /** Context-menu icon (Material Symbols ligature). */
  icon?: string;
  rightAligned?: boolean;
};

export type ColumnListDropIndicator = {
  columnId: string;
  position: 'before' | 'after';
};
