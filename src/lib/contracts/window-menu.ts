export interface MenuActionItem {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  iconColor?: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  attention?: boolean;
  /** Optional secondary action shown at the trailing edge while the item is hovered. */
  removeActionId?: string;
  removeLabel?: string;
  children?: MenuActionItem[];
  ratingPicker?: {
    value: number;
    actionPrefix: string;
  };
}

export interface WindowMenuGroup {
  id: string;
  label: string;
  items: MenuActionItem[];
  icon?: string;
  application?: boolean;
  attention?: boolean;
}

export type WindowMenuSubtitleTone =
  'muted' | 'success' | 'current' | 'warning';
