<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';
  import { appearanceSettings } from '$lib/stores/appearance-settings';
  import {
    libraryViewSettings
  } from '$lib/stores/library-view-settings';
  import type {
    LibraryColumnId,
    MenuActionItem,
    PlaylistItem,
    PlaylistRepeatMode,
    PlaylistSelection
  } from '$lib/types';
  import { extractDroppedFiles } from '$lib/utils/files';
  import PlaylistPanelHeader from '$lib/components/playlist-panel/PlaylistPanelHeader.svelte';
  import LibraryColumnsHeader from '$lib/components/playlist-panel/LibraryColumnsHeader.svelte';
  import TrackList from '$lib/components/playlist-panel/TrackList.svelte';
  import PanelContextMenu from '$lib/components/playlist-panel/PanelContextMenu.svelte';
  import { buildOrderedSelection, isToggleSelection } from '$lib/components/playlist-panel/selection';
  import {
    compareItems,
    fitWidthsToAvailableWidth,
    getOrderedColumns,
    rebalanceResizedColumns,
    type ColumnDropIndicator,
    type LibraryColumnWidths
  } from '$lib/components/playlist-panel/library-columns';
  import {
    clampContextMenuPosition,
    type ColumnVisibilityAction,
    type PlaylistPanelContextMenu
  } from '$lib/components/playlist-panel/context-menu';
  import {
    filterItemsByQuery,
    getTrackSummary
  } from '$lib/components/playlist-panel/search';

  export let items: PlaylistItem[] = [];
  export let selectedIds: string[] = [];
  export let selectionAnchorId: string | null = null;
  export let playingId: string | null = null;
  export let panelTitle = 'Playlist';
  export let regionLabel = 'Playlist';
  export let layout: 'list' | 'columns' = 'list';
  export let fillParent = false;
  export let hideEyebrow = false;
  export let showShuffleControl = true;
  export let showRepeatControl = true;
  export let showSearchControl = false;
  export let shuffleEnabled = false;
  export let repeatMode: PlaylistRepeatMode = 'off';
  export let jumpToItemRequest: { id: string; token: number } | null = null;
  export let getContextMenuActions: (ids: string[]) => MenuActionItem[] = () => [
    { id: 'remove', label: 'Remove', icon: 'delete' }
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

  const COLUMN_GAP = 4;
  const TABLE_SIDE_PADDING = 19.2;

  let contextMenu: PlaylistPanelContextMenu | null = null;
  let contextMenuElement: HTMLDivElement | null = null;
  let dropzoneElement: HTMLDivElement | null = null;
  let headerElement: HTMLDivElement | null = null;
  let columnsHeaderElement: HTMLDivElement | null = null;
  let searchInputElement: HTMLInputElement | null = null;
  let playlistHeaderCovered = false;
  let dropzoneWidth = 0;
  let searchInputExpanded = false;
  let draggedColumnId: LibraryColumnId | null = null;
  let dropIndicator: ColumnDropIndicator | null = null;
  let pendingDragColumnId: LibraryColumnId | null = null;
  let pendingDragStartX = 0;
  let suppressNextColumnSort = false;
  let resizingColumnId: LibraryColumnId | null = null;
  let resizeStartX = 0;
  let resizeStartWidths: LibraryColumnWidths = {};
  let lastHandledJumpToken = 0;

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

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

  function closeContextMenu() {
    contextMenu = null;
  }

  function clearColumnInteractions() {
    draggedColumnId = null;
    pendingDragColumnId = null;
    dropIndicator = null;
    resizingColumnId = null;
  }

  function getColumnDropIndicator(clientX: number): ColumnDropIndicator | null {
    if (!columnsHeaderElement || visibleColumns.length === 0) {
      return null;
    }

    const columnElements = Array.from(
      columnsHeaderElement.querySelectorAll<HTMLElement>('[data-library-column-id]')
    );
    const columnBounds = visibleColumns
      .map((column) => {
        const element = columnElements.find((node) => node.dataset.libraryColumnId === column.id);

        if (!element) {
          return null;
        }

        return {
          columnId: column.id,
          bounds: element.getBoundingClientRect()
        };
      })
      .filter((entry): entry is { columnId: LibraryColumnId; bounds: DOMRect } => Boolean(entry));

    if (columnBounds.length === 0) {
      return null;
    }

    for (const { columnId, bounds } of columnBounds) {
      if (clientX < bounds.left + bounds.width / 2) {
        return {
          columnId,
          position: 'before'
        };
      }
    }

    return {
      columnId: columnBounds[columnBounds.length - 1].columnId,
      position: 'after'
    };
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
    if (!contextMenu || !contextMenuElement || typeof window === 'undefined') {
      return;
    }

    contextMenu = clampContextMenuPosition(
      contextMenu,
      contextMenuElement,
      window.innerWidth,
      window.innerHeight
    );
  }

  function updatePlaylistHeaderState() {
    playlistHeaderCovered = (dropzoneElement?.scrollTop ?? 0) > 0;
  }

  function emitSelection(event: MouseEvent, id: string) {
    if (layout === 'columns') {
      dispatch(
        'setSelection',
        buildOrderedSelection(displayItems, selectedIds, selectionAnchorId, id, event.shiftKey, isToggleSelection(event))
      );
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

  async function handleItemContextMenu(event: MouseEvent, id: string) {
    event.preventDefault();

    const itemIsSelected = selectedIds.includes(id);

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
      x: event.clientX,
      y: event.clientY,
      ids: itemIsSelected ? selectedIds : [id]
    };

    await tick();
    clampContextMenu();
  }

  async function handleColumnContextMenu(event: MouseEvent) {
    if (layout !== 'columns' || isCompactColumnLayout) {
      return;
    }

    event.preventDefault();
    contextMenu = {
      kind: 'columns',
      x: event.clientX,
      y: event.clientY
    };

    await tick();
    clampContextMenu();
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

  function handleColumnSort(columnId: LibraryColumnId) {
    if (suppressNextColumnSort) {
      suppressNextColumnSort = false;
      return;
    }

    libraryViewSettings.setSort(columnId);
  }

  function handleColumnVisibilityChange(columnId: LibraryColumnId, visible: boolean) {
    libraryViewSettings.setColumnVisibility(columnId, visible);
  }

  function handleColumnContextAction({ columnId, visible }: ColumnVisibilityAction) {
    if (visible && visibleColumnCount === 1) {
      return;
    }

    handleColumnVisibilityChange(columnId, !visible);
    closeContextMenu();
  }

  function handleSearchToggle() {
    searchInputExpanded = true;
  }

  function handleSearchInput(value: string) {
    libraryViewSettings.setSearchQuery(value);
  }

  function handleSearchClose() {
    searchInputExpanded = false;
    libraryViewSettings.setSearchQuery('');
    searchInputElement?.blur();
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
    if (event.button !== 0 || layout !== 'columns' || isCompactColumnLayout || resizingColumnId) {
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

  function handleWindowPointerMove(event: PointerEvent) {
    if (resizingColumnId) {
      libraryViewSettings.setColumnWidths(
        rebalanceResizedColumns(
          resizeStartWidths,
          visibleColumns.map((column) => column.id),
          resizingColumnId,
          event.clientX - resizeStartX
        )
      );
      return;
    }

    if (!draggedColumnId && pendingDragColumnId) {
      if (Math.abs(event.clientX - pendingDragStartX) < 6) {
        return;
      }

      draggedColumnId = pendingDragColumnId;
      dropIndicator = getColumnDropIndicator(event.clientX);
      closeContextMenu();
      return;
    }

    if (draggedColumnId) {
      dropIndicator = getColumnDropIndicator(event.clientX);
    }
  }

  function handleWindowPointerUp() {
    const completedDrag = Boolean(draggedColumnId);

    if (draggedColumnId && dropIndicator) {
      libraryViewSettings.moveColumn(draggedColumnId, dropIndicator.columnId, dropIndicator.position);
    }

    resizingColumnId = null;
    pendingDragColumnId = null;
    draggedColumnId = null;
    dropIndicator = null;

    if (completedDrag) {
      suppressNextColumnSort = true;

      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          suppressNextColumnSort = false;
        }, 120);
      }
    }
  }

  async function scrollTrackIntoView(id: string) {
    await tick();

    if (!dropzoneElement || typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
      return;
    }

    const row = dropzoneElement.querySelector<HTMLElement>(`[data-track-id="${CSS.escape(id)}"]`);

    if (!row) {
      return;
    }

    const headerHeight = headerElement?.offsetHeight ?? 0;
    const visibleHeight = Math.max(dropzoneElement.clientHeight - headerHeight, row.offsetHeight);
    const rowTop = row.offsetTop;
    const centeredTop = rowTop - headerHeight - (visibleHeight - row.offsetHeight) / 2;
    const maxScrollTop = Math.max(dropzoneElement.scrollHeight - dropzoneElement.clientHeight, 0);
    dropzoneElement.scrollTo({
      top: clamp(centeredTop, 0, maxScrollTop)
    });
  }

  $: searchQuery = showSearchControl ? $libraryViewSettings.searchQuery : '';
  $: normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  $: showSearchInput = showSearchControl && (searchInputExpanded || searchQuery !== '');
  $: orderedColumns = layout === 'columns' ? getOrderedColumns($libraryViewSettings.order, $libraryViewSettings.columns) : [];
  $: visibleSearchColumnIds = orderedColumns.filter((column) => column.visible).map((column) => column.id);
  $: filteredItems = filterItemsByQuery(items, normalizedSearchQuery, visibleSearchColumnIds);
  $: trackSummary = getTrackSummary(items, filteredItems, normalizedSearchQuery);
  $: repeatIcon = repeatMode === 'one' ? 'repeat_one' : 'repeat';
  $: repeatLabel =
    repeatMode === 'one' ? 'Repeat current track' : repeatMode === 'all' ? 'Repeat playlist' : 'Repeat off';
  $: contextMenuActions = contextMenu?.kind === 'items' ? getContextMenuActions(contextMenu.ids) : [];
  $: storedVisibleColumns = orderedColumns.filter((column) => column.visible);
  $: visibleColumnCount = storedVisibleColumns.length;
  $: isCompactColumnLayout =
    layout === 'columns' &&
    dropzoneWidth > 0 &&
    dropzoneWidth < 280 &&
    !$appearanceSettings.keepLibraryColumnsVisibleInNarrowLayout;
  $: hideTrackFormat = layout === 'list' && dropzoneWidth > 0 && dropzoneWidth < 280;
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
  $: tableColumnGap = `${COLUMN_GAP}px`;
  $: if (contextMenu?.kind === 'columns' && (layout !== 'columns' || isCompactColumnLayout)) {
    closeContextMenu();
  }
  $: if (!showSearchControl) {
    searchInputExpanded = false;
  }
  $: if (items) {
    tick().then(() => updatePlaylistHeaderState());
  }
  $: if (jumpToItemRequest && jumpToItemRequest.token !== lastHandledJumpToken) {
    lastHandledJumpToken = jumpToItemRequest.token;
    void scrollTrackIntoView(jumpToItemRequest.id);
  }
</script>

<svelte:window
  on:pointermove={handleWindowPointerMove}
  on:pointerup={handleWindowPointerUp}
  on:keydown={handleWindowKeydown}
  on:blur={handleWindowDismiss}
  on:resize={handleWindowDismiss}
/>

<section class="panel playlist-panel" class:fill-parent={fillParent}>
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
    <div
      bind:this={headerElement}
      class="panel-header playlist-panel-header"
      class:is-covered={playlistHeaderCovered}
      class:has-column-header={items.length > 0 && layout === 'columns' && !isCompactColumnLayout}
    >
      <PlaylistPanelHeader
        bind:searchInputElement={searchInputElement}
        {panelTitle}
        {hideEyebrow}
        {trackSummary}
        {showSearchControl}
        {showSearchInput}
        {searchQuery}
        {showShuffleControl}
        {showRepeatControl}
        {shuffleEnabled}
        {repeatMode}
        {repeatIcon}
        {repeatLabel}
        on:searchToggle={handleSearchToggle}
        on:searchInput={(event) => handleSearchInput(event.detail)}
        on:searchClose={handleSearchClose}
        on:toggleShuffle={() => dispatch('toggleShuffle')}
        on:cycleRepeat={() => dispatch('cycleRepeat')}
        on:openFiles={() => dispatch('openFiles')}
      />

      {#if items.length > 0 && layout === 'columns' && !isCompactColumnLayout}
        <LibraryColumnsHeader
          bind:headerElement={columnsHeaderElement}
          {visibleColumns}
          {activeSort}
          {tableTemplateColumns}
          {tableColumnGap}
          {dropIndicator}
          {draggedColumnId}
          {resizingColumnId}
          on:sort={(event) => handleColumnSort(event.detail)}
          on:contextMenu={(event) => void handleColumnContextMenu(event.detail)}
          on:columnPointerDown={(event) => handleColumnPointerDown(event.detail.event, event.detail.columnId)}
          on:resizeStart={(event) => handleColumnResizeStart(event.detail.event, event.detail.columnId)}
        />
      {/if}
    </div>

    {#if displayItems.length > 0}
      <TrackList
        {displayItems}
        {selectedIds}
        {playingId}
        {layout}
        {isCompactColumnLayout}
        {visibleColumns}
        {tableTemplateColumns}
        {tableColumnGap}
        {hideTrackFormat}
        on:itemClick={(event) => handleItemClick(event.detail.event, event.detail.id)}
        on:itemDoubleClick={(event) => handleItemDoubleClick(event.detail)}
        on:itemContextMenu={(event) => void handleItemContextMenu(event.detail.event, event.detail.id)}
      />
    {:else if items.length > 0 && normalizedSearchQuery}
      <div class="empty-state playlist-filter-empty">
        <p>No tracks match "{searchQuery.trim()}".</p>
      </div>
    {/if}

    <PanelContextMenu
      bind:menuElement={contextMenuElement}
      menu={contextMenu}
      {panelTitle}
      itemActions={contextMenuActions}
      {orderedColumns}
      {visibleColumnCount}
      on:dismiss={handleWindowDismiss}
      on:action={(event) => handleContextAction(event.detail)}
      on:columnToggle={(event) => handleColumnContextAction(event.detail)}
    />
  </div>
</section>

<style>
  .playlist-panel.fill-parent {
    width: 100%;
    min-width: 0;
    height: 100%;
  }

  .playlist-panel-header {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding-bottom: 0.36rem;
  }

  .playlist-panel-header.has-column-header {
    padding-bottom: 0;
  }

  .playlist-filter-empty {
    place-items: center;
    padding: 1.2rem 0.9rem 1.35rem;
  }

  .playlist-filter-empty p {
    margin: 0;
  }
</style>
