import { tick } from 'svelte';
import { libraryViewSettings } from '$lib/stores/library-view-settings';
import { TRACK_LIST_VIRTUALIZATION_THRESHOLD } from './track-list-virtualization';
import type { LibraryGroupViewId, LibraryViewId, TrackItem, TrackSelection, WorkspaceLibraryGroupRequest } from '$lib/types';
import type { LibraryGroup } from './library-views';

export function findRequestedLibraryGroup(
  request: WorkspaceLibraryGroupRequest | null,
  activeView: LibraryViewId,
  groups: LibraryGroup[]
): LibraryGroup | null {
  if (!request || activeView !== request.view) return null;

  return groups.find((group) =>
    group.key === request.groupKey
    && group.items.some((item) => item.id === request.trackId)
  ) ?? null;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function resolveActiveLibraryView(
  libraryMode: boolean,
  ratingsEnabled: boolean,
  storedActiveView: LibraryViewId
): LibraryViewId {
  return libraryMode
    ? !ratingsEnabled && storedActiveView === 'ratings'
      ? 'songs'
      : storedActiveView
    : 'songs';
}

export function clearSelection(
  selectedIds: string[],
  onSetSelection: (selection: TrackSelection) => void
): void {
  if (selectedIds.length === 0) return;

  onSetSelection({
    ids: [],
    anchorId: null,
    focusId: null
  });
}

export function handleLibraryGroupUnpin(groupView: LibraryGroupViewId | null, key: string): void {
  if (!groupView) return;
  libraryViewSettings.unpinGroup(groupView, key);
}

export function handleLibraryGroupMove(
  groupView: LibraryGroupViewId | null,
  detail: { key: string; targetKey: string; position: 'before' | 'after' }
): void {
  if (!groupView) return;
  libraryViewSettings.movePinnedGroup(groupView, detail.key, detail.targetKey, detail.position);
}

export function handleLibraryViewChange(
  view: LibraryViewId,
  activeLibraryView: LibraryViewId,
  hasSelectedGroup: boolean,
  deps: {
    onClearSelectedGroup: () => void;
    onBack: () => void;
    onClearSelection: () => void;
    onScrollToTop: () => void;
  }
): void {
  if (view === activeLibraryView) {
    if (hasSelectedGroup) deps.onBack();
    return;
  }

  deps.onClearSelectedGroup();
  deps.onClearSelection();
  libraryViewSettings.setActiveView(view);
  deps.onScrollToTop();
}

export function handleLibraryGroupOpen(
  key: string,
  activeLibraryView: LibraryViewId,
  scrollPositions: Map<LibraryViewId, number>,
  deps: {
    scrollTop: number;
    onSelectGroup: (key: string) => void;
    onClearSelection: () => void;
    onScrollToTop: () => void;
  }
): void {
  scrollPositions.set(activeLibraryView, deps.scrollTop);
  deps.onSelectGroup(key);
  deps.onClearSelection();
  deps.onScrollToTop();
}

export async function handleLibraryGroupBack(
  activeLibraryView: LibraryViewId,
  scrollPositions: Map<LibraryViewId, number>,
  deps: {
    onSelectGroup: (key: string | null) => void;
    onClearSelection: () => void;
    onScrollTo: (top: number) => void;
    onUpdateQueueHeaderState: () => void;
  }
): Promise<void> {
  const scrollTop = scrollPositions.get(activeLibraryView) ?? 0;
  deps.onSelectGroup(null);
  deps.onClearSelection();
  await tick();
  deps.onScrollTo(scrollTop);
  deps.onUpdateQueueHeaderState();
}

export async function scrollTrackIntoView(
  id: string,
  deps: {
    dropzoneElement: HTMLElement | null;
    displayItems: TrackItem[];
    trackRowHeight: number;
    onDropzoneScrollTop: (top: number) => void;
  }
): Promise<void> {
  const { dropzoneElement } = deps;
  await tick();

  if (!dropzoneElement || typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
    return;
  }

  if (deps.displayItems.length > TRACK_LIST_VIRTUALIZATION_THRESHOLD) {
    const index = deps.displayItems.findIndex((item) => item.id === id);
    if (index < 0) return;

    const centeredTop = index * deps.trackRowHeight - (dropzoneElement.clientHeight - deps.trackRowHeight) / 2;
    const maxScrollTop = Math.max(deps.displayItems.length * deps.trackRowHeight - dropzoneElement.clientHeight, 0);
    dropzoneElement.scrollTo({ top: clamp(centeredTop, 0, maxScrollTop) });
    deps.onDropzoneScrollTop(dropzoneElement.scrollTop);
    await tick();
    return;
  }

  const row = dropzoneElement.querySelector<HTMLElement>(`[data-track-id="${CSS.escape(id)}"]`);

  if (!row) {
    return;
  }

  const visibleHeight = Math.max(dropzoneElement.clientHeight, row.offsetHeight);
  const rowTop = row.offsetTop;
  const centeredTop = rowTop - (visibleHeight - row.offsetHeight) / 2;
  const maxScrollTop = Math.max(dropzoneElement.scrollHeight - dropzoneElement.clientHeight, 0);
  dropzoneElement.scrollTo({
    top: clamp(centeredTop, 0, maxScrollTop)
  });
}

export async function openRequestedLibraryGroup(
  request: WorkspaceLibraryGroupRequest,
  group: LibraryGroup,
  libraryMode: boolean,
  deps: {
    onCollapseSearch: () => void;
    onSelectGroup: (key: string) => void;
    onSetSelection: (selection: TrackSelection) => void;
    onScrollTrackIntoView: (id: string) => Promise<void>;
    onHandled: (token: number) => void;
  }
): Promise<void> {
  if (!libraryMode) return;

  try {
    libraryViewSettings.setSearchQuery('');
    deps.onCollapseSearch();
    deps.onSelectGroup(group.key);
    deps.onSetSelection({
      ids: [request.trackId],
      anchorId: request.trackId,
      focusId: request.trackId
    });
    await deps.onScrollTrackIntoView(request.trackId);
  } finally {
    deps.onHandled(request.token);
  }
}
