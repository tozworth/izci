<script lang="ts">
  import { createEventDispatcher, onDestroy, tick } from 'svelte';
  import { locale, t } from 'svelte-i18n';
  import { appearanceSettings } from '$lib/stores/appearance-settings';
  import {
    libraryViewSettings
  } from '$lib/stores/library-view-settings';
  import type {
    LibraryColumnId,
    LibraryViewId,
    MenuActionItem,
    PlaylistItem,
    PlaylistRepeatMode,
    PlaylistSelection
  } from '$lib/types';
  import { prepareImportedFiles } from '$lib/services/file-verification';
  import { createAlbumArtworkController } from '$lib/services/album-artwork';
  import { trackSettings } from '$lib/stores/track-settings';
  import { extractDroppedContent } from '$lib/utils/files';
  import PlaylistPanelHeader from '$lib/components/playlist-panel/PlaylistPanelHeader.svelte';
  import LibraryPanelHeader from '$lib/components/playlist-panel/LibraryPanelHeader.svelte';
  import LibraryAlbumBackdrop from '$lib/components/playlist-panel/LibraryAlbumBackdrop.svelte';
  import LibraryGroupList from '$lib/components/playlist-panel/LibraryGroupList.svelte';
  import LibraryColumnsHeader from '$lib/components/playlist-panel/LibraryColumnsHeader.svelte';
  import TrackList from '$lib/components/playlist-panel/TrackList.svelte';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import { buildOrderedSelection, isToggleSelection } from '$lib/components/playlist-panel/selection';
  import {
    compareItems,
    fitWidthsToAvailableWidth,
    getOrderedColumns,
    rebalanceResizedColumns,
    type ColumnDropIndicator,
    type LibraryColumnWidths
  } from '$lib/components/playlist-panel/library-columns';
  import type { PlaylistPanelContextMenu } from '$lib/components/playlist-panel/context-menu';
  import {
    filterItemsByQuery,
    formatTotalDuration,
    getTotalDuration
  } from '$lib/components/playlist-panel/search';
  import {
    buildLibraryGroups,
    filterLibraryGroupItems,
    filterLibraryGroups,
    getLibraryViewTooltipDetails,
    orderLibraryGroups,
    type LibraryGroup,
    type LibraryGroupViewId
  } from '$lib/components/playlist-panel/library-views';

  export let items: PlaylistItem[] = [];
  export let selectedIds: string[] = [];
  export let selectionAnchorId: string | null = null;
  export let playingId: string | null = null;
  export let favoriteItems: PlaylistItem[] = [];
  export let favoriteSelectedIds: string[] = [];
  export let favoriteSelectionAnchorId: string | null = null;
  export let favoritePlayingId: string | null = null;
  export let panelTitle = 'Playlist';
  export let regionLabel = 'Playlist';
  export let layout: 'list' | 'columns' = 'list';
  export let fillParent = false;
  export let hideEyebrow = false;
  export let showShuffleControl = true;
  export let showRepeatControl = true;
  export let showSearchControl = false;
  export let libraryMode = false;
  export let shuffleEnabled = false;
  export let repeatMode: PlaylistRepeatMode = 'off';
  export let jumpToItemRequest: { id: string; token: number } | null = null;
  export let getContextMenuActions: (ids: string[]) => MenuActionItem[] = () => [
    { id: 'remove', label: 'Remove', icon: 'delete' }
  ];

  const dispatch = createEventDispatcher<{
    addFiles: FileList | File[];
    addFolders: FileSystemDirectoryHandle[];
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
  let dropzoneElement: HTMLDivElement | null = null;
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
    if (label === 'Playlist') return $t('playlist.title', { default: 'Playlist' });
    if (label === 'Library') return $t('playlist.library.title', { default: 'Library' });
    return label;
  }

  function localizeLibraryGroup(group: LibraryGroup): LibraryGroup {
    let label = group.label;
    let secondary = group.secondary;

    switch (group.placeholder) {
      case 'artist': label = $t('playlist.library.unknownArtist', { default: 'Unknown artist' }); break;
      case 'album': label = $t('playlist.library.unknownAlbum', { default: 'Unknown album' }); break;
      case 'genre': label = $t('playlist.library.unknownGenre', { default: 'Unknown genre' }); break;
      case 'year': label = $t('playlist.library.unknownYear', { default: 'Unknown year' }); break;
      case 'format': label = $t('playlist.library.unknownFormat', { default: 'Unknown format' }); break;
      case 'folder': label = $t('playlist.library.unknownFolder', { default: 'Unknown folder' }); break;
    }

    if (group.secondaryKind === 'trackerModule') {
      secondary = $t('playlist.library.trackerModule', { default: 'Tracker module' });
    } else if (group.secondaryKind === 'stream') {
      secondary = $t('playlist.library.stream', { default: 'Stream' });
    } else if (group.secondaryKind === 'video') {
      secondary = $t('playlist.library.video', { default: 'Video' });
    }

    return { ...group, label, secondary };
  }

  function getColumnLabel(columnId: LibraryColumnId, fallback: string): string {
    switch (columnId) {
      case 'title': return $t('playlist.library.columns.title', { default: 'Title' });
      case 'artist': return $t('playlist.library.columns.artist', { default: 'Artist' });
      case 'album': return $t('playlist.library.columns.album', { default: 'Album' });
      case 'disc': return $t('playlist.library.columns.disc', { default: 'Disc' });
      case 'track': return $t('playlist.library.columns.track', { default: 'Track' });
      case 'folder': return $t('playlist.library.columns.folder', { default: 'Folder' });
      case 'format': return $t('playlist.library.columns.format', { default: 'Format' });
      case 'duration': return $t('playlist.library.columns.duration', { default: 'Duration' });
      case 'plays': return $t('playlist.library.columns.plays', { default: 'Plays' });
      default: return fallback;
    }
  }

  function getTrackSummary(
    sourceItems: PlaylistItem[],
    visibleItems: PlaylistItem[],
    query: string
  ): string {
    const duration = formatTotalDuration(getTotalDuration(visibleItems));

    if (query && visibleItems.length !== sourceItems.length) {
      return $t('playlist.summary.filteredTracks', {
        default: '{visible} of {total} {total, plural, one {song} other {songs}} · {duration}',
        values: { visible: visibleItems.length, total: sourceItems.length, duration }
      });
    }

    return $t('playlist.summary.tracks', {
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
        case 'artists': return $t('playlist.library.summary.filteredArtists', { default: '{visible} of {total} {total, plural, one {artist} other {artists}}', values });
        case 'albums': return $t('playlist.library.summary.filteredAlbums', { default: '{visible} of {total} {total, plural, one {album} other {albums}}', values });
        case 'genres': return $t('playlist.library.summary.filteredGenres', { default: '{visible} of {total} {total, plural, one {genre} other {genres}}', values });
        case 'years': return $t('playlist.library.summary.filteredYears', { default: '{visible} of {total} {total, plural, one {year} other {years}}', values });
        case 'formats': return $t('playlist.library.summary.filteredFormats', { default: '{visible} of {total} {total, plural, one {format} other {formats}}', values });
        case 'folders': return $t('playlist.library.summary.filteredFolders', { default: '{visible} of {total} {total, plural, one {folder} other {folders}}', values });
      }
    }

    switch (view) {
      case 'artists': return $t('playlist.library.summary.artists', { default: '{count, plural, one {# artist} other {# artists}}', values });
      case 'albums': return $t('playlist.library.summary.albums', { default: '{count, plural, one {# album} other {# albums}}', values });
      case 'genres': return $t('playlist.library.summary.genres', { default: '{count, plural, one {# genre} other {# genres}}', values });
      case 'years': return $t('playlist.library.summary.years', { default: '{count, plural, one {# year} other {# years}}', values });
      case 'formats': return $t('playlist.library.summary.formats', { default: '{count, plural, one {# format} other {# formats}}', values });
      case 'folders': return $t('playlist.library.summary.folders', { default: '{count, plural, one {# folder} other {# folders}}', values });
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
    return $t('playlist.library.summary.groupsAndSongs', {
      default: '{groups} · {songs, plural, one {# song} other {# songs}}',
      values: { groups, songs }
    });
  }

  function getLibraryGroupTrackSummary(group: LibraryGroup, visibleItems: PlaylistItem[]): string {
    const duration = formatTotalDuration(getTotalDuration(visibleItems));

    if (visibleItems.length !== group.items.length) {
      return $t('playlist.summary.filteredTracks', {
        default: '{visible} of {total} {total, plural, one {song} other {songs}} · {duration}',
        values: { visible: visibleItems.length, total: group.items.length, duration }
      });
    }

    return $t('playlist.summary.tracks', {
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

  async function focusTrackRow(id: string) {
    await tick();

    if (!dropzoneElement || typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
      return;
    }

    const rowButton = dropzoneElement.querySelector<HTMLButtonElement>(
      `[data-track-id="${CSS.escape(id)}"] [data-track-row-button]`
    );
    rowButton?.focus();
    await scrollTrackIntoView(id);
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

  function updatePlaylistHeaderState() {
    playlistHeaderCovered = (dropzoneElement?.scrollTop ?? 0) > 0;
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
    emitSelection(event, id);
    closeContextMenu();
  }

  function handleItemDoubleClick(id: string) {
    dispatch('activate', id);
  }

  function handleItemContextMenu(event: MouseEvent, id: string) {
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

  function handleColumnContextMenu(event: MouseEvent) {
    if (layout !== 'columns' || isCompactColumnLayout) {
      return;
    }

    event.preventDefault();
    contextMenu = {
      kind: 'columns',
      x: event.clientX,
      y: event.clientY
    };

  }

  function handleContextAction(actionId: string) {
    if (!contextMenu || (contextMenu.kind !== 'items' && contextMenu.kind !== 'library-group')) {
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

  function handleColumnContextAction(actionId: string) {
    const column = orderedColumns.find((candidate) => `toggle-column:${candidate.id}` === actionId);

    if (!column || (column.visible && visibleColumnCount === 1)) {
      return;
    }

    handleColumnVisibilityChange(column.id, !column.visible);
    closeContextMenu();
  }

  function getContextMenuActionLabel(action: MenuActionItem): string {
    switch (action.id) {
      case 'track-details': return $t('playlist.actions.trackDetails', { default: 'Track details' });
      case 'toggle-library': return action.icon === 'remove_circle'
        ? $t('playlist.actions.removeFromLibrary', { default: 'Remove from library' })
        : $t('playlist.actions.addToLibrary', { default: 'Add to library' });
      case 'toggle-favorite': return action.icon === 'heart_minus'
        ? $t('playlist.actions.removeFromFavorites', { default: 'Remove from favorites' })
        : $t('playlist.actions.addToFavorites', { default: 'Add to favorites' });
      case 'separate-subsongs': return $t('playlist.actions.separateSubsongs', { default: 'Separate subsongs' });
      case 'add-to-playlist': return $t('playlist.actions.addToPlaylist', { default: 'Add to playlist' });
      case 'replace-playlist': return $t('playlist.actions.replacePlaylist', { default: 'Replace playlist' });
      case 'reset-play-count': return $t('playlist.actions.resetPlayCount', { default: 'Reset play count' });
      case 'remove-favorite': return $t('playlist.actions.removeFromFavorites', { default: 'Remove from favorites' });
      case 'remove': return $t('playlist.actions.remove', { default: 'Remove' });
      default: return action.label;
    }
  }

  function getContextMenuShortcut(shortcut: string | undefined): string | undefined {
    return shortcut === 'Delete'
      ? $t('playlist.shortcuts.delete', { default: 'Delete' })
      : shortcut;
  }

  function handleMenuAction(actionId: string) {
    if (contextMenu?.kind === 'columns') {
      handleColumnContextAction(actionId);
      return;
    }

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
    updatePlaylistHeaderState();
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

    const visibleHeight = Math.max(dropzoneElement.clientHeight, row.offsetHeight);
    const rowTop = row.offsetTop;
    const centeredTop = rowTop - (visibleHeight - row.offsetHeight) / 2;
    const maxScrollTop = Math.max(dropzoneElement.scrollHeight - dropzoneElement.clientHeight, 0);
    dropzoneElement.scrollTo({
      top: clamp(centeredTop, 0, maxScrollTop)
    });
  }

  $: activeLibraryView = libraryMode ? $libraryViewSettings.activeView : 'songs';
  $: favoritesViewActive = libraryMode && activeLibraryView === 'favorites';
  $: displaySourceItems = favoritesViewActive ? favoriteItems : items;
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
        .map((column) => ({ ...column, label: getColumnLabel(column.id, column.label) }))
    : [];
  $: groupView = activeLibraryView === 'songs' || activeLibraryView === 'favorites'
    ? null
    : activeLibraryView as LibraryGroupViewId;
  $: libraryGroups = groupView
    ? buildLibraryGroups(items, groupView, $locale ?? undefined).map(localizeLibraryGroup)
    : [];
  $: pinnedLibraryGroupKeys = groupView ? $libraryViewSettings.pinnedGroupKeys[groupView] : [];
  $: orderedLibraryGroups = groupView ? orderLibraryGroups(libraryGroups, pinnedLibraryGroupKeys) : [];
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
  $: showTrackRows = !libraryMode || activeLibraryView === 'songs' || activeLibraryView === 'favorites' || Boolean(selectedLibraryGroup);
  $: unfilteredDisplayItems = libraryMode && activeLibraryView !== 'songs' && activeLibraryView !== 'favorites'
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
      ? $t('playlist.repeat.currentTrack', { default: 'Repeat current track' })
      : repeatMode === 'all'
        ? $t('playlist.repeat.playlist', { default: 'Repeat playlist' })
        : $t('playlist.repeat.off', { default: 'Repeat off' });
  $: localizedPanelTitle = localizePanelLabel(panelTitle);
  $: localizedRegionLabel = localizePanelLabel(regionLabel);
  $: contextMenuActions = contextMenu?.kind === 'items' || contextMenu?.kind === 'library-group'
    ? getContextMenuActions(contextMenu.ids)
    : [];
  $: storedVisibleColumns = orderedColumns.filter((column) => column.visible);
  $: visibleColumnCount = storedVisibleColumns.length;
  $: contextMenuItems = contextMenu?.kind === 'columns'
    ? orderedColumns.map((column) => ({
        id: `toggle-column:${column.id}`,
        label: column.label,
        icon: column.visible ? 'check_box' : 'check_box_outline_blank',
        checked: column.visible,
        disabled: column.visible && visibleColumnCount === 1
      } satisfies MenuActionItem))
    : [
        ...(contextMenu?.kind === 'library-group'
          ? [{
              id: contextMenu.pinned ? 'unpin-library-group' : 'pin-library-group',
              label: contextMenu.pinned
                ? $t('playlist.library.unpin', { default: 'Unpin' })
                : $t('playlist.library.pinToTop', { default: 'Pin to top' }),
              icon: contextMenu.pinned ? 'keep_off' : 'keep'
            } satisfies MenuActionItem]
          : []),
        ...contextMenuActions.map((action, index) => ({
          ...action,
          separatorBefore: contextMenu?.kind === 'library-group' && index === 0
            ? true
            : action.separatorBefore,
          label: getContextMenuActionLabel(action),
          shortcut: getContextMenuShortcut(action.shortcut)
        }))
      ];
  $: contextMenuAriaLabel = contextMenu?.kind === 'columns'
    ? $t('playlist.contextMenu.columns', { default: '{panel} columns', values: { panel: localizedPanelTitle } })
    : contextMenu?.kind === 'library-group'
      ? $t('playlist.contextMenu.libraryGroupActions', { default: 'Library group actions' })
      : $t('playlist.contextMenu.itemActions', { default: '{panel} item actions', values: { panel: localizedPanelTitle } });
  $: isCompactColumnLayout =
    layout === 'columns' &&
    dropzoneWidth > 0 &&
    dropzoneWidth < 280 &&
    !$appearanceSettings.keepLibraryColumnsVisibleInNarrowLayout;
  $: hideTrackFormat = layout === 'list' && dropzoneWidth > 0 && dropzoneWidth < 280;
  $: activeSort = activeLibraryTableSettings.sort;
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
    layout === 'columns'
      ? [...filteredItems].sort((left, right) =>
          compareItems(left, right, activeSort, $locale ?? undefined)
        )
      : filteredItems;
  $: tableTemplateColumns = visibleColumns.map((column) => `minmax(${column.width}px, ${column.width}px)`).join(' ');
  $: tableColumnGap = `${COLUMN_GAP}px`;
  $: if (contextMenu?.kind === 'columns' && (layout !== 'columns' || isCompactColumnLayout || !showTrackRows)) {
    closeContextMenu();
  }
  $: if (!showSearchControl) {
    searchInputExpanded = false;
  }
  $: if (items || favoriteItems) {
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
  on:keydown|capture={handleWindowKeydownCapture}
  on:keydown={handleWindowKeydown}
  on:blur={handleWindowDismiss}
  on:resize={handleWindowDismiss}
/>

<section
  class="panel playlist-panel"
  class:fill-parent={fillParent}
  class:library-album-backdrop-active={Boolean(selectedAlbumArtworkUrl)}
  class:library-album-transition-bypass={albumBackdropTransitionBypassed}
>
  {#if selectedAlbumArtworkUrl}
    <!-- This is deliberately panel-local and must not register as a shared backdrop zone. -->
    <LibraryAlbumBackdrop artworkUrl={selectedAlbumArtworkUrl} />
  {/if}

  <div
    class="dropzone playlist-dropzone"
    role="region"
    aria-label={$t('playlist.listRegion', { default: '{name} list', values: { name: localizedRegionLabel } })}
    on:dragover|preventDefault
    on:drop={handleDrop}
  >
    <div
      class="panel-header playlist-panel-header"
      class:library-mode={libraryMode}
      class:compact-heading={hideEyebrow}
      class:has-secondary-library-row={libraryMode && (showSearchInput || Boolean(selectedLibraryGroup))}
      class:is-covered={playlistHeaderCovered}
      class:has-column-header={showTrackRows && filteredItems.length > 0 && layout === 'columns' && !isCompactColumnLayout}
    >
      {#if libraryMode}
        <LibraryPanelHeader
          bind:searchInputElement={searchInputElement}
          activeView={activeLibraryView}
          summary={librarySummary}
          tooltipDetails={libraryTooltipDetails}
          groupLabel={selectedLibraryGroup?.label ?? ''}
          showBack={Boolean(selectedLibraryGroup)}
          {showSearchInput}
          {searchQuery}
          on:viewChange={(event) => handleLibraryViewChange(event.detail)}
          on:back={handleLibraryGroupBack}
          on:searchToggle={handleSearchToggle}
          on:searchInput={(event) => handleSearchInput(event.detail)}
          on:searchClose={handleSearchClose}
          on:openFiles={() => dispatch('openFiles')}
        />
      {:else}
        <PlaylistPanelHeader
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
          on:searchToggle={handleSearchToggle}
          on:searchInput={(event) => handleSearchInput(event.detail)}
          on:searchClose={handleSearchClose}
          on:toggleShuffle={() => dispatch('toggleShuffle')}
          on:cycleRepeat={() => dispatch('cycleRepeat')}
          on:openFiles={() => dispatch('openFiles')}
        />
      {/if}

      {#if showTrackRows && filteredItems.length > 0 && layout === 'columns' && !isCompactColumnLayout}
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

    <div
      bind:this={dropzoneElement}
      bind:clientWidth={dropzoneWidth}
      class="playlist-scroll-region"
      on:scroll={updatePlaylistHeaderState}
    >
      {#if !showTrackRows && visibleLibraryGroups.length > 0 && groupView}
        <LibraryGroupList
          groups={visibleLibraryGroups}
          view={groupView}
          artworkUrls={albumArtworkUrls}
          pinnedKeys={pinnedLibraryGroupKeys}
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
      {:else if displaySourceItems.length > 0 && normalizedSearchQuery}
        <div class="empty-state playlist-filter-empty">
          <p>{$t('playlist.library.noResults', { default: 'No library results match "{query}".', values: { query: searchQuery.trim() } })}</p>
        </div>
      {:else if favoritesViewActive && favoriteItems.length === 0}
        <div class="empty-state playlist-filter-empty favorites-empty-note">
          <p>{$t('playlist.library.favoritesEmpty', { default: 'Favorite tracks and subsongs will appear here.' })}</p>
        </div>
      {:else if libraryMode && items.length === 0}
        <div class="empty-state playlist-filter-empty">
          <p>{$t('playlist.library.empty', { default: 'Your library is empty. Add files or drop a folder here.' })}</p>
        </div>
      {/if}
    </div>

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
  .playlist-panel.fill-parent {
    width: 100%;
    min-width: 0;
    height: 100%;
  }

  .playlist-panel.library-album-backdrop-active {
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
    --playlist-header-artwork-background:
      linear-gradient(180deg, rgba(18, 19, 28, 0.48) 0%, rgba(18, 19, 28, 0.38) 100%),
      rgba(255, 255, 255, 0.018);
  }

  .playlist-panel.library-album-backdrop-active .playlist-dropzone {
    z-index: 1;
    background: transparent;
  }

  .playlist-panel.library-album-transition-bypass,
  .playlist-panel.library-album-transition-bypass :global(*),
  .playlist-panel.library-album-transition-bypass :global(*::before),
  .playlist-panel.library-album-transition-bypass :global(*::after) {
    transition-duration: 0ms !important;
  }

  .playlist-panel-header {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding-bottom: 0.36rem;
  }

  .playlist-panel-header.library-mode {
    padding: 0.025rem 0.45rem;
  }

  .playlist-panel-header.compact-heading:not(.has-column-header),
  .playlist-panel-header.library-mode:not(.has-column-header):not(.has-secondary-library-row) {
    height: 1.7rem;
  }

  .playlist-panel-header.has-column-header {
    padding-bottom: 0;
  }

  .playlist-panel-header.library-mode.has-column-header {
    gap: 0;
    padding-top: 0.05rem;
  }

  .playlist-scroll-region {
    position: relative;
    min-height: 0;
    flex: 1;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .playlist-filter-empty {
    place-items: center;
    padding: 1.2rem 0.9rem 1.35rem;
  }

  .playlist-filter-empty p {
    margin: 0;
  }

  .favorites-empty-note {
    color: var(--muted);
    font-size: 0.76rem;
  }
</style>
