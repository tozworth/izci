import { tick } from 'svelte';
import { buildOrderedSelection } from './selection';
import { buildSelectAllSelection } from '$lib/stores/queue-selection';
import { clamp } from './library-group-navigation';
import type { TrackListPanelContextMenu } from './context-menu';
import type { TrackItem, TrackSelection } from '$lib/types';

export function handleWindowKeydown(
  event: KeyboardEvent,
  deps: {
    displayItems: TrackItem[];
    displaySelectedIds: string[];
    displaySelectionAnchorId: string | null;
    dropzoneElement: HTMLElement | null;
    onSetSelection: (selection: TrackSelection) => void;
    onFocusTrackRow: (id: string) => void;
    onDismiss: () => void;
  }
): void {
  if (event.key === 'Escape') {
    deps.onDismiss();
    return;
  }

  if (
    (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    event.target instanceof Element &&
    deps.dropzoneElement?.contains(event.target)
  ) {
    const currentRow = event.target.closest<HTMLElement>('[data-track-id]');
    const currentIndex = currentRow
      ? deps.displayItems.findIndex((item) => item.id === currentRow.dataset.trackId)
      : -1;

    if (currentIndex < 0) {
      return;
    }

    const nextIndex = clamp(currentIndex + (event.key === 'ArrowUp' ? -1 : 1), 0, deps.displayItems.length - 1);
    const nextItem = deps.displayItems[nextIndex];
    event.preventDefault();

    if (!nextItem || nextIndex === currentIndex) {
      return;
    }

    deps.onSetSelection(
      buildOrderedSelection(deps.displayItems, deps.displaySelectedIds, deps.displaySelectionAnchorId, nextItem.id, event.shiftKey, false)
    );
    void deps.onFocusTrackRow(nextItem.id);
  }
}

export function handleWindowKeydownCapture(
  event: KeyboardEvent,
  deps: {
    keyboardActive: boolean;
    showTrackRows: boolean;
    displayItems: TrackItem[];
    contextMenu: TrackListPanelContextMenu | null;
    libraryMode: boolean;
    selectedGroupKey: string | null;
    onSetSelection: (selection: TrackSelection) => void;
    onDismiss: () => void;
    onLibraryGroupBack: () => void;
  }
): void {
  const editingTarget = event.target instanceof HTMLElement
    && (event.target.matches('input, textarea, select') || event.target.isContentEditable);

  if (
    deps.keyboardActive
    && event.key.toLowerCase() === 'a'
    && event.ctrlKey
    && !event.altKey
    && !event.shiftKey
    && !event.metaKey
    && !editingTarget
  ) {
    event.preventDefault();
    event.stopImmediatePropagation();

    if (deps.showTrackRows) {
      deps.onSetSelection(buildSelectAllSelection(deps.displayItems));
    }
    return;
  }

  if (
    event.key !== 'Escape' ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey ||
    event.target instanceof HTMLInputElement
  ) {
    return;
  }

  if (deps.contextMenu) {
    event.preventDefault();
    event.stopImmediatePropagation();
    deps.onDismiss();
    return;
  }

  if (deps.libraryMode && deps.selectedGroupKey !== null) {
    event.preventDefault();
    event.stopImmediatePropagation();
    deps.onDismiss();
    void deps.onLibraryGroupBack();
  }
}

export async function focusTrackRow(
  id: string,
  deps: {
    dropzoneElement: HTMLElement | null;
    onScrollTrackIntoView: (id: string) => Promise<void>;
  }
): Promise<void> {
  await deps.onScrollTrackIntoView(id);
  await tick();

  if (!deps.dropzoneElement || typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
    return;
  }

  const rowButton = deps.dropzoneElement.querySelector<HTMLButtonElement>(
    `[data-track-id="${CSS.escape(id)}"] [data-track-row-button]`
  );
  rowButton?.focus();
}
