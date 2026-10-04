<script lang="ts">
  import { createEventDispatcher, onDestroy, tick } from 'svelte';
  import { locale, t } from 'svelte-i18n';
  import { appearanceSettings } from '$lib/stores/appearance-settings';
  import { libraryViewSettings } from '$lib/stores/library-view-settings';
  import type {
    LibraryColumnId,
    LibraryViewId,
    MenuActionItem,
    TrackItem,
    RepeatMode,
    TrackSelection,
    WorkspaceLibraryGroupRequest
  } from '$lib/types';
  import { createAlbumArtworkController } from '$lib/services/album-artwork';
  import { trackSettings } from '$lib/stores/track-settings';
  import { normalizeTrackRating } from '$lib/services/track-ratings';
  import { prepareImportedFiles } from '$lib/services/file-verification';
  import { extractDroppedContent } from '$lib/services/file-access';
  import TrackListPanelHeader from '$lib/components/track-list-panel/TrackListPanelHeader.svelte';
  import LibraryPanelHeader from '$lib/components/track-list-panel/LibraryPanelHeader.svelte';
  import LibraryAlbumBackdrop from '$lib/components/track-list-panel/LibraryAlbumBackdrop.svelte';
  import LibraryGroupList from '$lib/components/track-list-panel/LibraryGroupList.svelte';
  import LibraryTiles from '$lib/components/track-list-panel/LibraryTiles.svelte';
  import { LIBRARY_VIEW_DEFINITIONS } from '$lib/components/track-list-panel/library-views';
  import TrackList from '$lib/components/track-list-panel/TrackList.svelte';
  import ColumnListView from '$lib/components/ColumnListView.svelte';
  import { DEFAULT_TRACK_ROW_HEIGHT } from '$lib/components/track-list-panel/track-list-virtualization';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import { buildOrderedSelection, isToggleSelection } from '$lib/components/track-list-panel/selection';
  import {
    compareItems,
    fitWidthsToAvailableWidth,
    buildOrderedColumns,
    type ColumnDropIndicator,
    type LibraryColumnWidths
  } from '$lib/components/track-list-panel/library-columns';
  import type { TrackListPanelContextMenu } from '$lib/components/track-list-panel/context-menu';
  import {
    buildContextMenuActions,
    buildContextMenuItems,
    buildItemContextMenu,
    buildLibraryGroupContextMenu,
    buildPanelContextMenu,
    getContextMenuAriaLabel,
    handleMenuAction as runPanelMenuAction
  } from '$lib/components/track-list-panel/context-menu';
  import {
    columnResizeLabel as getColumnResizeLabel,
    handleColumnPointerDown as beginColumnPointerDown,
    handleColumnResizeStart as beginColumnResize,
    handleColumnSort as requestColumnSort,
    handleColumnVisibilityToggle as toggleColumnVisibility,
    handleWindowPointerMove as updateColumnPointerMove,
    handleWindowPointerUp as endColumnDrag,
    toColumnListViewColumns
  } from '$lib/components/track-list-panel/columns';
  import {
    focusTrackRow as focusTrackRowHelper,
    handleWindowKeydown as handlePanelWindowKeydown,
    handleWindowKeydownCapture as handlePanelWindowKeydownCapture
  } from '$lib/components/track-list-panel/keyboard';
  import {
    clearSelection as clearPanelSelection,
    findRequestedLibraryGroup,
    handleLibraryGroupBack as goBackFromLibraryGroup,
    handleLibraryGroupMove as movePinnedLibraryGroup,
    handleLibraryGroupOpen as openLibraryGroup,
    handleLibraryGroupUnpin as unpinLibraryGroup,
    handleLibraryViewChange as handlePanelLibraryViewChange,
    openRequestedLibraryGroup as openRequestedLibraryGroupHelper,
    resolveActiveLibraryView,
    scrollTrackIntoView as scrollTrackIntoViewHelper
  } from '$lib/components/track-list-panel/library-group-navigation';
  import {
    getLibraryGroupSummary,
    getLibraryGroupTrackSummary,
    getLocalizedTrackSummary,
    getRepeatControlLabel,
    localizeLibraryGroup,
    localizePanelLabel
  } from '$lib/components/track-list-panel/summaries';
  import { filterItemsByQuery } from '$lib/components/track-list-panel/search';
  import {
    buildLibraryGroups,
    filterLibraryGroupItems,
    filterLibraryGroups,
    getLibraryViewTooltipDetails,
    orderLibraryGroups,
    type LibraryGroup,
    type LibraryGroupViewId
  } from '$lib/components/track-list-panel/library-views';

  export let items: TrackItem[] = [];
  export let selectedIds: string[] = [];
  export let selectionAnchorId: string | null = null;
  export let playingId: string | null = null;
  export let favoriteItems: TrackItem[] = [];
  export let favoriteSelectedIds: string[] = [];
  export let favoriteSelectionAnchorId: string | null = null;
  export let favoritePlayingId: string | null = null;
  export let panelTitle = 'Queue';
  export let regionLabel = 'Queue';
  export let layout: 'list' | 'columns' = 'list';
  export let fillParent = false;
  export let hideEyebrow = false;
  export let showShuffleControl = true;
  export let showRepeatControl = true;
  export let showSearchControl = false;
  export let searchInputExpanded = false;
  export let libraryMode = false;
  export let shuffleEnabled = false;
  export let repeatMode: RepeatMode = 'off';
  export let jumpToItemRequest: { id: string; token: number } | null = null;
  export let libraryGroupRequest: WorkspaceLibraryGroupRequest | null = null;
  export let keyboardActive = false;
  export let readOnly = false;
  export let mobilePresentation = false;
  export let getContextMenuActions: (ids: string[]) => MenuActionItem[] = () => [
    { id: 'remove', label: 'Remove', icon: 'delete' }
  ];

  const dispatch = createEventDispatcher<{
    addFiles: FileList | File[];
    addFolders: FileSystemDirectoryHandle[];
    openFiles: void;
    select: { id: string; range: boolean; toggle: boolean };
    setSelection: TrackSelection;
    activate: string;
    viewImage: { item: TrackItem; items: TrackItem[] };
    contextAction: { actionId: string; ids: string[] };
    libraryGroupRequestHandled: number;
    toggleShuffle: void;
    cycleRepeat: void;
  }>();

  const COLUMN_GAP = 4;
  const TABLE_SIDE_PADDING = 19.2;

  let contextMenu: TrackListPanelContextMenu | null = null;
  let dropzoneElement: HTMLDivElement | null = null;
  let columnsHeaderElement: HTMLDivElement | null = null;
  let searchInputElement: HTMLInputElement | null = null;
  let queueHeaderCovered = false;
  let dropzoneWidth = 0;
  let dropzoneHeight = 0;
  let dropzoneScrollTop = 0;
  let trackRowHeight = DEFAULT_TRACK_ROW_HEIGHT;
  let libraryTiles: LibraryTiles | null = null;
  let draggedColumnId: LibraryColumnId | null = null;
  let dropIndicator: ColumnDropIndicator | null = null;
  let pendingDragColumnId: LibraryColumnId | null = null;
  let pendingDragStartX = 0;
  let suppressNextColumnSort = false;
  let resizingColumnId: LibraryColumnId | null = null;
  let resizeStartX = 0;
  let resizeStartWidths: LibraryColumnWidths = {};
  let lastHandledJumpToken = 0;
  let lastHandledLibraryGroupToken = 0;
  let selectedGroupKey: string | null = null;
  let lastActiveLibraryView: LibraryViewId | null = null;
  const libraryGroupScrollPositions = new Map<LibraryViewId, number>();
  let previousSelectedAlbumArtworkUrl: string | undefined;
  let albumBackdropTransitionBypassed = false;
  let albumBackdropTransitionFrame: number | null = null;
  const albumArtworkController = createAlbumArtworkController();
  let albumArtworkUrls: Record<string, string> = {};
  const unsubscribeAlbumArtwork = albumArtworkController.subscribe((urls) => {
    albumArtworkUrls = urls;
  });

  onDestroy(() => {
    if (albumBackdropTransitionFrame !== null) {
      cancelAnimationFrame(albumBackdropTransitionFrame);
    }
    unsubscribeAlbumArtwork();
    albumArtworkController.destroy();
  });

  function bypassAlbumBackdropTransitions() {
    albumBackdropTransitionBypassed = true;

    if (albumBackdropTransitionFrame !== null) {
      cancelAnimationFrame(albumBackdropTransitionFrame);
    }

    albumBackdropTransitionFrame = requestAnimationFrame(() => {
      albumBackdropTransitionFrame = requestAnimationFrame(() => {
        albumBackdropTransitionFrame = null;
        albumBackdropTransitionBypassed = false;
      });
    });
  }

  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    if (readOnly || !event.dataTransfer) return;

    const { files: discoveredFiles, directoryHandles } = await extractDroppedContent(
      event.dataTransfer,
      { maxDepth: trackSettings.getSnapshot().folderNestingLimit }
    );
    if (directoryHandles.length > 0) dispatch('addFolders', directoryHandles);

    const files = await prepareImportedFiles(discoveredFiles);
    if (files.length > 0) dispatch('addFiles', files);
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

  function handleWindowDismiss() {
    closeContextMenu();
    clearColumnInteractions();
  }

  async function focusTrackRow(id: string) {
    await focusTrackRowHelper(id, {
      dropzoneElement,
      onScrollTrackIntoView: scrollTrackIntoView
    });
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    handlePanelWindowKeydown(event, {
      displayItems,
      displaySelectedIds,
      displaySelectionAnchorId,
      dropzoneElement,
      onSetSelection: (selection) => dispatch('setSelection', selection),
      onFocusTrackRow: (id) => void focusTrackRow(id),
      onDismiss: handleWindowDismiss
    });
  }

  function handleWindowKeydownCapture(event: KeyboardEvent) {
    const activationTarget = event.target instanceof HTMLElement
      && (event.target.matches('input, textarea, select, button:not([data-track-row-button])') || event.target.isContentEditable);
    if (keyboardActive && libraryMode && !activationTarget && !contextMenu && event.key === 'Enter'
      && !event.repeat && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
      const item = displayItems.find((entry) => entry.id === displaySelectedIds.at(-1));
      if (item?.kind === 'image') {
        event.preventDefault();
        event.stopImmediatePropagation();
        dispatch('viewImage', { item, items: displayItems });
        return;
      }
    }
    handlePanelWindowKeydownCapture(event, {
      keyboardActive,
      showTrackRows,
      displayItems,
      contextMenu,
      libraryMode,
      selectedGroupKey,
      onSetSelection: (selection) => dispatch('setSelection', selection),
      onDismiss: handleWindowDismiss,
      onLibraryGroupBack: () => void handleLibraryGroupBack()
    });
  }

  function updateQueueHeaderState() {
    dropzoneScrollTop = dropzoneElement?.scrollTop ?? 0;
    queueHeaderCovered = dropzoneScrollTop > 0;
  }

  function emitSelection(event: MouseEvent, id: string) {
    if (layout === 'columns') {
      dispatch(
        'setSelection',
        buildOrderedSelection(displayItems, displaySelectedIds, displaySelectionAnchorId, id, event.shiftKey, isToggleSelection(event))
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
    if (mobilePresentation && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      handleItemDoubleClick(id);
      closeContextMenu();
      return;
    }

    emitSelection(event, id);
    closeContextMenu();
  }

  function handleItemDoubleClick(id: string) {
    const item = displayItems.find((entry) => entry.id === id);
    if (item?.kind === 'image') {
      dispatch('viewImage', { item, items: displayItems });
      return;
    }
    dispatch('activate', id);
  }

  function handleItemContextMenu(event: MouseEvent, id: string) {
    const menu = buildItemContextMenu(event, id, {
      readOnly,
      layout,
      displaySelectedIds,
      onSetSelection: (selection) => dispatch('setSelection', selection),
      onSelect: (detail) => dispatch('select', detail)
    });
    if (menu) contextMenu = menu;
  }

  function handleLibraryGroupContextMenu(event: MouseEvent, key: string) {
    const menu = buildLibraryGroupContextMenu(event, key, {
      groupView,
      libraryGroups,
      pinnedKeys: pinnedLibraryGroupKeys,
      onSetSelection: (selection) => dispatch('setSelection', selection)
    });
    if (menu) contextMenu = menu;
  }

  function openPanelContextMenu(event: MouseEvent): void {
    const menu = buildPanelContextMenu(event, readOnly, libraryMode, true);
    if (menu) contextMenu = menu;
  }

  function openPanelHeaderContextMenu(event: MouseEvent): void {
    const menu = buildPanelContextMenu(event, readOnly, libraryMode, false);
    if (menu) contextMenu = menu;
  }

  function handleColumnSort(columnId: LibraryColumnId) {
    if (requestColumnSort(columnId, suppressNextColumnSort)) {
      suppressNextColumnSort = false;
    }
  }

  function handleColumnVisibilityToggle(columnId: LibraryColumnId): void {
    toggleColumnVisibility(columnId, orderedColumns, visibleColumnCount);
  }

  function handleMenuAction(actionId: string) {
    runPanelMenuAction(
      contextMenu,
      actionId,
      (event) => dispatch('contextAction', event),
      closeContextMenu
    );
  }

  function handleLibraryGroupUnpin(key: string) {
    unpinLibraryGroup(groupView, key);
  }

  function handleLibraryGroupMove(
    detail: { key: string; targetKey: string; position: 'before' | 'after' }
  ) {
    movePinnedLibraryGroup(groupView, detail);
  }

  function handleSearchToggle() {
    searchInputExpanded = true;
  }

  function clearSelection() {
    clearPanelSelection(displaySelectedIds, (selection) => dispatch('setSelection', selection));
  }

  function handleLibraryViewChange(view: LibraryViewId) {
    handlePanelLibraryViewChange(view, activeLibraryView, Boolean(selectedGroupKey), {
      onClearSelectedGroup: () => {
        selectedGroupKey = null;
      },
      onBack: () => void handleLibraryGroupBack(),
      onClearSelection: clearSelection,
      onScrollToTop: () => dropzoneElement?.scrollTo({ top: 0 })
    });
  }

  function handleLibraryGroupOpen(key: string) {
    openLibraryGroup(key, activeLibraryView, libraryGroupScrollPositions, {
      scrollTop: dropzoneElement?.scrollTop ?? 0,
      onSelectGroup: (selectedKey) => {
        selectedGroupKey = selectedKey;
      },
      onClearSelection: clearSelection,
      onScrollToTop: () => dropzoneElement?.scrollTo({ top: 0 })
    });
  }

  async function handleLibraryGroupBack() {
    await goBackFromLibraryGroup(activeLibraryView, libraryGroupScrollPositions, {
      onSelectGroup: (key) => {
        selectedGroupKey = key;
      },
      onClearSelection: clearSelection,
      onScrollTo: (top) => dropzoneElement?.scrollTo({ top }),
      onUpdateQueueHeaderState: updateQueueHeaderState
    });
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
    const resize = beginColumnResize(event, columnId, layout, visibleColumns);
    if (!resize) return;
    resizingColumnId = resize.resizingColumnId;
    resizeStartX = resize.resizeStartX;
    resizeStartWidths = resize.resizeStartWidths;
    closeContextMenu();
  }

  function handleColumnPointerDown(event: PointerEvent, columnId: LibraryColumnId) {
    const pending = beginColumnPointerDown(event, columnId, layout, isCompactColumnLayout, resizingColumnId);
    if (!pending) return;
    pendingDragColumnId = pending.pendingDragColumnId;
    pendingDragStartX = pending.pendingDragStartX;
  }

  function handleWindowPointerMove(event: PointerEvent) {
    const result = updateColumnPointerMove(
      event,
      {
        resizingColumnId,
        resizeStartX,
        resizeStartWidths,
        visibleColumns,
        draggedColumnId,
        pendingDragColumnId,
        pendingDragStartX
      },
      columnsHeaderElement
    );

    if (result.type === 'drag-start') {
      draggedColumnId = result.draggedColumnId;
      dropIndicator = result.dropIndicator;
      closeContextMenu();
    } else if (result.type === 'drag-move') {
      dropIndicator = result.dropIndicator;
    }
  }

  function handleWindowPointerUp() {
    const completedDrag = endColumnDrag({ draggedColumnId, dropIndicator });

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
    if (showLibraryTiles && libraryTiles) {
      await libraryTiles.scrollTrackIntoView(id);
      updateQueueHeaderState();
      return;
    }
    await scrollTrackIntoViewHelper(id, {
      dropzoneElement,
      displayItems,
      trackRowHeight,
      onDropzoneScrollTop: (top) => {
        dropzoneScrollTop = top;
      }
    });
  }

  async function openRequestedLibraryGroup(
    request: WorkspaceLibraryGroupRequest,
    group: LibraryGroup
  ) {
    await openRequestedLibraryGroupHelper(request, group, libraryMode, {
      onCollapseSearch: () => {
        searchInputExpanded = false;
      },
      onSelectGroup: (key) => {
        selectedGroupKey = key;
      },
      onSetSelection: (selection) => dispatch('setSelection', selection),
      onScrollTrackIntoView: scrollTrackIntoView,
      onHandled: (token) => dispatch('libraryGroupRequestHandled', token)
    });
  }

  $: activeLibraryView = resolveActiveLibraryView(libraryMode, $trackSettings.enableRatings, $libraryViewSettings.activeView);
  $: favoritesViewActive = libraryMode && activeLibraryView === 'favorites';
  $: ratingsViewActive = libraryMode && activeLibraryView === 'ratings';
  $: songsViewActive = libraryMode && activeLibraryView === 'songs';
  $: imagesViewActive = libraryMode && activeLibraryView === 'images';
  $: videosViewActive = libraryMode && activeLibraryView === 'videos';
  $: displaySourceItems = favoritesViewActive
    ? favoriteItems
    : ratingsViewActive
      ? items.filter((item) => normalizeTrackRating(item.rating) !== undefined)
      : songsViewActive
        ? items.filter((item) => item.kind !== 'image' && item.kind !== 'video')
        : imagesViewActive
          ? items.filter((item) => item.kind === 'image')
          : videosViewActive
            ? items.filter((item) => item.kind === 'video')
            : items;
  $: displaySelectedIds = favoritesViewActive ? favoriteSelectedIds : selectedIds;
  $: displaySelectionAnchorId = favoritesViewActive ? favoriteSelectionAnchorId : selectionAnchorId;
  $: displayPlayingId = favoritesViewActive ? favoritePlayingId : playingId;
  $: if (activeLibraryView !== lastActiveLibraryView) {
    selectedGroupKey = null;
    lastActiveLibraryView = activeLibraryView;
  }
  $: searchQuery = showSearchControl ? $libraryViewSettings.searchQuery : '';
  $: normalizedSearchQuery = searchQuery.trim().toLowerCase();
  $: showSearchInput = showSearchControl && (searchInputExpanded || searchQuery !== '');
  $: activeLibraryTableSettings = $libraryViewSettings.views[activeLibraryView];
  $: browserLayout = libraryMode && !mobilePresentation ? activeLibraryTableSettings.layout : 'list';
  $: showLibraryTiles = browserLayout !== 'list';
  $: orderedColumns = layout === 'columns'
    ? buildOrderedColumns(activeLibraryTableSettings.order, activeLibraryTableSettings.columns, $trackSettings.enableRatings, $t)
    : [];
  $: groupView = activeLibraryView === 'allMedia' || activeLibraryView === 'songs' || activeLibraryView === 'images' || activeLibraryView === 'videos' || activeLibraryView === 'favorites' || activeLibraryView === 'ratings'
    ? null
    : activeLibraryView as LibraryGroupViewId;
  $: libraryGroups = groupView
    ? buildLibraryGroups(items, groupView, $locale ?? undefined).map((group) => localizeLibraryGroup(group, $t))
    : [];
  $: requestedLibraryGroup = findRequestedLibraryGroup(libraryGroupRequest, activeLibraryView, libraryGroups);
  $: pinnedLibraryGroupKeys = groupView ? $libraryViewSettings.pinnedGroupKeys[groupView] : [];
  $: orderedLibraryGroups = groupView === 'folders'
    ? libraryGroups
    : groupView
      ? orderLibraryGroups(libraryGroups, pinnedLibraryGroupKeys)
      : [];
  $: visibleLibraryGroups = groupView ? filterLibraryGroups(orderedLibraryGroups, normalizedSearchQuery) : [];
  $: visibleGroupItems = [...new Map(
    visibleLibraryGroups.flatMap((group) => group.items.map((item) => [item.id, item] as const))
  ).values()];
  $: selectedLibraryGroup = selectedGroupKey
    ? libraryGroups.find((group) => group.key === selectedGroupKey) ?? null
    : null;
  $: albumArtworkGroups = libraryMode && groupView === 'albums'
    ? selectedLibraryGroup && !visibleLibraryGroups.some((group) => group.key === selectedLibraryGroup.key)
      ? [selectedLibraryGroup, ...visibleLibraryGroups]
      : visibleLibraryGroups
    : [];
  $: albumArtworkController.sync(albumArtworkGroups);
  $: selectedAlbumArtworkUrl = libraryMode
    && groupView === 'albums'
    && selectedLibraryGroup
    && $appearanceSettings.showLibraryAlbumArtworkBackdrop
    ? albumArtworkUrls[selectedLibraryGroup.key]
    : undefined;
  $: if (selectedAlbumArtworkUrl !== previousSelectedAlbumArtworkUrl) {
    previousSelectedAlbumArtworkUrl = selectedAlbumArtworkUrl;
    bypassAlbumBackdropTransitions();
  }
  $: showTrackRows = !libraryMode || activeLibraryView === 'allMedia' || activeLibraryView === 'songs' || activeLibraryView === 'images' || activeLibraryView === 'videos' || activeLibraryView === 'favorites' || activeLibraryView === 'ratings' || Boolean(selectedLibraryGroup);
  $: unfilteredDisplayItems = libraryMode && activeLibraryView !== 'allMedia' && activeLibraryView !== 'songs' && activeLibraryView !== 'images' && activeLibraryView !== 'videos' && activeLibraryView !== 'favorites' && activeLibraryView !== 'ratings'
    ? selectedLibraryGroup?.items ?? []
    : displaySourceItems;
  $: filteredItems = selectedLibraryGroup
    ? filterLibraryGroupItems(selectedLibraryGroup, normalizedSearchQuery)
    : filterItemsByQuery(unfilteredDisplayItems, normalizedSearchQuery);
  $: trackSummary = selectedLibraryGroup
    ? getLibraryGroupTrackSummary(selectedLibraryGroup, filteredItems, $t)
    : getLocalizedTrackSummary(displaySourceItems, filteredItems, normalizedSearchQuery, $t);
  $: libraryTooltipDetails = getLibraryViewTooltipDetails(items, favoriteItems, normalizedSearchQuery, $locale ?? undefined);
  $: librarySummary = groupView && !selectedLibraryGroup
    ? getLibraryGroupSummary(groupView, visibleLibraryGroups.length, libraryGroups.length, normalizedSearchQuery ? visibleGroupItems : items, normalizedSearchQuery, $t)
    : trackSummary;
  $: repeatIcon = repeatMode === 'one' ? 'repeat_one' : 'repeat';
  $: repeatLabel = getRepeatControlLabel(repeatMode, $t);
  $: localizedPanelTitle = localizePanelLabel(panelTitle, $t);
  $: localizedRegionLabel = localizePanelLabel(regionLabel, $t);
  $: contextMenuActions = buildContextMenuActions(contextMenu, getContextMenuActions, $t);
  $: contextMenuItems = buildContextMenuItems(contextMenu, contextMenuActions, $t);
  $: contextMenuAriaLabel = getContextMenuAriaLabel(contextMenu, localizedPanelTitle, $t);
  $: storedVisibleColumns = orderedColumns.filter((column) => column.visible);
  $: visibleColumnCount = storedVisibleColumns.length;
  $: isCompactColumnLayout =
    !mobilePresentation &&
    layout === 'columns' &&
    dropzoneWidth > 0 &&
    dropzoneWidth < 280 &&
    !$appearanceSettings.keepLibraryColumnsVisibleInNarrowLayout;
  $: presentationLayout = mobilePresentation ? 'list' : layout;
  $: hideTrackFormat =
    (presentationLayout === 'list' && dropzoneWidth > 0 && dropzoneWidth < 280) ||
    (isCompactColumnLayout && libraryMode && activeLibraryView === 'formats' && Boolean(selectedLibraryGroup));
  $: activeSort = !$trackSettings.enableRatings && activeLibraryTableSettings.sort.columnId === 'rating'
    ? { columnId: 'title' as const, direction: activeLibraryTableSettings.sort.direction }
    : activeLibraryTableSettings.sort;
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
  $: listViewColumns = toColumnListViewColumns(visibleColumns);
  $: allListColumns = toColumnListViewColumns(orderedColumns);
  $: displayItems =
    layout === 'columns'
      ? [...filteredItems].sort((left, right) =>
          compareItems(left, right, activeSort, $locale ?? undefined)
        )
      : filteredItems;
  $: if (!showSearchControl) {
    searchInputExpanded = false;
  }
  $: if (items || favoriteItems) {
    tick().then(() => updateQueueHeaderState());
  }
  $: if (jumpToItemRequest && jumpToItemRequest.token !== lastHandledJumpToken) {
    lastHandledJumpToken = jumpToItemRequest.token;
    void scrollTrackIntoView(jumpToItemRequest.id);
  }
  $: if (
    libraryGroupRequest
    && requestedLibraryGroup
    && libraryGroupRequest.token !== lastHandledLibraryGroupToken
  ) {
    lastHandledLibraryGroupToken = libraryGroupRequest.token;
    void openRequestedLibraryGroup(libraryGroupRequest, requestedLibraryGroup);
  }
</script>

<svelte:window
  on:pointermove={handleWindowPointerMove}
  on:pointerup={handleWindowPointerUp}
  on:keydown|capture={handleWindowKeydownCapture}
  on:keydown={handleWindowKeydown}
  on:blur={handleWindowDismiss}
  on:resize={handleWindowDismiss}
/>

<section
  class="panel track-list-panel"
  class:fill-parent={fillParent}
  class:library-album-backdrop-active={Boolean(selectedAlbumArtworkUrl)}
  class:library-album-transition-bypass={albumBackdropTransitionBypassed}
>
  {#if selectedAlbumArtworkUrl}
    <!-- This is deliberately panel-local and must not register as a shared backdrop zone. -->
    <LibraryAlbumBackdrop artworkUrl={selectedAlbumArtworkUrl} />
  {/if}

  <div
    class="dropzone track-list-dropzone"
    class:library-list-navigation={libraryMode && !mobilePresentation && $appearanceSettings.libraryNavigationStyle === 'list'}
    style:--library-sidebar-width={$libraryViewSettings.sidebarWidth === null ? undefined : `${$libraryViewSettings.sidebarWidth}px`}
    role="region"
    aria-label={$t('queue.listRegion', { default: '{name} list', values: { name: localizedRegionLabel } })}
    on:dragover={(event) => { if (!readOnly) event.preventDefault(); }}
    on:drop={handleDrop}
    on:contextmenu={openPanelContextMenu}
  >
    <div
      class="panel-header track-list-panel-header"
      role="group"
      class:library-mode={libraryMode}
      class:compact-heading={hideEyebrow}
      class:is-covered={queueHeaderCovered}
      class:has-column-header={!showLibraryTiles && showTrackRows && filteredItems.length > 0 && presentationLayout === 'columns' && !isCompactColumnLayout}
      on:contextmenu={openPanelHeaderContextMenu}
    >
      {#if libraryMode}
        <LibraryPanelHeader
          bind:searchInputElement={searchInputElement}
          activeView={activeLibraryView}
          {browserLayout}
          navigationStyle={mobilePresentation ? 'tabbed' : $appearanceSettings.libraryNavigationStyle}
          ratingsEnabled={$trackSettings.enableRatings}
          summary={librarySummary}
          tooltipDetails={libraryTooltipDetails}
          groupLabel={selectedLibraryGroup?.label ?? ''}
          showBack={Boolean(selectedLibraryGroup)}
          visibleViews={$libraryViewSettings.visibleViews}
          {showSearchInput}
          {searchQuery}
          {readOnly}
          showPrimaryActions={!mobilePresentation}
          on:viewChange={(event) => handleLibraryViewChange(event.detail)}
          on:viewVisibilityToggle={(event) => libraryViewSettings.toggleViewVisibility(event.detail)}
          on:viewMove={(event) => libraryViewSettings.moveView(event.detail.view, event.detail.targetView, event.detail.position)}
          on:back={handleLibraryGroupBack}
          on:searchToggle={handleSearchToggle}
          on:searchInput={(event) => handleSearchInput(event.detail)}
          on:searchClose={handleSearchClose}
          on:openFiles={() => dispatch('openFiles')}
        />
      {:else}
        <TrackListPanelHeader
          panelTitle={localizedPanelTitle}
          {hideEyebrow}
          {trackSummary}
          {showShuffleControl}
          {showRepeatControl}
          {shuffleEnabled}
          {repeatMode}
          {repeatIcon}
          {repeatLabel}
          {readOnly}
          showAddFiles={!mobilePresentation}
          on:toggleShuffle={() => dispatch('toggleShuffle')}
          on:cycleRepeat={() => dispatch('cycleRepeat')}
          on:openFiles={() => dispatch('openFiles')}
        />
      {/if}

    </div>

    <ColumnListView
      columns={listViewColumns}
      allColumns={allListColumns}
      bind:scrollElement={dropzoneElement}
      bind:headerElement={columnsHeaderElement}
      bind:clientWidth={dropzoneWidth}
      bind:clientHeight={dropzoneHeight}
      showHeader={!showLibraryTiles && showTrackRows && filteredItems.length > 0 && presentationLayout === 'columns' && !isCompactColumnLayout}
      columnGap={`${COLUMN_GAP}px`}
      contextMenuLabel={$t('queue.contextMenu.columns', { default: '{panel} columns', values: { panel: localizedPanelTitle } })}
      {resizingColumnId}
      {draggedColumnId}
      {dropIndicator}
      {activeSort}
      resizeLabel={(column) => getColumnResizeLabel(column, $t)}
      style="--clv-header-bleed: -0.55rem; --clv-header-padding: 0 0.55rem; --clv-header-background: color-mix(in srgb, var(--track-list-header-background) 72%, var(--bg-elevated)); --clv-header-border: var(--border-soft); --clv-column-cursor: grab;"
      on:columnPointerDown={(event) => handleColumnPointerDown(event.detail.event, event.detail.columnId as LibraryColumnId)}
      on:resizeStart={(event) => handleColumnResizeStart(event.detail.event, event.detail.columnId as LibraryColumnId)}
      on:visibilityToggle={(event) => handleColumnVisibilityToggle(event.detail as LibraryColumnId)}
      on:scroll={updateQueueHeaderState}
    >
      <svelte:fragment slot="headerCell" let:column let:sorted>
        <button
          type="button"
          class="clv-column-sort-button"
          class:is-sorted={sorted}
          class:is-right-aligned={column.rightAligned}
          title={$t('library.columns.sortBy', { default: 'Sort by {column}', values: { column: column.label } })}
          on:click={() => handleColumnSort(column.id as LibraryColumnId)}
        >
          <span class="clv-column-sort-content" class:is-right-aligned={column.rightAligned}>
            <span class="clv-column-label">{column.label}</span>
            {#if sorted}
              <span class="material-symbols-outlined clv-column-sort-icon" aria-hidden="true">
                {activeSort.direction === 'asc' ? 'expand_less' : 'expand_more'}
              </span>
            {/if}
          </span>
        </button>
      </svelte:fragment>

      {#if showLibraryTiles && (displayItems.length > 0 || (!showTrackRows && visibleLibraryGroups.length > 0))}
        <LibraryTiles
          bind:this={libraryTiles}
          items={displayItems}
          groups={showTrackRows ? [] : visibleLibraryGroups}
          groupIcon={LIBRARY_VIEW_DEFINITIONS.find((view) => view.id === activeLibraryView)?.icon ?? 'album'}
          selectedIds={displaySelectedIds}
          playingId={displayPlayingId}
          pinnedKeys={groupView === 'folders' ? [] : pinnedLibraryGroupKeys}
          gallery={browserLayout === 'gallery'}
          visual={imagesViewActive || videosViewActive}
          tileSize={activeLibraryTableSettings.tileSize}
          scrollTop={dropzoneScrollTop}
          viewportHeight={dropzoneHeight}
          scrollElement={dropzoneElement}
          on:itemClick={(event) => handleItemClick(event.detail.event, event.detail.id)}
          on:itemDoubleClick={(event) => handleItemDoubleClick(event.detail)}
          on:itemContextMenu={(event) => handleItemContextMenu(event.detail.event, event.detail.id)}
          on:itemNavigate={(event) => {
            dispatch('setSelection', buildOrderedSelection(displayItems, displaySelectedIds, displaySelectionAnchorId, event.detail.id, event.detail.range, false));
            void focusTrackRow(event.detail.id);
          }}
          on:open={(event) => handleLibraryGroupOpen(event.detail)}
          on:groupContextMenu={(event) => handleLibraryGroupContextMenu(event.detail.event, event.detail.key)}
          on:movePin={(event) => handleLibraryGroupMove(event.detail)}
        />
      {:else if !showTrackRows && visibleLibraryGroups.length > 0 && groupView}
        <LibraryGroupList
          groups={visibleLibraryGroups}
          view={groupView}
          artworkUrls={albumArtworkUrls}
          pinnedKeys={groupView === 'folders' ? [] : pinnedLibraryGroupKeys}
          searchActive={Boolean(normalizedSearchQuery)}
          on:open={(event) => handleLibraryGroupOpen(event.detail)}
          on:contextMenu={(event) => void handleLibraryGroupContextMenu(event.detail.event, event.detail.key)}
          on:unpin={(event) => handleLibraryGroupUnpin(event.detail)}
          on:movePin={(event) => handleLibraryGroupMove(event.detail)}
        />
      {:else if displayItems.length > 0}
        <TrackList
          {displayItems}
          selectedIds={displaySelectedIds}
          playingId={displayPlayingId}
          layout={presentationLayout}
          {isCompactColumnLayout}
          {visibleColumns}
          {hideTrackFormat}
          {mobilePresentation}
          scrollTop={dropzoneScrollTop}
          viewportHeight={dropzoneHeight}
          rowHeight={trackRowHeight}
          on:itemClick={(event) => handleItemClick(event.detail.event, event.detail.id)}
          on:itemDoubleClick={(event) => handleItemDoubleClick(event.detail)}
          on:itemContextMenu={(event) => void handleItemContextMenu(event.detail.event, event.detail.id)}
          on:rowHeight={(event) => trackRowHeight = event.detail}
        />
      {:else if displaySourceItems.length > 0 && normalizedSearchQuery}
        <div class="empty-state track-list-filter-empty">
          <p>{$t('library.noResults', { default: 'No library results match "{query}".', values: { query: searchQuery.trim() } })}</p>
        </div>
      {:else if favoritesViewActive && favoriteItems.length === 0}
        <div class="empty-state track-list-filter-empty favorites-empty-note">
          <p>{$t('library.favoritesEmpty', { default: 'Favorite tracks and subsongs will appear here.' })}</p>
        </div>
      {:else if ratingsViewActive && displaySourceItems.length === 0}
        <div class="empty-state track-list-filter-empty favorites-empty-note">
          <p>{$t('library.ratingsEmpty', { default: 'Rated tracks will appear here.' })}</p>
        </div>
      {:else if libraryMode && items.length === 0}
        <div class="empty-state track-list-filter-empty">
          <p>{mobilePresentation
            ? $t('mobile.library.empty', { default: 'Your library is empty. Add files to begin.' })
            : $t('library.empty', { default: 'Your library is empty. Add files or drop a folder here.' })}</p>
        </div>
      {/if}
    </ColumnListView>

    {#if contextMenu}
      <MenuSurface
        items={contextMenuItems}
        x={contextMenu.x}
        y={contextMenu.y}
        ariaLabel={contextMenuAriaLabel}
        on:dismiss={handleWindowDismiss}
        on:action={(event) => handleMenuAction(event.detail)}
      />
    {/if}
  </div>
</section>

<style>
  .track-list-panel.fill-parent {
    width: 100%;
    min-width: 0;
    height: 100%;
  }

  .track-list-panel.library-album-backdrop-active {
    isolation: isolate;
    color-scheme: dark;
    --text: #e4e7eb;
    --text-strong: #f7f8fa;
    --muted: #9aa3ad;
    --muted-strong: #c5cad0;
    --accent: #aab5c1;
    --accent-strong: #d1d7df;
    --accent-text: #1b1e22;
    --accent-strong-soft: rgba(209, 215, 223, 0.08);
    --bg-elevated: rgba(18, 19, 24, 0.44);
    --border: rgba(255, 255, 255, 0.16);
    --border-strong: rgba(255, 255, 255, 0.18);
    --border-soft: rgba(255, 255, 255, 0.12);
    --border-faint: rgba(255, 255, 255, 0.1);
    --border-subtle: rgba(255, 255, 255, 0.08);
    --border-covered: var(--border-subtle);
    --hover-subtle: rgba(255, 255, 255, 0.05);
    --hover-control: rgba(255, 255, 255, 0.08);
    --selection-bg: rgba(209, 215, 223, 0.14);
    --selection-strong: rgba(209, 215, 223, 0.22);
    --track-list-header-artwork-background:
      linear-gradient(180deg, rgba(18, 19, 28, 0.48) 0%, rgba(18, 19, 28, 0.38) 100%),
      rgba(255, 255, 255, 0.018);
  }

  .track-list-panel.library-album-backdrop-active .track-list-dropzone {
    z-index: 1;
    background: transparent;
  }

  .track-list-panel.library-album-transition-bypass,
  .track-list-panel.library-album-transition-bypass :global(*),
  .track-list-panel.library-album-transition-bypass :global(*::before),
  .track-list-panel.library-album-transition-bypass :global(*::after) {
    transition-duration: 0ms !important;
  }

  .track-list-panel-header {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding-bottom: 0.36rem;
  }

  .track-list-panel-header.library-mode {
    min-height: 1.7rem;
    padding: 0.025rem 0.45rem;
  }

  .track-list-dropzone.library-list-navigation {
    display: grid;
    grid-template-columns: min(var(--library-sidebar-width, clamp(4.5rem, 30%, 9rem)), max(4.5rem, calc(100% - 80px))) minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
  }

  /* Let the Library header place navigation and location beside the shared list. */
  .library-list-navigation .track-list-panel-header.library-mode {
    display: contents;
  }

  .library-list-navigation .track-list-panel-header::before,
  .library-list-navigation .track-list-panel-header::after {
    display: none;
  }

  .library-list-navigation > :global(.column-list-view) {
    grid-column: 2;
    grid-row: 2;
  }

  .track-list-panel-header.compact-heading:not(.library-mode):not(.has-column-header) {
    height: 1.7rem;
  }

  .track-list-panel-header.has-column-header:not(.library-mode) {
    padding-bottom: 0;
  }

  .track-list-filter-empty {
    place-items: center;
    padding: 1.2rem 0.9rem 1.35rem;
  }

  .track-list-filter-empty p {
    margin: 0;
  }

  .favorites-empty-note {
    color: var(--muted);
    font-size: 0.76rem;
  }
</style>
