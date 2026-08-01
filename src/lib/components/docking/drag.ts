import type { DockTabDragDetail } from './types';

export const DOCK_TAB_DRAG_MIME = 'application/x-izci-dock-tab';

interface DockTabDragPayload extends DockTabDragDetail {
  scope: string;
}

export function writeDockTabDragData(
  dataTransfer: DataTransfer,
  scope: string,
  data: DockTabDragDetail
): void {
  const payload: DockTabDragPayload = { scope, ...data };

  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(DOCK_TAB_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData('text/plain', data.tabId);
}

export function hasDockTabDragData(
  dataTransfer: DataTransfer | null,
  scope: string
): boolean {
  if (!dataTransfer || !Array.from(dataTransfer.types).includes(DOCK_TAB_DRAG_MIME)) {
    return false;
  }

  const rawData = dataTransfer.getData(DOCK_TAB_DRAG_MIME);

  if (!rawData) {
    // Chromium does not expose drag data until drop. The MIME type is still scoped
    // by the active strip, whose drag lifecycle controls target visibility.
    return true;
  }

  try {
    return (JSON.parse(rawData) as Partial<DockTabDragPayload>).scope === scope;
  } catch {
    return false;
  }
}

export function readDockTabDragData(
  dataTransfer: DataTransfer | null,
  scope: string
): DockTabDragDetail | null {
  const rawData = dataTransfer?.getData(DOCK_TAB_DRAG_MIME);

  if (!rawData) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawData) as Partial<DockTabDragPayload>;

    if (
      parsed.scope !== scope ||
      typeof parsed.tabId !== 'string' ||
      (parsed.sourceZoneId !== undefined && typeof parsed.sourceZoneId !== 'string')
    ) {
      return null;
    }

    return {
      tabId: parsed.tabId,
      sourceZoneId: parsed.sourceZoneId
    };
  } catch {
    return null;
  }
}
