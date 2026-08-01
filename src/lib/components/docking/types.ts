export interface DockTabDefinition {
  id: string;
  icon: string;
  label: string;
  closeable?: boolean;
  disabled?: boolean;
}

export interface DockTabDragDetail {
  tabId: string;
  sourceZoneId?: string;
}

export interface DockTabMoveDetail extends DockTabDragDetail {
  targetZoneId?: string;
  targetTabId?: string;
  position: 'before' | 'after' | 'end';
}
