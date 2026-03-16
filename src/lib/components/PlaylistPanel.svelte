<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { onDestroy } from 'svelte';
  import { tick } from 'svelte';
  import {
    LIBRARY_COLUMN_LABELS,
    LIBRARY_COLUMN_MIN_WIDTHS,
    libraryViewSettings
  } from '$lib/stores/library-view-settings';
  import type {
    LibraryColumnId,
    LibraryViewSortState,
    PlaylistItem,
    PlaylistRepeatMode,
    PlaylistSelection
  } from '$lib/types';
  import {
    extractDroppedFiles,
    formatDuration,
    getTrackDisplayTitle,
    resolveModuleTrackerName
  } from '$lib/utils/files';

  export let items: PlaylistItem[] = [];
  export let selectedIds: string[] = [];
  export let selectionAnchorId: string | null = null;
  export let playingId: string | null = null;
  export let panelTitle = 'Playlist';
  export let regionLabel = 'Playlist';
  export let layout: 'list' | 'columns' = 'list';
  export let hideEyebrow = false;
  export let showShuffleControl = true;
  export let showRepeatControl = true;
  export let showSearchControl = false;
  export let shuffleEnabled = false;
  export let repeatMode: PlaylistRepeatMode = 'off';
  export let getContextMenuActions: (ids: string[]) => Array<{ id: string; label: string }> = () => [
    { id: 'remove', label: 'Remove' }
  ];

  const dispatch = createEventDispatcher<{
    addFiles: FileList | File[];
    openFiles: void;
    select: { id: string; range: boolean; toggle: boolean };
    setSelection: PlaylistSelection;
    activate: string;
    contextAction: { actionId: string; ids: string[] };
    toggleShuffle: void;
    cycleRepeat: void;
  }>();

  let contextMenu:
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
      }
    | null = null;
  let contextMenuElement: HTMLDivElement | null = null;
  let dropzoneElement: HTMLDivElement | null = null;
  let searchInputElement: HTMLInputElement | null = null;
  let playlistHeaderCovered = false;
  let dropzoneWidth = 0;
  let searchInputExpanded = false;
  let draggedColumnId: LibraryColumnId | null = null;
  let dropIndicator:
    | {
        columnId: LibraryColumnId;
        position: 'before' | 'after';
      }
    | null = null;
  let pendingDragColumnId: LibraryColumnId | null = null;
  let pendingDragStartX = 0;
  let resizingColumnId: LibraryColumnId | null = null;
  let resizeStartX = 0;
  let resizeStartWidths: Partial<Record<LibraryColumnId, number>> = {};

  const stringCollator = new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: 'base'
  });
  const COLUMN_GAP = 12;
  const TABLE_SIDE_PADDING = 27.2;
  const EXCLUDED_SEARCH_ROOT_KEYS = new Set(['id', 'file', 'fileHandle', 'objectUrl', 'extension']);
  const EXCLUDED_METADATA_SEARCH_KEYS = new Set(['duration']);

  async function handleDrop(event: DragEvent) {
    event.preventDefault();

    if (!event.dataTransfer) {
      return;
    }

    const files = await extractDroppedFiles(event.dataTransfer);

    if (files.length > 0) {
      dispatch('addFiles', files);
    }
  }

  function formatTrackType(item: PlaylistItem): string {
    return item.extension.toUpperCase();
  }

  function getTrackDuration(item: PlaylistItem): string {
    const duration = item.metadata?.duration ?? 0;
    return Number.isFinite(duration) && duration > 0 ? formatDuration(duration) : '';
  }

  function isToggleSelection(event: MouseEvent): boolean {
    return event.ctrlKey || event.metaKey;
  }

  function getOrderedIds(ids: Iterable<string>): string[] {
    const idSet = new Set(ids);
    return displayItems.filter((item) => idSet.has(item.id)).map((item) => item.id);
  }

  function getRangeIds(fromId: string, toId: string): string[] {
    const orderedIds = displayItems.map((item) => item.id);
    const fromIndex = orderedIds.indexOf(fromId);
    const toIndex = orderedIds.indexOf(toId);

    if (fromIndex === -1 || toIndex === -1) {
      return [toId];
    }

    const start = Math.min(fromIndex, toIndex);
    const end = Math.max(fromIndex, toIndex);

    return orderedIds.slice(start, end + 1);
  }

  function buildOrderedSelection(id: string, range: boolean, toggle: boolean): PlaylistSelection {
    const orderedSelectedIds = getOrderedIds(selectedIds);

    if (range) {
      const anchorId = selectionAnchorId && displayItems.some((item) => item.id === selectionAnchorId) ? selectionAnchorId : id;
      const rangeIds = getRangeIds(anchorId, id);

      return {
        ids: toggle ? getOrderedIds(new Set([...orderedSelectedIds, ...rangeIds])) : rangeIds,
        anchorId,
        focusId: id
      };
    }

    if (toggle) {
      const ids = orderedSelectedIds.includes(id)
        ? orderedSelectedIds.filter((selectedId) => selectedId !== id)
        : getOrderedIds([...orderedSelectedIds, id]);

      return {
        ids,
        anchorId: ids.length > 0 ? id : null,
        focusId: ids.includes(id) ? id : ids.at(-1) ?? null
      };
    }

    return {
      ids: [id],
      anchorId: id,
      focusId: id
    };
  }

  function emitSelection(event: MouseEvent, id: string) {
    if (layout === 'columns') {
      dispatch('setSelection', buildOrderedSelection(id, event.shiftKey, isToggleSelection(event)));
      return;
    }

    dispatch('select', {
      id,
      range: event.shiftKey,
      toggle: isToggleSelection(event)
    });
  }

  function handleItemClick(event: MouseEvent, id: string) {
    emitSelection(event, id);
    closeContextMenu();
  }

  function handleItemDoubleClick(id: string) {
    dispatch('activate', id);
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  async function handleItemContextMenu(event: MouseEvent, id: string) {
    event.preventDefault();

    if (!dropzoneElement) {
      return;
    }

    const itemIsSelected = selectedIds.includes(id);
    const bounds = dropzoneElement.getBoundingClientRect();

    if (!itemIsSelected) {
      if (layout === 'columns') {
        dispatch('setSelection', {
          ids: [id],
          anchorId: id,
          focusId: id
        });
      } else {
        dispatch('select', {
          id,
          range: false,
          toggle: false
        });
      }
    }

    contextMenu = {
      kind: 'items',
      x: event.clientX - bounds.left + dropzoneElement.scrollLeft,
      y: event.clientY - bounds.top + dropzoneElement.scrollTop,
      ids: itemIsSelected ? selectedIds : [id]
    };

    await tick();
    clampContextMenu();
  }

  async function handleColumnContextMenu(event: MouseEvent) {
    if (layout !== 'columns' || isCompactColumnLayout || !dropzoneElement) {
      return;
    }

    event.preventDefault();
    const bounds = dropzoneElement.getBoundingClientRect();
    contextMenu = {
      kind: 'columns',
      x: event.clientX - bounds.left + dropzoneElement.scrollLeft,
      y: event.clientY - bounds.top + dropzoneElement.scrollTop
    };

    await tick();
    clampContextMenu();
  }

  function handleWindowPointerDown(event: PointerEvent) {
    if (!contextMenu) {
      return;
    }

    const target = event.target;

    if (target instanceof Node && contextMenuElement?.contains(target)) {
      return;
    }

    closeContextMenu();
  }

  function clearColumnInteractions() {
    draggedColumnId = null;
    pendingDragColumnId = null;
    dropIndicator = null;
    resizingColumnId = null;
  }

  function handleWindowDismiss() {
    closeContextMenu();
    clearColumnInteractions();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      handleWindowDismiss();
    }
  }

  function clampContextMenu() {
    if (!contextMenu || !contextMenuElement || !dropzoneElement) {
      return;
    }

    const padding = 8;
    const minX = dropzoneElement.scrollLeft + padding;
    const minY = dropzoneElement.scrollTop + padding;
    const maxX = dropzoneElement.scrollLeft + dropzoneElement.clientWidth - contextMenuElement.offsetWidth - padding;
    const maxY = dropzoneElement.scrollTop + dropzoneElement.clientHeight - contextMenuElement.offsetHeight - padding;

    contextMenu = {
      ...contextMenu,
      x: Math.max(minX, Math.min(contextMenu.x, maxX)),
      y: Math.max(minY, Math.min(contextMenu.y, maxY))
    };
  }

  function updatePlaylistHeaderState() {
    playlistHeaderCovered = (dropzoneElement?.scrollTop ?? 0) > 0;
  }

  function handleContextAction(actionId: string) {
    if (!contextMenu || contextMenu.kind !== 'items') {
      return;
    }

    dispatch('contextAction', {
      actionId,
      ids: contextMenu.ids
    });
    closeContextMenu();
  }

  function getColumnTextValue(item: PlaylistItem, columnId: LibraryColumnId): string {
    switch (columnId) {
      case 'title':
        return getTrackDisplayTitle(item);
      case 'artist':
        return item.metadata?.artist?.trim() ?? '';
      case 'format':
        return formatTrackType(item);
      case 'duration':
        return getTrackDuration(item);
    }
  }

  function isRightAlignedColumn(columnId: LibraryColumnId): boolean {
    return columnId === 'format' || columnId === 'duration';
  }

  function collectSearchValues(value: unknown, excludedKeys: Set<string> | null = null): string[] {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed ? [trimmed] : [];
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return [String(value)];
    }

    if (!value) {
      return [];
    }

    if (Array.isArray(value)) {
      return value.flatMap((entry) => collectSearchValues(entry));
    }

    if (typeof value !== 'object') {
      return [];
    }

    return Object.entries(value).flatMap(([key, entry]) => {
      if (excludedKeys?.has(key)) {
        return [];
      }

      if (key === 'metadata' && entry && typeof entry === 'object') {
        return collectSearchValues(entry, EXCLUDED_METADATA_SEARCH_KEYS);
      }

      return collectSearchValues(entry);
    });
  }

  function matchesSearchQuery(item: PlaylistItem, query: string): boolean {
    if (!query) {
      return true;
    }

    const normalizedQuery = query.toLocaleLowerCase();
    const searchValues = [
      ...collectSearchValues(item, EXCLUDED_SEARCH_ROOT_KEYS),
      resolveModuleTrackerName(item.extension, item.metadata?.trackerType)
    ];

    return searchValues.some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
  }

  async function handleSearchToggle() {
    searchInputExpanded = true;
    await tick();
    searchInputElement?.focus();
    searchInputElement?.select();
  }

  function handleSearchInput(event: Event) {
    libraryViewSettings.setSearchQuery((event.currentTarget as HTMLInputElement).value);
  }

  function handleSearchClose() {
    searchInputExpanded = false;
    libraryViewSettings.setSearchQuery('');
    searchInputElement?.blur();
  }

  function handleSearchKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') {
      return;
    }

    event.stopPropagation();
    handleSearchClose();
  }

  function fitWidthsToAvailableWidth(
    columns: Array<{ id: LibraryColumnId; width: number }>,
    availableWidth: number
  ): Partial<Record<LibraryColumnId, number>> {
    if (columns.length === 0) {
      return {};
    }

    const safeAvailableWidth = Math.max(0, availableWidth);
    const minTotal = columns.reduce((sum, column) => sum + LIBRARY_COLUMN_MIN_WIDTHS[column.id], 0);

    if (safeAvailableWidth <= minTotal) {
      const scale = minTotal > 0 ? safeAvailableWidth / minTotal : 1;

      return Object.fromEntries(
        columns.map((column) => [column.id, LIBRARY_COLUMN_MIN_WIDTHS[column.id] * scale])
      );
    }

    const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);

    if (totalWidth <= safeAvailableWidth) {
      const extra = safeAvailableWidth - totalWidth;
      const totalBasis = totalWidth || columns.length;

      return Object.fromEntries(
        columns.map((column) => {
          const share = totalBasis > 0 ? (column.width || 1) / totalBasis : 1 / columns.length;
          return [column.id, column.width + extra * share];
        })
      );
    }

    const nextWidths = Object.fromEntries(columns.map((column) => [column.id, column.width])) as Partial<
      Record<LibraryColumnId, number>
    >;
    let remainingOverflow = totalWidth - safeAvailableWidth;
    let adjustableColumns = columns.map((column) => column.id);

    while (remainingOverflow > 0.5 && adjustableColumns.length > 0) {
      const shrinkCapacity = adjustableColumns.reduce(
        (sum, columnId) => sum + Math.max(0, (nextWidths[columnId] ?? 0) - LIBRARY_COLUMN_MIN_WIDTHS[columnId]),
        0
      );

      if (shrinkCapacity <= 0) {
        break;
      }

      const clampedColumns: LibraryColumnId[] = [];

      for (const columnId of adjustableColumns) {
        const currentWidth = nextWidths[columnId] ?? 0;
        const capacity = Math.max(0, currentWidth - LIBRARY_COLUMN_MIN_WIDTHS[columnId]);
        const reduction = Math.min(capacity, (remainingOverflow * capacity) / shrinkCapacity);
        const nextWidth = currentWidth - reduction;

        nextWidths[columnId] = nextWidth;

        if (nextWidth - LIBRARY_COLUMN_MIN_WIDTHS[columnId] <= 0.5) {
          nextWidths[columnId] = LIBRARY_COLUMN_MIN_WIDTHS[columnId];
          clampedColumns.push(columnId);
        }
      }

      const resolvedTotal = columns.reduce((sum, column) => sum + (nextWidths[column.id] ?? 0), 0);
      remainingOverflow = resolvedTotal - safeAvailableWidth;
      adjustableColumns = adjustableColumns.filter((columnId) => !clampedColumns.includes(columnId));
    }

    return nextWidths;
  }

  function rebalanceResizedColumns(
    baseWidths: Partial<Record<LibraryColumnId, number>>,
    columnId: LibraryColumnId,
    delta: number
  ): Partial<Record<LibraryColumnId, number>> {
    const widths = { ...baseWidths };
    const otherColumns = visibleColumns.filter((column) => column.id !== columnId).map((column) => column.id);
    const currentWidth = widths[columnId] ?? 0;
    const targetWidth = Math.max(LIBRARY_COLUMN_MIN_WIDTHS[columnId], currentWidth + delta);

    if (targetWidth > currentWidth) {
      let remainingIncrease = targetWidth - currentWidth;
      let adjustableColumns = [...otherColumns];

      while (remainingIncrease > 0.5 && adjustableColumns.length > 0) {
        const shrinkCapacity = adjustableColumns.reduce(
          (sum, id) => sum + Math.max(0, (widths[id] ?? 0) - LIBRARY_COLUMN_MIN_WIDTHS[id]),
          0
        );

        if (shrinkCapacity <= 0) {
          break;
        }

        const clampedColumns: LibraryColumnId[] = [];
        let reducedWidth = 0;

        for (const id of adjustableColumns) {
          const width = widths[id] ?? 0;
          const capacity = Math.max(0, width - LIBRARY_COLUMN_MIN_WIDTHS[id]);
          const reduction = Math.min(capacity, (remainingIncrease * capacity) / shrinkCapacity);

          widths[id] = width - reduction;
          reducedWidth += reduction;

          if ((widths[id] ?? 0) - LIBRARY_COLUMN_MIN_WIDTHS[id] <= 0.5) {
            widths[id] = LIBRARY_COLUMN_MIN_WIDTHS[id];
            clampedColumns.push(id);
          }
        }

        remainingIncrease = Math.max(0, remainingIncrease - reducedWidth);
        adjustableColumns = adjustableColumns.filter((id) => !clampedColumns.includes(id));
      }

      const actualIncrease = otherColumns.reduce((sum, id) => sum + (baseWidths[id] ?? 0) - (widths[id] ?? 0), 0);
      widths[columnId] = currentWidth + actualIncrease;
      return widths;
    }

    const actualReduction = Math.max(0, currentWidth - targetWidth);
    const totalOtherWidth = otherColumns.reduce((sum, id) => sum + (widths[id] ?? 0), 0);

    for (const id of otherColumns) {
      const basis = totalOtherWidth > 0 ? (widths[id] ?? 0) / totalOtherWidth : 1 / otherColumns.length;
      widths[id] = (widths[id] ?? 0) + actualReduction * basis;
    }

    widths[columnId] = targetWidth;
    return widths;
  }

  function compareByColumn(
    left: PlaylistItem,
    right: PlaylistItem,
    columnId: LibraryColumnId,
    direction: 'asc' | 'desc'
  ): number {
    if (columnId === 'duration') {
      const leftDuration = left.metadata?.duration ?? 0;
      const rightDuration = right.metadata?.duration ?? 0;
      const leftMissing = !Number.isFinite(leftDuration) || leftDuration <= 0;
      const rightMissing = !Number.isFinite(rightDuration) || rightDuration <= 0;

      if (leftMissing || rightMissing) {
        if (leftMissing && rightMissing) {
          return 0;
        }

        return leftMissing ? 1 : -1;
      }

      return direction === 'desc' ? rightDuration - leftDuration : leftDuration - rightDuration;
    }

    const leftValue = getColumnTextValue(left, columnId).trim();
    const rightValue = getColumnTextValue(right, columnId).trim();
    const leftMissing = leftValue === '';
    const rightMissing = rightValue === '';

    if (leftMissing || rightMissing) {
      if (leftMissing && rightMissing) {
        return 0;
      }

      return leftMissing ? 1 : -1;
    }

    return direction === 'desc' ? stringCollator.compare(rightValue, leftValue) : stringCollator.compare(leftValue, rightValue);
  }

  function compareItems(left: PlaylistItem, right: PlaylistItem, sort: LibraryViewSortState): number {
    const { columnId, direction } = sort;
    const comparison = compareByColumn(left, right, columnId, direction);

    if (comparison !== 0) {
      return comparison;
    }

    const titleComparison = stringCollator.compare(getTrackDisplayTitle(left), getTrackDisplayTitle(right));

    if (titleComparison !== 0) {
      return titleComparison;
    }

    return stringCollator.compare(left.name, right.name);
  }

  function handleColumnSort(columnId: LibraryColumnId) {
    libraryViewSettings.setSort(columnId);
  }

  function handleColumnVisibilityChange(columnId: LibraryColumnId, visible: boolean) {
    libraryViewSettings.setColumnVisibility(columnId, visible);
  }

  function handleColumnResizeStart(event: PointerEvent, columnId: LibraryColumnId) {
    if (layout !== 'columns') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    resizingColumnId = columnId;
    resizeStartX = event.clientX;
    resizeStartWidths = Object.fromEntries(visibleColumns.map((column) => [column.id, column.width]));
    closeContextMenu();
  }

  function handleColumnPointerDown(event: PointerEvent, columnId: LibraryColumnId) {
    if (layout !== 'columns' || isCompactColumnLayout || resizingColumnId) {
      return;
    }

    const target = event.target;

    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest('.track-column-resizer')) {
      return;
    }

    pendingDragColumnId = columnId;
    pendingDragStartX = event.clientX;
  }

  function handleColumnPointerEnter(event: PointerEvent, columnId: LibraryColumnId) {
    if (!draggedColumnId || draggedColumnId === columnId) {
      return;
    }

    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();

    dropIndicator = {
      columnId,
      position: event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after'
    };
  }

  function handleWindowPointerMove(event: PointerEvent) {
    if (resizingColumnId) {
      libraryViewSettings.setColumnWidths(
        rebalanceResizedColumns(resizeStartWidths, resizingColumnId, event.clientX - resizeStartX)
      );
      return;
    }

    if (!draggedColumnId && pendingDragColumnId) {
      if (Math.abs(event.clientX - pendingDragStartX) < 6) {
        return;
      }

      draggedColumnId = pendingDragColumnId;
      dropIndicator = null;
    }
  }

  function handleWindowPointerUp() {
    if (draggedColumnId && dropIndicator) {
      libraryViewSettings.moveColumn(draggedColumnId, dropIndicator.columnId, dropIndicator.position);
    }

    resizingColumnId = null;
    pendingDragColumnId = null;
    draggedColumnId = null;
    dropIndicator = null;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', handleWindowPointerDown);
    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('keydown', handleWindowKeydown);
    window.addEventListener('scroll', closeContextMenu, true);
    window.addEventListener('blur', handleWindowDismiss);
    window.addEventListener('resize', handleWindowDismiss);
  }

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', handleWindowPointerDown);
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('keydown', handleWindowKeydown);
      window.removeEventListener('scroll', closeContextMenu, true);
      window.removeEventListener('blur', handleWindowDismiss);
      window.removeEventListener('resize', handleWindowDismiss);
    }
  });

  function formatTotalDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return '--:--';
    }

    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainingSeconds = total % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    }

    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  $: searchQuery = showSearchControl ? $libraryViewSettings.searchQuery : '';
  $: normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  $: showSearchInput = showSearchControl && (searchInputExpanded || searchQuery !== '');
  $: filteredItems = normalizedSearchQuery ? items.filter((item) => matchesSearchQuery(item, normalizedSearchQuery)) : items;
  $: totalDuration = filteredItems.reduce((sum, item) => {
    const duration = item.metadata?.duration ?? 0;
    return Number.isFinite(duration) && duration > 0 ? sum + duration : sum;
  }, 0);

  $: trackSummary =
    normalizedSearchQuery && filteredItems.length !== items.length
      ? `${filteredItems.length} of ${items.length} song${items.length === 1 ? '' : 's'} · ${formatTotalDuration(totalDuration)}`
      : `${filteredItems.length} song${filteredItems.length === 1 ? '' : 's'} · ${formatTotalDuration(totalDuration)}`;
  $: repeatIcon = repeatMode === 'one' ? 'repeat_one' : 'repeat';
  $: repeatLabel =
    repeatMode === 'one' ? 'Repeat current track' : repeatMode === 'all' ? 'Repeat playlist' : 'Repeat off';
  $: contextMenuActions = contextMenu?.kind === 'items' ? getContextMenuActions(contextMenu.ids) : [];
  $: orderedColumns =
    layout === 'columns'
      ? $libraryViewSettings.order.map((columnId) => ({
          id: columnId,
          label: LIBRARY_COLUMN_LABELS[columnId],
          width: $libraryViewSettings.columns[columnId].width,
          visible: $libraryViewSettings.columns[columnId].visible
        }))
      : [];
  $: storedVisibleColumns = orderedColumns.filter((column) => column.visible);
  $: visibleColumnCount = storedVisibleColumns.length;
  $: isCompactColumnLayout = layout === 'columns' && dropzoneWidth > 0 && dropzoneWidth < 350;
  $: activeSort = $libraryViewSettings.sort;
  $: tableInnerWidth = Math.max(0, dropzoneWidth - TABLE_SIDE_PADDING);
  $: availableColumnWidth = Math.max(0, tableInnerWidth - Math.max(0, visibleColumnCount - 1) * COLUMN_GAP);
  $: resolvedColumnWidths =
    layout === 'columns'
      ? fitWidthsToAvailableWidth(
          storedVisibleColumns.map((column) => ({
            id: column.id,
            width: column.width
          })),
          availableColumnWidth
        )
      : {};
  $: visibleColumns = storedVisibleColumns.map((column) => ({
    ...column,
    width: resolvedColumnWidths[column.id] ?? column.width
  }));
  $: displayItems =
    layout === 'columns' ? [...filteredItems].sort((left, right) => compareItems(left, right, activeSort)) : filteredItems;
  $: tableTemplateColumns = visibleColumns.map((column) => `minmax(${column.width}px, ${column.width}px)`).join(' ');
  $: if (contextMenu?.kind === 'columns' && (layout !== 'columns' || isCompactColumnLayout)) {
    closeContextMenu();
  }
  $: if (!showSearchControl) {
    searchInputExpanded = false;
  }
  $: if (items) {
    tick().then(() => updatePlaylistHeaderState());
  }
