import type { WorkspacePanelId, WorkspaceTab } from '$lib/types';

export const WORKSPACE_TAB_DRAG_MIME = 'application/x-izci-workspace-tab';

export interface WorkspaceTabDragData {
  tabId: WorkspaceTab;
  sourcePanelId?: WorkspacePanelId;
}

function isWorkspaceTab(value: unknown): value is WorkspaceTab {
  return (
    value === 'playlist' ||
    value === 'library' ||
    value === 'details' ||
    value === 'lyrics'
  );
}

function isWorkspacePanelId(value: unknown): value is WorkspacePanelId {
  return value === 'left' || value === 'center' || value === 'right';
}

export function writeWorkspaceTabDragData(
  dataTransfer: DataTransfer,
  data: WorkspaceTabDragData
): void {
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(WORKSPACE_TAB_DRAG_MIME, JSON.stringify(data));
  dataTransfer.setData('text/plain', data.tabId);
}

export function hasWorkspaceTabDragData(dataTransfer: DataTransfer | null): boolean {
  return Boolean(
    dataTransfer && Array.from(dataTransfer.types).includes(WORKSPACE_TAB_DRAG_MIME)
  );
}

export function readWorkspaceTabDragData(
  dataTransfer: DataTransfer | null
): WorkspaceTabDragData | null {
  const rawData = dataTransfer?.getData(WORKSPACE_TAB_DRAG_MIME);

  if (!rawData) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawData) as Partial<WorkspaceTabDragData>;

    if (!isWorkspaceTab(parsed.tabId)) {
      return null;
    }

    return {
      tabId: parsed.tabId,
      sourcePanelId: isWorkspacePanelId(parsed.sourcePanelId)
        ? parsed.sourcePanelId
        : undefined
    };
  } catch {
    return null;
  }
}
