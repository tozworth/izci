<script lang="ts">
  import { createEventDispatcher, onDestroy, tick } from 'svelte';
  import { locale, t } from 'svelte-i18n';
  import { appearanceSettings } from '$lib/stores/appearance-settings';
  import {
    LIBRARY_COLUMN_MIN_WIDTHS,
    libraryViewSettings
  } from '$lib/stores/library-view-settings';
  import type {
    LibraryColumnId,
    LibraryViewId,
    MenuActionItem,
    TrackItem,
    RepeatMode,
    TrackSelection,
    WorkspaceLibraryGroupRequest
  } from '$lib/types';
  import { prepareImportedFiles } from '$lib/services/file-verification';
  import { createAlbumArtworkController } from '$lib/services/album-artwork';
  import { trackSettings } from '$lib/stores/track-settings';
  import { normalizeTrackRating } from '$lib/services/track-ratings';
  import { buildLibraryGroupContextActions } from '$lib/services/workspace-actions';
  import { extractDroppedContent } from '$lib/utils/files';
  import TrackListPanelHeader from '$lib/components/track-list-panel/TrackListPanelHeader.svelte';
  import LibraryPanelHeader from '$lib/components/track-list-panel/LibraryPanelHeader.svelte';
  import LibraryAlbumBackdrop from '$lib/components/track-list-panel/LibraryAlbumBackdrop.svelte';
  import LibraryGroupList from '$lib/components/track-list-panel/LibraryGroupList.svelte';
  import { findRequestedLibraryGroup } from '$lib/components/track-list-panel/library-group-navigation';
  import TrackList from '$lib/components/track-list-panel/TrackList.svelte';
  import ColumnListView from '$lib/components/ColumnListView.svelte';
  import type { ColumnListViewColumn } from '$lib/components/column-list-view';
  import {
    DEFAULT_TRACK_ROW_HEIGHT,
    TRACK_LIST_VIRTUALIZATION_THRESHOLD
  } from '$lib/components/track-list-panel/track-list-virtualization';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import { buildOrderedSelection, isToggleSelection } from '$lib/components/track-list-panel/selection';
  import { buildSelectAllSelection } from '$lib/stores/queue-selection';
  import {
    compareItems,
    fitWidthsToAvailableWidth,
    getLibraryColumnIcon,
    getOrderedColumns,
    isRightAlignedColumn,
    rebalanceResizedColumns,
    type ColumnDropIndicator,
    type LibraryColumnWidths
  } from '$lib/components/track-list-panel/library-columns';
  import type { TrackListPanelContextMenu } from '$lib/components/track-list-panel/context-menu';
  import {
    filterItemsByQuery,
    formatTotalDuration,
    getTotalDuration
  } from '$lib/components/track-list-panel/search';
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

  function localizePanelLabel(label: string): string {
    if (label === 'Queue') return $t('queue.title', { default: 'Queue' });
    if (label === 'Library') return $t('library.title', { default: 'Library' });
    return label;
  }

  function localizeLibraryGroup(group: LibraryGroup): LibraryGroup {
    let label = group.label;
    let secondary = group.secondary;

    switch (group.placeholder) {
      case 'artist': label = $t('library.unknownArtist', { default: 'Unknown artist' }); break;
      case 'album': label = $t('library.unknownAlbum', { default: 'Unknown album' }); break;
      case 'genre': label = $t('library.unknownGenre', { default: 'Unknown genre' }); break;
      case 'year': label = $t('library.unknownYear', { default: 'Unknown year' }); break;
      case 'format': label = $t('library.unknownFormat', { default: 'Unknown format' }); break;
      case 'folder': label = $t('library.unknownFolder', { default: 'Unknown folder' }); break;
    }

    if (group.secondaryKind === 'trackerModule') {
      secondary = $t('library.trackerModule', { default: 'Tracker module' });
    } else if (group.secondaryKind === 'stream') {
      secondary = $t('library.stream', { default: 'Stream' });
    } else if (group.secondaryKind === 'video') {
      secondary = $t('library.video', { default: 'Video' });
    }

    return { ...group, label, secondary };
  }

  function getColumnLabel(columnId: LibraryColumnId, fallback: string): string {
    switch (columnId) {
      case 'title': return $t('library.columns.title', { default: 'Title' });
      case 'artist': return $t('library.columns.artist', { default: 'Artist' });
      case 'album': return $t('library.columns.album', { default: 'Album' });
      case 'discAndTrack': return $t('library.columns.discAndTrack', { default: 'Track' });
      case 'folder': return $t('library.columns.folder', { default: 'Folder' });
      case 'format': return $t('library.columns.format', { default: 'Format' });
      case 'duration': return $t('library.columns.duration', { default: 'Duration' });
      case 'rating': return $t('library.columns.rating', { default: 'Rating' });
      case 'plays': return $t('library.columns.plays', { default: 'Plays' });
      case 'lastPlayed': return $t('library.columns.lastPlayed', { default: 'Last played' });
      default: return fallback;
    }
  }

  function getTrackSummary(
    sourceItems: TrackItem[],
    visibleItems: TrackItem[],
    query: string
  ): string {
    const duration = formatTotalDuration(getTotalDuration(visibleItems));

    if (query && visibleItems.length !== sourceItems.length) {
      return $t('queue.summary.filteredTracks', {
        default: '{visible} of {total} {total, plural, one {song} other {songs}} · {duration}',
        values: { visible: visibleItems.length, total: sourceItems.length, duration }
      });
    }

    return $t('queue.summary.tracks', {
      default: '{count, plural, one {# song} other {# songs}} · {duration}',
      values: { count: visibleItems.length, duration }
    });
  }

  function getGroupCountSummary(
    view: LibraryGroupViewId,
    visible: number,
    total: number,
    filtered: boolean
  ): string {
    const values = { visible, total, count: visible };

    if (filtered) {
      switch (view) {
        case 'artists': return $t('library.summary.filteredArtists', { default: '{visible} of {total} {total, plural, one {artist} other {artists}}', values });
        case 'albums': return $t('library.summary.filteredAlbums', { default: '{visible} of {total} {total, plural, one {album} other {albums}}', values });
        case 'genres': return $t('library.summary.filteredGenres', { default: '{visible} of {total} {total, plural, one {genre} other {genres}}', values });
        case 'years': return $t('library.summary.filteredYears', { default: '{visible} of {total} {total, plural, one {year} other {years}}', values });
        case 'formats': return $t('library.summary.filteredFormats', { default: '{visible} of {total} {total, plural, one {format} other {formats}}', values });
        case 'folders': return $t('library.summary.filteredFolders', { default: '{visible} of {total} {total, plural, one {folder} other {folders}}', values });
      }
    }

    switch (view) {
      case 'artists': return $t('library.summary.artists', { default: '{count, plural, one {# artist} other {# artists}}', values });
      case 'albums': return $t('library.summary.albums', { default: '{count, plural, one {# album} other {# albums}}', values });
      case 'genres': return $t('library.summary.genres', { default: '{count, plural, one {# genre} other {# genres}}', values });
      case 'years': return $t('library.summary.years', { default: '{count, plural, one {# year} other {# years}}', values });
      case 'formats': return $t('library.summary.formats', { default: '{count, plural, one {# format} other {# formats}}', values });
      case 'folders': return $t('library.summary.folders', { default: '{count, plural, one {# folder} other {# folders}}', values });
    }
  }

  function getLibraryGroupSummary(
    view: LibraryGroupViewId,
    visibleGroups: number,
    totalGroups: number,
    songs: number,
    query: string
  ): string {
    const groups = getGroupCountSummary(view, visibleGroups, totalGroups, Boolean(query) && visibleGroups !== totalGroups);
    return $t('library.summary.groupsAndSongs', {
      default: '{groups} · {songs, plural, one {# song} other {# songs}}',
      values: { groups, songs }
    });
  }

  function getLibraryGroupTrackSummary(group: LibraryGroup, visibleItems: TrackItem[]): string {
    const duration = formatTotalDuration(getTotalDuration(visibleItems));

    if (visibleItems.length !== group.items.length) {
      return $t('queue.summary.filteredTracks', {
        default: '{visible} of {total} {total, plural, one {song} other {songs}} · {duration}',
        values: { visible: visibleItems.length, total: group.items.length, duration }
      });
    }

    return $t('queue.summary.tracks', {
      default: '{count, plural, one {# song} other {# songs}} · {duration}',
      values: { count: visibleItems.length, duration }
    });
  }

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

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  async function handleDrop(event: DragEvent) {
    event.preventDefault();

    if (readOnly) return;

    if (!event.dataTransfer) {
      return;
    }

    const { files: discoveredFiles, directoryHandles } = await extractDroppedContent(event.dataTransfer, {
      maxDepth: trackSettings.getSnapshot().folderNestingLimit
    });

    if (directoryHandles.length > 0) {
      dispatch('addFolders', directoryHandles);
    }

    const files = await prepareImportedFiles(discoveredFiles);

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
      columnsHeaderElement.querySelectorAll<HTMLElement>('[data-column-id]')
    );
    const columnBounds = visibleColumns
      .map((column) => {
        const element = columnElements.find((node) => node.dataset.columnId === column.id);

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

  async function focusTrackRow(id: string) {
    await scrollTrackIntoView(id);
    await tick();

    if (!dropzoneElement || typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
      return;
    }

    const rowButton = dropzoneElement.querySelector<HTMLButtonElement>(
      `[data-track-id="${CSS.escape(id)}"] [data-track-row-button]`
    );
    rowButton?.focus();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      handleWindowDismiss();
      return;
    }

    if (
      (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      event.target instanceof Element &&
      dropzoneElement?.contains(event.target)
    ) {
      const currentRow = event.target.closest<HTMLElement>('[data-track-id]');
      const currentIndex = currentRow
        ? displayItems.findIndex((item) => item.id === currentRow.dataset.trackId)
        : -1;

      if (currentIndex < 0) {
        return;
      }

      const nextIndex = clamp(currentIndex + (event.key === 'ArrowUp' ? -1 : 1), 0, displayItems.length - 1);
      const nextItem = displayItems[nextIndex];
      event.preventDefault();

      if (!nextItem || nextIndex === currentIndex) {
        return;
      }

      dispatch(
        'setSelection',
        buildOrderedSelection(displayItems, displaySelectedIds, displaySelectionAnchorId, nextItem.id, event.shiftKey, false)
      );
      void focusTrackRow(nextItem.id);
    }
  }

  function handleWindowKeydownCapture(event: KeyboardEvent) {
    const editingTarget = event.target instanceof HTMLElement
      && (event.target.matches('input, textarea, select') || event.target.isContentEditable);

    if (
      keyboardActive
      && event.key.toLowerCase() === 'a'
      && event.ctrlKey
      && !event.altKey
      && !event.shiftKey
      && !event.metaKey
      && !editingTarget
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();

      if (showTrackRows) {
        dispatch('setSelection', buildSelectAllSelection(displayItems));
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

    if (contextMenu) {
      event.preventDefault();
      event.stopImmediatePropagation();
      handleWindowDismiss();
      return;
    }

    if (libraryMode && selectedGroupKey !== null) {
      event.preventDefault();
      event.stopImmediatePropagation();
      handleWindowDismiss();
      void handleLibraryGroupBack();
    }
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
      dispatch('activate', id);
      closeContextMenu();
      return;
    }

    emitSelection(event, id);
    closeContextMenu();
  }

  function handleItemDoubleClick(id: string) {
    dispatch('activate', id);
  }

  function handleItemContextMenu(event: MouseEvent, id: string) {
    if (readOnly) return;
    event.preventDefault();

    const itemIsSelected = displaySelectedIds.includes(id);

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
      ids: itemIsSelected ? displaySelectedIds : [id]
    };

  }

  function handleLibraryGroupContextMenu(event: MouseEvent, key: string) {
    event.preventDefault();

    if (!groupView) {
      return;
    }

    const group = libraryGroups.find((entry) => entry.key === key);

    if (!group) {
      return;
    }

    const ids = group.items.map((item) => item.id);
    dispatch('setSelection', {
      ids,
      anchorId: ids[0] ?? null,
      focusId: ids[0] ?? null
    });

    contextMenu = {
      kind: 'library-group',
      x: event.clientX,
      y: event.clientY,
      ids,
      view: groupView,
      key,
      pinned: $libraryViewSettings.pinnedGroupKeys[groupView].includes(key)
    };

  }

  function openPanelContextMenu(event: MouseEvent): void {
    if (readOnly || libraryMode) return;

    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-track-id], .clv-columns-header, .clv-column-header, .panel-header')) {
      return;
    }

    event.preventDefault();
    contextMenu = {
      kind: 'panel',
      x: event.clientX,
      y: event.clientY
    };
  }

  function openPanelHeaderContextMenu(event: MouseEvent): void {
    if (readOnly || libraryMode) return;
    event.preventDefault();
    contextMenu = {
      kind: 'panel',
      x: event.clientX,
      y: event.clientY
    };
  }

  function handleContextAction(actionId: string) {
    if (
      !contextMenu
      || (contextMenu.kind !== 'items'
        && contextMenu.kind !== 'library-group'
        && contextMenu.kind !== 'panel')
    ) {
      return;
    }

    dispatch('contextAction', {
      actionId,
      ids: contextMenu.kind === 'items' || contextMenu.kind === 'library-group'
        ? contextMenu.ids
        : []
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

  function handleColumnVisibilityToggle(columnId: LibraryColumnId): void {
    const column = orderedColumns.find((candidate) => candidate.id === columnId);

    if (!column || (column.visible && visibleColumnCount === 1)) {
      return;
    }

    libraryViewSettings.setColumnVisibility(column.id, !column.visible);
  }

  function columnResizeLabel(column: ColumnListViewColumn): string {
    return $t('library.columns.resize', {
      default: 'Resize {column} column',
      values: { column: column.label }
    });
  }

  function getContextMenuActionLabel(action: MenuActionItem): string {
    switch (action.id) {
      case 'go-to-library': return $t('queue.actions.goTo', { default: 'Go to...' });
      case 'go-to-library-artist': return $t('library.columns.artist', { default: 'Artist' });
      case 'go-to-library-album': return $t('main.trackDetails.album', { default: 'Album' });
      case 'go-to-library-genre': return $t('main.trackDetails.genre', { default: 'Genre' });
      case 'go-to-library-year': return $t('main.trackDetails.year', { default: 'Year' });
      case 'go-to-library-format': return $t('main.trackDetails.format', { default: 'Format' });
      case 'track-details': return $t('queue.actions.trackDetails', { default: 'Track details' });
      case 'play-next': return $t('queue.actions.playNext', { default: 'Play next' });
      case 'add-to-up-next': return $t('queue.actions.addToUpNext', { default: 'Add to up next' });
      case 'toggle-library': return action.icon === 'remove_circle'
        ? $t('queue.actions.removeFromLibrary', { default: 'Remove from library' })
        : $t('queue.actions.addToLibrary', { default: 'Add to library' });
      case 'toggle-favorite': return action.icon === 'heart_minus'
        ? $t('queue.actions.removeFromFavorites', { default: 'Remove from favorites' })
        : $t('queue.actions.addToFavorites', { default: 'Add to favorites' });
      case 'rate': return $t('queue.actions.rate', { default: 'Rate' });
      case 'rate:clear': return $t('queue.actions.clearRating', { default: 'Clear rating' });
      case 'separate-subsongs': return $t('queue.actions.separateSubsongs', { default: 'Separate subsongs' });
      case 'add-to-queue': return $t('queue.actions.addToQueue', { default: 'Add to queue' });
      case 'replace-queue': return $t('queue.actions.replaceQueue', { default: 'Replace queue' });
      case 'shuffle-play': return $t('queue.actions.shufflePlay', { default: 'Shuffle play' });
      case 'reset-play-count': return $t('queue.actions.resetPlayCount', { default: 'Reset play count' });
      case 'copy-filename': return $t('queue.actions.copyFilename', { default: 'Copy filename' });
      case 'randomize-queue': return $t('queue.actions.randomize', { default: 'Randomize' });
      case 'remove-favorite': return $t('queue.actions.removeFromFavorites', { default: 'Remove from favorites' });
      case 'remove': return $t('queue.actions.remove', { default: 'Remove' });
      default: return action.label;
    }
  }

  function getContextMenuShortcut(shortcut: string | undefined): string | undefined {
    return shortcut === 'Delete'
      ? $t('queue.shortcuts.delete', { default: 'Delete' })
      : shortcut;
  }

  function handleMenuAction(actionId: string) {
    if (contextMenu?.kind === 'library-group' && actionId === 'pin-library-group') {
      libraryViewSettings.pinGroup(contextMenu.view, contextMenu.key);
      closeContextMenu();
      return;
    }

    if (contextMenu?.kind === 'library-group' && actionId === 'unpin-library-group') {
      libraryViewSettings.unpinGroup(contextMenu.view, contextMenu.key);
      closeContextMenu();
      return;
    }

    handleContextAction(actionId);
  }

  function handleLibraryGroupUnpin(key: string) {
    if (!groupView) return;
    libraryViewSettings.unpinGroup(groupView, key);
  }

  function handleLibraryGroupMove(
    detail: { key: string; targetKey: string; position: 'before' | 'after' }
  ) {
    if (!groupView) return;
    libraryViewSettings.movePinnedGroup(groupView, detail.key, detail.targetKey, detail.position);
  }

  function handleSearchToggle() {
    searchInputExpanded = true;
  }

  function clearSelection() {
    if (displaySelectedIds.length === 0) return;

    dispatch('setSelection', {
      ids: [],
      anchorId: null,
      focusId: null
    });
  }

  function handleLibraryViewChange(view: LibraryViewId) {
    if (view === activeLibraryView) {
      if (selectedGroupKey) handleLibraryGroupBack();
      return;
    }

    selectedGroupKey = null;
    clearSelection();
    libraryViewSettings.setActiveView(view);
    dropzoneElement?.scrollTo({ top: 0 });
  }

  function handleLibraryGroupOpen(key: string) {
    libraryGroupScrollPositions.set(activeLibraryView, dropzoneElement?.scrollTop ?? 0);
    selectedGroupKey = key;
    clearSelection();
    dropzoneElement?.scrollTo({ top: 0 });
  }

  async function handleLibraryGroupBack() {
    const scrollTop = libraryGroupScrollPositions.get(activeLibraryView) ?? 0;
    selectedGroupKey = null;
    clearSelection();
    await tick();
    dropzoneElement?.scrollTo({ top: scrollTop });
    updateQueueHeaderState();
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

    if (target.closest('.clv-column-resizer')) {
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

    if (displayItems.length > TRACK_LIST_VIRTUALIZATION_THRESHOLD) {
      const index = displayItems.findIndex((item) => item.id === id);
      if (index < 0) return;

      const centeredTop = index * trackRowHeight - (dropzoneElement.clientHeight - trackRowHeight) / 2;
      const maxScrollTop = Math.max(displayItems.length * trackRowHeight - dropzoneElement.clientHeight, 0);
      dropzoneElement.scrollTo({ top: clamp(centeredTop, 0, maxScrollTop) });
      dropzoneScrollTop = dropzoneElement.scrollTop;
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

  function localizeContextMenuAction(action: MenuActionItem): MenuActionItem {
    return {
      ...action,
      label: getContextMenuActionLabel(action),
      shortcut: getContextMenuShortcut(action.shortcut),
      children: action.children?.map(localizeContextMenuAction)
    };
  }

  function buildContextMenuActions(menu: TrackListPanelContextMenu | null): MenuActionItem[] {
    if (!menu) return [];

    if (menu.kind === 'panel') {
      return panelContextMenuItems;
    }

    const actions = getContextMenuActions(menu.ids);
    return menu.kind === 'library-group'
      ? buildLibraryGroupContextActions(actions)
      : actions;
  }

  async function openRequestedLibraryGroup(
    request: WorkspaceLibraryGroupRequest,
    group: LibraryGroup
  ) {
    if (!libraryMode) return;

    try {
      libraryViewSettings.setSearchQuery('');
      searchInputExpanded = false;
      selectedGroupKey = group.key;
      dispatch('setSelection', {
        ids: [request.trackId],
        anchorId: request.trackId,
        focusId: request.trackId
      });
      await scrollTrackIntoView(request.trackId);
    } finally {
      dispatch('libraryGroupRequestHandled', request.token);
    }
  }

  $: activeLibraryView = libraryMode
    ? !$trackSettings.enableRatings && $libraryViewSettings.activeView === 'ratings'
      ? 'songs'
      : $libraryViewSettings.activeView
    : 'songs';
  $: favoritesViewActive = libraryMode && activeLibraryView === 'favorites';
  $: ratingsViewActive = libraryMode && activeLibraryView === 'ratings';
  $: displaySourceItems = favoritesViewActive
    ? favoriteItems
    : ratingsViewActive
      ? items.filter((item) => normalizeTrackRating(item.rating) !== undefined)
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
  $: orderedColumns = layout === 'columns'
    ? getOrderedColumns(activeLibraryTableSettings.order, activeLibraryTableSettings.columns)
        .filter((column) => $trackSettings.enableRatings || column.id !== 'rating')
        .map((column) => ({ ...column, label: getColumnLabel(column.id, column.label) }))
        .map((column, _index, columns) =>
          columns.some((candidate) => candidate.visible)
            ? column
            : { ...column, visible: column.id === 'title' }
        )
    : [];
  $: groupView = activeLibraryView === 'songs' || activeLibraryView === 'favorites' || activeLibraryView === 'ratings'
    ? null
    : activeLibraryView as LibraryGroupViewId;
  $: libraryGroups = groupView
    ? buildLibraryGroups(items, groupView, $locale ?? undefined).map(localizeLibraryGroup)
    : [];
  $: requestedLibraryGroup = findRequestedLibraryGroup(
    libraryGroupRequest,
    activeLibraryView,
    libraryGroups
  );
  $: pinnedLibraryGroupKeys = groupView ? $libraryViewSettings.pinnedGroupKeys[groupView] : [];
  $: orderedLibraryGroups = groupView === 'folders'
    ? libraryGroups
    : groupView
      ? orderLibraryGroups(libraryGroups, pinnedLibraryGroupKeys)
      : [];
  $: visibleLibraryGroups = groupView ? filterLibraryGroups(orderedLibraryGroups, normalizedSearchQuery) : [];
  $: visibleGroupSongCount = new Set(
    visibleLibraryGroups.flatMap((group) => group.items.map((item) => item.id))
  ).size;
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
  $: showTrackRows = !libraryMode || activeLibraryView === 'songs' || activeLibraryView === 'favorites' || activeLibraryView === 'ratings' || Boolean(selectedLibraryGroup);
  $: unfilteredDisplayItems = libraryMode && activeLibraryView !== 'songs' && activeLibraryView !== 'favorites' && activeLibraryView !== 'ratings'
    ? selectedLibraryGroup?.items ?? []
    : displaySourceItems;
  $: filteredItems = selectedLibraryGroup
    ? filterLibraryGroupItems(selectedLibraryGroup, normalizedSearchQuery)
    : filterItemsByQuery(unfilteredDisplayItems, normalizedSearchQuery);
  $: trackSummary = selectedLibraryGroup
    ? getLibraryGroupTrackSummary(selectedLibraryGroup, filteredItems)
    : getTrackSummary(displaySourceItems, filteredItems, normalizedSearchQuery);
  $: libraryTooltipDetails = getLibraryViewTooltipDetails(
    items,
    favoriteItems,
    normalizedSearchQuery,
    $locale ?? undefined
  );
  $: librarySummary = groupView && !selectedLibraryGroup
    ? getLibraryGroupSummary(
        groupView,
        visibleLibraryGroups.length,
        libraryGroups.length,
        normalizedSearchQuery ? visibleGroupSongCount : items.length,
        normalizedSearchQuery
      )
    : trackSummary;
  $: repeatIcon = repeatMode === 'one' ? 'repeat_one' : 'repeat';
  $: repeatLabel =
    repeatMode === 'one'
      ? $t('queue.repeat.currentTrack', { default: 'Repeat current track' })
      : repeatMode === 'all'
        ? $t('queue.repeat.queue', { default: 'Repeat queue' })
        : $t('queue.repeat.off', { default: 'Repeat off' });
  $: localizedPanelTitle = localizePanelLabel(panelTitle);
  $: localizedRegionLabel = localizePanelLabel(regionLabel);
  $: contextMenuActions = buildContextMenuActions(contextMenu);
  $: panelContextMenuItems = [
    {
      id: 'randomize-queue',
      label: $t('queue.actions.randomize', { default: 'Randomize' }),
      icon: 'shuffle'
    } satisfies MenuActionItem
  ];
  $: storedVisibleColumns = orderedColumns.filter((column) => column.visible);
  $: visibleColumnCount = storedVisibleColumns.length;
  $: contextMenuItems = [
    ...(contextMenu?.kind === 'library-group' && contextMenu.view !== 'folders'
      ? [{
          id: contextMenu.pinned ? 'unpin-library-group' : 'pin-library-group',
          label: contextMenu.pinned
            ? $t('library.unpin', { default: 'Unpin' })
            : $t('library.pinToTop', { default: 'Pin to top' }),
          icon: contextMenu.pinned ? 'keep_off' : 'keep'
        } satisfies MenuActionItem]
      : []),
    ...contextMenuActions.map((action, index) => {
      const localizedAction = localizeContextMenuAction(action);
      return {
        ...localizedAction,
        separatorBefore: contextMenu?.kind === 'library-group' && contextMenu.view !== 'folders' && index === 0
          ? true
          : localizedAction.separatorBefore
      };
    })
  ];
  $: contextMenuAriaLabel = contextMenu?.kind === 'library-group'
      ? $t('queue.contextMenu.libraryGroupActions', { default: 'Library group actions' })
      : contextMenu?.kind === 'panel'
        ? $t('queue.contextMenu.panelActions', { default: 'Queue actions' })
        : $t('queue.contextMenu.itemActions', { default: '{panel} item actions', values: { panel: localizedPanelTitle } });
  $: isCompactColumnLayout =
    !mobilePresentation &&
    layout === 'columns' &&
    dropzoneWidth > 0 &&
    dropzoneWidth < 280 &&
    !$appearanceSettings.keepLibraryColumnsVisibleInNarrowLayout;
  $: presentationLayout = mobilePresentation ? 'list' : layout;
  $: hideTrackFormat = presentationLayout === 'list' && dropzoneWidth > 0 && dropzoneWidth < 280;
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
  $: listViewColumns = visibleColumns.map((column): ColumnListViewColumn => ({
    id: column.id,
    label: column.label,
    width: column.width,
    minWidth: LIBRARY_COLUMN_MIN_WIDTHS[column.id],
    icon: getLibraryColumnIcon(column.id),
    rightAligned: isRightAlignedColumn(column.id),
    visible: column.visible
  }));
  $: allListColumns = orderedColumns.map((column): ColumnListViewColumn => ({
    id: column.id,
    label: column.label,
    width: column.width,
    minWidth: LIBRARY_COLUMN_MIN_WIDTHS[column.id],
    icon: getLibraryColumnIcon(column.id),
    rightAligned: isRightAlignedColumn(column.id),
    visible: column.visible
  }));
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
      class:has-secondary-library-row={libraryMode && (showSearchInput || Boolean(selectedLibraryGroup))}
      class:is-covered={queueHeaderCovered}
      class:has-column-header={showTrackRows && filteredItems.length > 0 && presentationLayout === 'columns' && !isCompactColumnLayout}
      on:contextmenu={openPanelHeaderContextMenu}
    >
      {#if libraryMode}
        <LibraryPanelHeader
          bind:searchInputElement={searchInputElement}
          activeView={activeLibraryView}
          ratingsEnabled={$trackSettings.enableRatings}
          summary={librarySummary}
          tooltipDetails={libraryTooltipDetails}
          groupLabel={selectedLibraryGroup?.label ?? ''}
          showBack={Boolean(selectedLibraryGroup)}
          visibleViews={$libraryViewSettings.visibleViews}
          {showSearchInput}
          {searchQuery}
          {readOnly}
          on:viewChange={(event) => handleLibraryViewChange(event.detail)}
          on:viewVisibilityToggle={(event) => libraryViewSettings.toggleViewVisibility(event.detail)}
          on:back={handleLibraryGroupBack}
          on:searchToggle={handleSearchToggle}
          on:searchInput={(event) => handleSearchInput(event.detail)}
          on:searchClose={handleSearchClose}
          on:openFiles={() => dispatch('openFiles')}
        />
      {:else}
        <TrackListPanelHeader
          bind:searchInputElement={searchInputElement}
          panelTitle={localizedPanelTitle}
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
          {readOnly}
          on:searchToggle={handleSearchToggle}
          on:searchInput={(event) => handleSearchInput(event.detail)}
          on:searchClose={handleSearchClose}
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
      showHeader={showTrackRows && filteredItems.length > 0 && presentationLayout === 'columns' && !isCompactColumnLayout}
      columnGap={`${COLUMN_GAP}px`}
      contextMenuLabel={$t('queue.contextMenu.columns', { default: '{panel} columns', values: { panel: localizedPanelTitle } })}
      {resizingColumnId}
      {draggedColumnId}
      {dropIndicator}
      {activeSort}
      resizeLabel={columnResizeLabel}
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

      {#if !showTrackRows && visibleLibraryGroups.length > 0 && groupView}
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
          <p>{$t('library.empty', { default: 'Your library is empty. Add files or drop a folder here.' })}</p>
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
    padding: 0.025rem 0.45rem;
  }

  .track-list-panel-header.compact-heading:not(.has-column-header),
  .track-list-panel-header.library-mode:not(.has-column-header):not(.has-secondary-library-row) {
    height: 1.7rem;
  }

  .track-list-panel-header.has-column-header {
    padding-bottom: 0;
  }

  .track-list-panel-header.library-mode.has-column-header {
    gap: 0;
    padding-top: 0.05rem;
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