</script>

<section class="panel playlist-panel">
  <div
    bind:this={dropzoneElement}
    bind:clientWidth={dropzoneWidth}
    class="dropzone playlist-dropzone"
    role="region"
    aria-label={`${regionLabel} list`}
    on:dragover|preventDefault
    on:drop={handleDrop}
    on:scroll={updatePlaylistHeaderState}
  >
    <div class="panel-header playlist-panel-header" class:is-covered={playlistHeaderCovered}>
      <div class="playlist-header-main">
        <div class="panel-heading">
          {#if !hideEyebrow}
            <p class="eyebrow">{panelTitle}</p>
          {/if}
          <p class="panel-summary">{trackSummary}</p>
        </div>
        <div class="playlist-actions">
          {#if showSearchControl}
            <button
              type="button"
              class="playlist-action-button"
              class:active={showSearchInput}
              aria-label="Search library"
              title="Search library"
              on:click={() => void handleSearchToggle()}
            >
              <span class="material-symbols-outlined" aria-hidden="true">search</span>
            </button>
            {#if showSearchInput}
              <div class="playlist-search-inline">
                <span class="material-symbols-outlined" aria-hidden="true">search</span>
                <input
                  bind:this={searchInputElement}
                  type="search"
                  inputmode="search"
                  spellcheck="false"
                  autocomplete="off"
                  placeholder="Filter library"
                  aria-label="Filter library"
                  value={searchQuery}
                  on:input={handleSearchInput}
                  on:keydown={handleSearchKeydown}
                />
                <button
                  type="button"
                  class="playlist-search-close"
                  aria-label="Close library search"
                  title="Close library search"
                  on:click={handleSearchClose}
                >
                  <span class="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              </div>
            {/if}
          {/if}
          {#if showShuffleControl}
            <button
              type="button"
              class="playlist-action-button"
              class:active={shuffleEnabled}
              aria-label={shuffleEnabled ? 'Disable shuffle' : 'Enable shuffle'}
              title={shuffleEnabled ? 'Shuffle on' : 'Shuffle off'}
              on:click={() => dispatch('toggleShuffle')}
            >
              <span class="material-symbols-outlined" aria-hidden="true">shuffle</span>
            </button>
          {/if}
          {#if showRepeatControl}
            <button
              type="button"
              class="playlist-action-button"
              class:active={repeatMode !== 'off'}
              aria-label={repeatLabel}
              title={repeatLabel}
              on:click={() => dispatch('cycleRepeat')}
            >
              <span class="material-symbols-outlined" aria-hidden="true">{repeatIcon}</span>
            </button>
          {/if}
          <button
            type="button"
            class="playlist-add-files"
            aria-label="Add files"
            title="Add files"
            on:click={() => dispatch('openFiles')}
          >
            <span class="material-symbols-outlined" aria-hidden="true">add</span>
          </button>
        </div>
      </div>

      {#if items.length > 0 && layout === 'columns' && !isCompactColumnLayout}
        <div class="track-columns-header" role="row" style={`--track-table-columns: ${tableTemplateColumns};`}>
          {#each visibleColumns as column}
            <div
              class="track-column-header"
              class:is-sorted={$libraryViewSettings.sort.columnId === column.id}
              class:is-right-aligned={isRightAlignedColumn(column.id)}
              class:drop-before={dropIndicator?.columnId === column.id && dropIndicator.position === 'before'}
              class:drop-after={dropIndicator?.columnId === column.id && dropIndicator.position === 'after'}
              role="columnheader"
              tabindex="-1"
              aria-sort={
                $libraryViewSettings.sort.columnId === column.id
                  ? $libraryViewSettings.sort.direction === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : 'none'
              }
              on:pointerdown={(event) => handleColumnPointerDown(event, column.id)}
              on:pointerenter={(event) => handleColumnPointerEnter(event, column.id)}
              on:contextmenu={handleColumnContextMenu}
            >
              <button
                type="button"
                class="track-column-sort-button"
                class:is-right-aligned={isRightAlignedColumn(column.id)}
                title={`Sort by ${column.label}`}
                on:click={() => handleColumnSort(column.id)}
              >
                <span class="track-column-sort-content" class:is-right-aligned={isRightAlignedColumn(column.id)}>
                  <span class="track-column-label">{column.label}</span>
                  {#if $libraryViewSettings.sort.columnId === column.id}
                    <span class="material-symbols-outlined track-column-sort-icon" aria-hidden="true">
                      {$libraryViewSettings.sort.direction === 'asc' ? 'arrow_upward' : 'arrow_downward'}
                    </span>
                  {/if}
                </span>
              </button>
              <button
                type="button"
                class="track-column-resizer"
                aria-label={`Resize ${column.label} column`}
                title={`Resize ${column.label} column`}
                on:pointerdown={(event) => handleColumnResizeStart(event, column.id)}
              ></button>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    {#if displayItems.length > 0}
      {#if layout === 'columns' && !isCompactColumnLayout}
        <div class="track-table" style={`--track-table-columns: ${tableTemplateColumns};`}>
          <ul class="track-list track-table-body">
            {#each displayItems as item}
              <li class:selected={selectedIds.includes(item.id)} class:playing={item.id === playingId}>
                <button
                  class="track-table-row-button"
                  type="button"
                  aria-current={item.id === playingId ? 'true' : undefined}
                  on:click={(event) => handleItemClick(event, item.id)}
                  on:dblclick={() => handleItemDoubleClick(item.id)}
                  on:contextmenu={(event) => handleItemContextMenu(event, item.id)}
                >
                  {#each visibleColumns as column}
                    <span
                      class="track-table-cell"
                      class:is-right-aligned={isRightAlignedColumn(column.id)}
                      class:is-duration={column.id === 'duration'}
                      title={getColumnTextValue(item, column.id)}
                    >
                      {getColumnTextValue(item, column.id)}
                    </span>
                  {/each}
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {:else}
        <ul class="track-list">
          {#each displayItems as item}
            <li class:selected={selectedIds.includes(item.id)} class:playing={item.id === playingId}>
              <button
                class="track-row"
                type="button"
                aria-current={item.id === playingId ? 'true' : undefined}
                on:click={(event) => handleItemClick(event, item.id)}
                on:dblclick={() => handleItemDoubleClick(item.id)}
                on:contextmenu={(event) => handleItemContextMenu(event, item.id)}
                title={getTrackDisplayTitle(item)}
              >
                <span class="track-name">{getTrackDisplayTitle(item)}</span>
                <span class="track-meta" class:has-duration={Boolean(getTrackDuration(item))}>
                  <span class="track-format">{formatTrackType(item)}</span>
                  {#if getTrackDuration(item)}
                    <span class="track-duration">{getTrackDuration(item)}</span>
                  {/if}
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

    {:else if items.length > 0 && normalizedSearchQuery}
      <div class="empty-state playlist-filter-empty">
        <p>No tracks match "{searchQuery.trim()}".</p>
      </div>
    {/if}

    {#if contextMenu?.kind === 'items'}
      <div
        bind:this={contextMenuElement}
        class="playlist-context-menu"
        role="menu"
        aria-label={`${panelTitle} item actions`}
        style={`left: ${contextMenu.x}px; top: ${contextMenu.y}px;`}
      >
        {#each contextMenuActions as action}
          <button type="button" role="menuitem" on:click={() => handleContextAction(action.id)}>
            {action.label}
          </button>
        {/each}
      </div>
    {:else if contextMenu?.kind === 'columns'}
      <div
        bind:this={contextMenuElement}
        class="playlist-context-menu"
        role="menu"
        aria-label={`${panelTitle} columns`}
        style={`left: ${contextMenu.x}px; top: ${contextMenu.y}px;`}
      >
        {#each orderedColumns as column}
          <label class="playlist-context-menu-checkbox">
            <input
              type="checkbox"
              checked={column.visible}
              disabled={column.visible && visibleColumnCount === 1}
              on:change={(event) =>
                handleColumnVisibilityChange(column.id, (event.currentTarget as HTMLInputElement).checked)}
            />
            <span>{column.label}</span>
          </label>
        {/each}
      </div>
    {/if}
  </div>
</section>

<style>
  .playlist-panel-header {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .playlist-header-main {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.75rem;
    width: 100%;
  }

  .playlist-header-main .panel-heading {
    flex: 1;
    min-width: 0;
  }

  .playlist-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.7rem;
    margin-left: auto;
    flex-shrink: 0;
    justify-content: flex-end;
    position: relative;
  }

  .playlist-action-button,
  .playlist-add-files {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    background: transparent;
    border: 0;
    color: var(--muted);
    cursor: pointer;
    transition: color 180ms ease;
  }

  .playlist-action-button.active,
  .playlist-action-button:hover,
  .playlist-add-files:hover {
    color: var(--accent-strong);
  }

  .playlist-action-button .material-symbols-outlined,
  .playlist-add-files .material-symbols-outlined {
    font-size: 1.15rem;
    line-height: 1;
  }

  .playlist-search-inline {
    position: absolute;
    right: calc(100% + 0.45rem);
    top: 50%;
    transform: translateY(-50%);
    z-index: 2;
    display: inline-flex;
    align-items: center;
    gap: 0.28rem;
    width: min(10.25rem, calc(100vw - 7rem));
    padding: 0 0.28rem 0 0.48rem;
    border: 1px solid rgba(168, 153, 132, 0.16);
    border-radius: 999px;
    background: rgba(40, 40, 40, 0.96);
    box-shadow: var(--shadow);
    color: var(--muted);
  }

  .playlist-search-inline:focus-within {
    border-color: rgba(250, 189, 47, 0.34);
    color: var(--accent-strong);
  }

  .playlist-search-inline .material-symbols-outlined {
    font-size: 0.92rem;
    line-height: 1;
  }

  .playlist-search-inline input {
    width: 100%;
    min-width: 0;
    height: 1.72rem;
    padding: 0;
    color: var(--text);
    background: transparent;
    border: 0;
    outline: none;
    font: inherit;
    font-size: 0.83rem;
  }

  .playlist-search-inline input::-webkit-search-cancel-button {
    appearance: none;
  }

  .playlist-search-inline input::placeholder {
    color: color-mix(in srgb, var(--muted) 82%, transparent);
  }

  .playlist-search-close {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.35rem;
    height: 1.35rem;
    padding: 0;
    color: inherit;
    background: transparent;
    border: 0;
    border-radius: 999px;
  }

  .playlist-search-close:hover {
    color: var(--accent-strong);
    background: rgba(250, 189, 47, 0.08);
  }

  .playlist-search-close .material-symbols-outlined {
    font-size: 0.9rem;
    line-height: 1;
  }

  .playlist-filter-empty {
    place-items: center;
    padding: 1.2rem 0.9rem 1.35rem;
  }

  .playlist-filter-empty p {
    margin: 0;
  }

  .track-table {
    width: 100%;
    min-width: 0;
    padding: 0 0.85rem 0.85rem;
    overflow-x: hidden;
  }

  .track-columns-header,
  .track-table-row-button {
    display: grid;
    grid-template-columns: var(--track-table-columns);
    column-gap: 0.75rem;
  }

  .track-columns-header {
    width: 100%;
    padding: 0 0 0.1rem;
  }

  .track-column-header {
    position: relative;
    min-width: 0;
    border-bottom: 1px solid rgba(168, 153, 132, 0.16);
  }

  .track-column-header.drop-before::before,
  .track-column-header.drop-after::after {
    content: "";
    position: absolute;
    top: 0.35rem;
    bottom: 0.35rem;
    width: 2px;
    background: var(--accent-strong);
    border-radius: 999px;
    z-index: 2;
  }

  .track-column-header.drop-before::before {
    left: -1px;
  }

  .track-column-header.drop-after::after {
    right: -1px;
  }

  .track-column-sort-button {
    width: 100%;
    display: block;
    padding: 0.2rem 1rem 0.3rem 0;
    color: var(--muted);
    background: transparent;
    text-align: left;
    border: 0;
    user-select: none;
  }

  .track-column-sort-button.is-right-aligned {
    text-align: right;
  }

  .track-column-header.is-sorted .track-column-sort-button,
  .track-column-sort-button:hover {
    color: var(--text);
  }

  .track-column-sort-content {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    min-width: 0;
    max-width: 100%;
  }

  .track-column-sort-content.is-right-aligned {
    justify-content: flex-end;
    width: 100%;
  }

  .track-column-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.82rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .track-column-sort-icon {
    font-size: 1rem;
    flex-shrink: 0;
  }

  .track-column-resizer {
    position: absolute;
    top: 0;
    right: -5px;
    width: 10px;
    height: 100%;
    padding: 0;
    background: transparent;
    cursor: col-resize;
    z-index: 3;
  }

  .track-table-body {
    width: 100%;
  }

  .track-table-row-button {
    width: 100%;
    align-items: center;
    padding: 0.5rem 0;
    color: inherit;
    background: transparent;
    border: 0;
    text-align: left;
    min-width: 0;
  }

  .track-table-cell {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .track-table-cell.is-right-aligned {
    text-align: right;
  }

  .track-table-cell.is-duration {
    color: var(--muted);
  }

  .track-table-body .track-table-row-button:hover {
    background: rgba(235, 219, 178, 0.04);
  }

  .track-table-body li.selected .track-table-row-button {
    background: rgba(215, 153, 33, 0.12);
  }

  .track-table-body li.playing .track-table-row-button {
    box-shadow: inset 3px 0 0 var(--accent-strong);
    font-weight: 600;
  }

  .track-table-body li.playing .track-table-row-button .track-table-cell.is-duration {
    color: inherit;
  }

  .playlist-context-menu-checkbox {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.55rem 0.7rem;
    border-radius: 0.45rem;
    cursor: pointer;
    color: var(--text);
  }

  .playlist-context-menu-checkbox:hover {
    background: var(--accent-soft);
  }

  .playlist-context-menu-checkbox input {
    margin: 0;
    accent-color: var(--accent-strong);
  }

  @media (max-width: 720px) {
    .playlist-search-inline {
      top: calc(100% + 0.3rem);
      right: 0;
      transform: none;
      width: min(10rem, calc(100vw - 3rem));
    }
  }
</style>
