<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import DockableTabStrip from '$lib/components/DockableTabStrip.svelte';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import { hasDockTabDragData, readDockTabDragData } from '$lib/components/docking/drag';
  import type { DockTabDefinition, DockTabMoveDetail } from '$lib/components/docking/types';
  import {
    normalizeVisibleDockWeights,
    resizeDockPairWeights,
    resolveDockSplit,
    resolveDockSplitWeights
  } from '$lib/services/dock-layout';
  import { applyMetadataPatch } from '$lib/services/media-metadata/merge';
  import type { MediaArtwork, MediaMetadataFieldName } from '$lib/services/media-metadata/types';
  import {
    listenForTroubadourBatchContext,
    publishTroubadourBatchResult,
    REQUEST_TROUBADOUR_BATCH_CONTEXT_MESSAGE,
    type TroubadourBatchContext
  } from '$lib/services/troubadour-sync';
  import { windowManager } from '$lib/services/window-manager';
  import {
    troubadourSettings,
    type TroubadourMetadataField,
    type TroubadourSettings
  } from '$lib/stores/troubadour-settings';
  import {
    TROUBADOUR_DOCK_REGIONS,
    TROUBADOUR_DOCK_SCOPE,
    isTroubadourTab,
    troubadourWorkspaceState,
    type TroubadourDockLayout,
    type TroubadourDockRegionId,
    type TroubadourDockZoneId,
    type TroubadourTab,
    type TroubadourWorkspaceState
  } from '$lib/stores/troubadour-workspace';
  import { STREAM_EXTENSIONS, type MenuActionItem } from '$lib/types';
  import LoudnessTab from './LoudnessTab.svelte';
  import LyricsEditor from './LyricsEditor.svelte';
  import SpectrogramTab from './SpectrogramTab.svelte';
  import TroubadourDockCompass from './TroubadourDockCompass.svelte';
  import TroubadourMenuBar from './TroubadourMenuBar.svelte';
  import {
    createTroubadourController,
    effectiveFields,
    selectedFieldValue,
    type TroubadourAlbum,
    type TroubadourWorkbenchItem
  } from './troubadour-controller';
  import type { RenamePreviewRow } from './rename-job';
  import type { TroubadourDockGuide } from './troubadour-dock';
  import { createLyricsPreview, type LyricsPreviewState } from './lyrics-preview';

  const SETTINGS_TO_FIELDS: Record<TroubadourMetadataField, MediaMetadataFieldName> = {
    title: 'title', artist: 'artist', albumArtist: 'albumArtist', album: 'album', date: 'date',
    trackNumber: 'trackNumber', trackTotal: 'tracksTotal', discNumber: 'discNumber', discTotal: 'discsTotal',
    genre: 'genre', composer: 'composer', comment: 'comment', lyrics: 'lyrics', isrc: 'isrc', bpm: 'bpm',
    grouping: 'grouping', copyright: 'copyright', titleSort: 'titleSort', artistSort: 'artistSort',
    albumSort: 'albumSort', albumArtistSort: 'albumArtistSort'
  };
  const OPEN_FILE_OPTIONS: OpenFilePickerOptions = {
    multiple: true,
    types: [{
      description: 'Media files',
      accept: {
        'audio/mpeg': ['.mp3'], 'audio/wav': ['.wav'], 'audio/flac': ['.flac'],
        'audio/ogg': ['.ogg', '.opus'], 'audio/opus': ['.opus']
      }
    }]
  };
  const ITEM_DRAG_MIME = 'application/x-izci-troubadour-items';

  const controller = createTroubadourController();
  const lyricsPreview = createLyricsPreview();
  let state = controller.getSnapshot();
  let lyricsPreviewState: LyricsPreviewState = {
    currentTime: 0,
    duration: 0,
    playing: false,
    ready: false,
    error: ''
  };
  let lyricsPreviewFile: File | null = null;
  let settings: TroubadourSettings = troubadourSettings.getSnapshot();
  let dockState: TroubadourWorkspaceState = troubadourWorkspaceState.getSnapshot();
  let fileInput: HTMLInputElement;
  let artworkInput: HTMLInputElement;
  let dragActive = false;
  let dragAlbumId: string | null = null;
  let draggedDockTabId: TroubadourTab | null = null;
  let dockDropZoneId: TroubadourDockZoneId | null = null;
  let dockWorkspaceElement: HTMLElement;
  let dockResizeCleanup: (() => void) | null = null;
  let isDockResizing = false;
  let renameTemplate = settings.renameTemplate;
  let renameRows: RenamePreviewRow[] = [];
  let renameError = '';
  let rememberedFolderId = '';
  let contextMenuX = 0;
  let contextMenuY = 0;
  let contextItemId: string | null = null;
  let rawExpanded = settings.rawTagVisibility === 'always';
  let selectedArtworkId: string | null = null;
  let artworkInputMode: 'add' | 'replace' = 'add';
  let artworkUrl = '';
  let artworkUrlKey = '';
  let lastContext: TroubadourBatchContext | null = null;
  let pendingAlbumName = '';
  let forceNextContext = false;
  let collapsedAlbumIds = new Set<string>();
  let loudnessBusy = false;
  let spectrogramItemId: string | null = null;

  const unsubscribeController = controller.subscribe((value) => (state = value));
  const unsubscribeLyricsPreview = lyricsPreview.subscribe((value) => (lyricsPreviewState = value));
  const unsubscribeSettings = troubadourSettings.subscribe((value) => {
    settings = value;
    if (!state.busy) renameTemplate = value.renameTemplate;
  });
  const unsubscribeWorkspace = troubadourWorkspaceState.subscribe((value) => {
    const lyricsWasActive = Object.values(dockState.activeTabsByZone).includes('lyrics');
    dockState = value;

    if (lyricsWasActive && !Object.values(value.activeTabsByZone).includes('lyrics')) {
      lyricsPreview.pause();
    }
  });

  $: selectedItems = state.items.filter((item) => state.selectedIds.includes(item.id));
  $: dirtyItems = state.items.filter((item) => Object.keys(item.patch).length || item.artworkEdits.length);
  $: writableDirtyItems = dirtyItems.filter((item) => item.fileHandle && item.document);
  $: visibleFields = settings.visibleMetadataFields.map((field) => SETTINGS_TO_FIELDS[field]);
  $: selectedPrimary = selectedItems[0] ?? null;
  $: lyricsItem = selectedItems.length === 1 && selectedPrimary?.document && isSpectrogramItem(selectedPrimary)
    ? selectedPrimary
    : null;
  $: lyricsValue = lyricsItem ? effectiveFields(lyricsItem)?.lyrics ?? '' : '';
  $: spectrogramItem = state.items.find((item) => item.id === spectrogramItemId) ?? null;
  $: selectedAppliedDocuments = selectedItems
    .filter((item) => item.document)
    .map((item) => applyMetadataPatch(item.document!, item.patch, item.artworkEdits));
  $: selectedApplied = selectedAppliedDocuments[0] ?? null;
  $: artworkMixed = selectedAppliedDocuments.length > 1 && selectedAppliedDocuments.some((document) =>
    document.artwork.map((artwork) => `${artwork.id}:${artwork.kind}:${artwork.mimeType}:${artwork.size}`).join('|')
      !== selectedAppliedDocuments[0].artwork.map((artwork) => `${artwork.id}:${artwork.kind}:${artwork.mimeType}:${artwork.size}`).join('|')
  );
  $: selectedArtwork = selectedApplied?.artwork.find((artwork) => artwork.id === selectedArtworkId)
    ?? selectedApplied?.artwork[0]
    ?? null;
  $: selectedRememberedFolder = state.rememberedFolders.find((folder) => folder.id === rememberedFolderId) ?? null;
  $: rawEntries = selectedPrimary?.document
    ? Object.entries(selectedPrimary.document.raw).sort(([left], [right]) => left.localeCompare(right))
    : [];
  $: summary = state.items.length ? `${state.items.length} files · ${dirtyItems.length} dirty` : '';
  $: contextMenuItems = contextItemId ? buildContextMenuItems() : [];
  $: dockTabsById = {
    files: { id: 'files', icon: 'audio_file', label: $t('troubadour.workbench.files', { default: 'Files' }) },
    albums: { id: 'albums', icon: 'album', label: $t('troubadour.workbench.albums', { default: 'Albums' }) },
    metadata: { id: 'metadata', icon: 'library_music', label: $t('troubadour.workbench.metadataTab', { default: 'Metadata' }) },
    rename: { id: 'rename', icon: 'drive_file_rename_outline', label: $t('troubadour.workbench.renameTab', { default: 'Rename' }) },
    lyrics: { id: 'lyrics', icon: 'lyrics', label: $t('troubadour.lyrics.tab', { default: 'Lyrics' }) },
    loudness: { id: 'loudness', icon: 'graphic_eq', label: $t('loudness.title', { default: 'Loudness' }) },
    spectrogram: {
      id: 'spectrogram',
      icon: 'waterfall_chart',
      label: $t('spectrogram.title', { default: 'Spectrogram' }),
      disabled: !isSpectrogramItem(spectrogramItem ?? selectedPrimary)
    }
  } satisfies Record<TroubadourTab, DockTabDefinition>;
  $: dockGuides = buildDockGuides();
  $: metadataWorkbenchVisible = (['files', 'albums', 'metadata', 'rename'] as TroubadourTab[])
    .some((tab) => isDockTabActive(tab));
  $: occupiedDockRegionIds = TROUBADOUR_DOCK_REGIONS
    .filter((region) => region.zones.some((zoneId) => dockState.zones[zoneId].length > 0))
    .map((region) => region.id);
  $: visibleDockRows = (['top', 'middle', 'bottom'] as const)
    .filter((regionId) => regionId === 'middle'
      ? (['left', 'middle', 'right'] as TroubadourDockRegionId[]).some((id) => occupiedDockRegionIds.includes(id))
      : occupiedDockRegionIds.includes(regionId));
  $: visibleDockColumns = (['left', 'middle', 'right'] as const)
    .filter((regionId) => occupiedDockRegionIds.includes(regionId));
  $: dockRowResizePairs = adjacentPairs(visibleDockRows);
  $: dockColumnResizePairs = adjacentPairs(visibleDockColumns);
  $: hasMainDockRegion = visibleDockColumns.length > 0;
  $: dockRowWeights = normalizeVisibleDockWeights(dockState.layout.rows, visibleDockRows);
  $: dockColumnWeights = normalizeVisibleDockWeights(dockState.layout.columns, visibleDockColumns);
  $: dockLayoutStyle = [
    `--dock-top-track: ${visibleDockRows.includes('top') ? `minmax(0, ${dockRowWeights.top}fr)` : '0px'}`,
    `--dock-after-top-track: ${dockRowResizePairs.some((pair) => pair.before === 'top') ? '3px' : '0px'}`,
    `--dock-main-track: ${hasMainDockRegion ? `minmax(0, ${dockRowWeights.middle}fr)` : '0px'}`,
    `--dock-after-middle-row-track: ${dockRowResizePairs.some((pair) => pair.before === 'middle') ? '3px' : '0px'}`,
    `--dock-bottom-track: ${visibleDockRows.includes('bottom') ? `minmax(0, ${dockRowWeights.bottom}fr)` : '0px'}`,
    `--dock-left-track: ${visibleDockColumns.includes('left') ? `minmax(0, ${dockColumnWeights.left}fr)` : '0px'}`,
    `--dock-after-left-track: ${dockColumnResizePairs.some((pair) => pair.before === 'left') ? '3px' : '0px'}`,
    `--dock-middle-track: ${visibleDockColumns.includes('middle') ? `minmax(0, ${dockColumnWeights.middle}fr)` : hasMainDockRegion ? '0px' : 'minmax(0, 1fr)'}`,
    `--dock-after-middle-column-track: ${dockColumnResizePairs.some((pair) => pair.before === 'middle') ? '3px' : '0px'}`,
    `--dock-right-track: ${visibleDockColumns.includes('right') ? `minmax(0, ${dockColumnWeights.right}fr)` : '0px'}`
  ].join('; ');
  $: updateArtworkUrl(selectedArtwork);
  $: if (isDockTabActive('spectrogram') && !spectrogramItemId && selectedPrimary && isSpectrogramItem(selectedPrimary)) {
    spectrogramItemId = selectedPrimary.id;
  }
  $: syncLyricsPreview(lyricsItem);

  function syncLyricsPreview(item: TroubadourWorkbenchItem | null): void {
    const file = item?.file ?? null;
    if (file === lyricsPreviewFile) return;
    lyricsPreviewFile = file;
    lyricsPreview.setFile(item?.file ?? null);
  }

  function buildDockGuides(): TroubadourDockGuide[] {
    const labels: Record<TroubadourDockRegionId, { label: string; icon: string; halves: [string, string] }> = {
      top: {
        label: $t('troubadour.dock.top', { default: 'Top zones' }),
        icon: 'vertical_align_top',
        halves: [$t('troubadour.dock.topLeft', { default: 'Top left' }), $t('troubadour.dock.topRight', { default: 'Top right' })]
      },
      left: {
        label: $t('troubadour.dock.left', { default: 'Left zones' }),
        icon: 'align_horizontal_left',
        halves: [$t('troubadour.dock.leftTop', { default: 'Left top' }), $t('troubadour.dock.leftBottom', { default: 'Left bottom' })]
      },
      middle: {
        label: $t('troubadour.dock.middle', { default: 'Middle zones' }),
        icon: 'select_window',
        halves: [$t('troubadour.dock.middleTop', { default: 'Middle top' }), $t('troubadour.dock.middleBottom', { default: 'Middle bottom' })]
      },
      right: {
        label: $t('troubadour.dock.right', { default: 'Right zones' }),
        icon: 'align_horizontal_right',
        halves: [$t('troubadour.dock.rightTop', { default: 'Right top' }), $t('troubadour.dock.rightBottom', { default: 'Right bottom' })]
      },
      bottom: {
        label: $t('troubadour.dock.bottom', { default: 'Bottom zones' }),
        icon: 'vertical_align_bottom',
        halves: [$t('troubadour.dock.bottomLeft', { default: 'Bottom left' }), $t('troubadour.dock.bottomRight', { default: 'Bottom right' })]
      }
    };

    return TROUBADOUR_DOCK_REGIONS.map((region) => ({
      ...region,
      icon: labels[region.id].icon,
      label: labels[region.id].label,
      zoneLabels: labels[region.id].halves
    }));
  }

  function adjacentPairs<T>(items: readonly T[]): Array<{ before: T; after: T }> {
    return items.slice(0, -1).map((before, index) => ({ before, after: items[index + 1] }));
  }

  function dockRegionStyle(
    regionId: TroubadourDockRegionId,
    workspaceState: TroubadourWorkspaceState
  ): string {
    const region = TROUBADOUR_DOCK_REGIONS.find((candidate) => candidate.id === regionId)!;
    const firstVisible = workspaceState.zones[region.zones[0]].length > 0;
    const secondVisible = workspaceState.zones[region.zones[1]].length > 0;
    const split = workspaceState.layout.splits[regionId];
    const weights = resolveDockSplitWeights(firstVisible, secondVisible, split);

    return [
      `--dock-first-zone-track: ${firstVisible ? `minmax(0, ${weights.first}fr)` : '0px'}`,
      `--dock-half-resizer-track: ${firstVisible && secondVisible ? '3px' : '0px'}`,
      `--dock-second-zone-track: ${secondVisible ? `minmax(0, ${weights.second}fr)` : '0px'}`
    ].join('; ');
  }

  function dockRegionLabel(regionId: 'top' | 'middle' | 'bottom' | 'left' | 'right'): string {
    switch (regionId) {
      case 'top': return $t('troubadour.dock.top', { default: 'Top zones' });
      case 'middle': return $t('troubadour.dock.middle', { default: 'Middle zones' });
      case 'bottom': return $t('troubadour.dock.bottom', { default: 'Bottom zones' });
      case 'left': return $t('troubadour.dock.left', { default: 'Left zones' });
      case 'right': return $t('troubadour.dock.right', { default: 'Right zones' });
    }
  }

  function getMainResizeElement(regionId: 'top' | 'middle' | 'bottom' | 'left' | 'right'): HTMLElement | null {
    if (regionId !== 'middle' || visibleDockColumns.includes('middle')) {
      return dockWorkspaceElement.querySelector<HTMLElement>(`[data-dock-region="${regionId}"]`);
    }

    const middleBandRegion = visibleDockColumns[0];
    return middleBandRegion
      ? dockWorkspaceElement.querySelector<HTMLElement>(`[data-dock-region="${middleBandRegion}"]`)
      : null;
  }

  function replaceDockLayoutAxis(
    layout: TroubadourDockLayout,
    axis: 'rows' | 'columns',
    before: string,
    after: string,
    beforeWeight: number,
    afterWeight: number
  ): TroubadourDockLayout {
    return {
      ...layout,
      [axis]: {
        ...layout[axis],
        [before]: beforeWeight,
        [after]: afterWeight
      }
    } as TroubadourDockLayout;
  }

  function beginMainDockResize(
    axis: 'rows' | 'columns',
    before: 'top' | 'middle' | 'bottom' | 'left' | 'right',
    after: 'top' | 'middle' | 'bottom' | 'left' | 'right',
    event: PointerEvent
  ): void {
    const beforeElement = getMainResizeElement(before);
    const afterElement = getMainResizeElement(after);

    if (!beforeElement || !afterElement) return;

    event.preventDefault();
    dockResizeCleanup?.();
    const beforeBounds = beforeElement.getBoundingClientRect();
    const afterBounds = afterElement.getBoundingClientRect();
    const horizontal = axis === 'columns';
    const beforeSize = horizontal ? beforeBounds.width : beforeBounds.height;
    const afterSize = horizontal ? afterBounds.width : afterBounds.height;
    const startCoordinate = horizontal ? event.clientX : event.clientY;
    const startLayout = dockState.layout;
    const axisLayout = startLayout[axis] as Record<string, number>;

    const move = (moveEvent: PointerEvent) => {
      const coordinate = horizontal ? moveEvent.clientX : moveEvent.clientY;
      const next = resizeDockPairWeights({
        beforeSize,
        afterSize,
        beforeWeight: axisLayout[before],
        afterWeight: axisLayout[after],
        delta: coordinate - startCoordinate,
        minimumSize: horizontal ? 140 : 84
      });
      troubadourWorkspaceState.setLayout(replaceDockLayoutAxis(
        startLayout,
        axis,
        before,
        after,
        next.beforeWeight,
        next.afterWeight
      ));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      dockResizeCleanup = null;
      isDockResizing = false;
    };

    isDockResizing = true;
    dockResizeCleanup = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  }

  function beginDockHalfResize(regionId: TroubadourDockRegionId, event: PointerEvent): void {
    const region = TROUBADOUR_DOCK_REGIONS.find((candidate) => candidate.id === regionId);
    const regionElement = dockWorkspaceElement.querySelector<HTMLElement>(`[data-dock-region="${regionId}"]`);

    if (!region || !regionElement) return;

    event.preventDefault();
    dockResizeCleanup?.();
    const bounds = regionElement.getBoundingClientRect();
    const horizontal = region.split === 'horizontal';
    const startLayout = dockState.layout;

    const move = (moveEvent: PointerEvent) => {
      const dimension = horizontal ? bounds.width : bounds.height;
      const position = horizontal
        ? moveEvent.clientX - bounds.left
        : moveEvent.clientY - bounds.top;
      const split = resolveDockSplit(position, dimension, horizontal ? 120 : 72);
      troubadourWorkspaceState.setLayout({
        ...startLayout,
        splits: { ...startLayout.splits, [regionId]: split }
      });
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      dockResizeCleanup = null;
      isDockResizing = false;
    };

    isDockResizing = true;
    dockResizeCleanup = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  }

  function isDockTabActive(tab: TroubadourTab): boolean {
    return Object.values(dockState.activeTabsByZone).includes(tab);
  }

  function updateArtworkUrl(artwork: MediaArtwork | null) {
    const key = artwork?.id ?? '';
    if (key === artworkUrlKey) return;
    if (artworkUrl) URL.revokeObjectURL(artworkUrl);
    artworkUrlKey = key;
    artworkUrl = artwork
      ? URL.createObjectURL(new Blob([artwork.data.slice().buffer], { type: artwork.mimeType }))
      : '';
    selectedArtworkId = artwork?.id ?? null;
  }

  function requestContext() {
    forceNextContext = true;
    window.opener?.postMessage({ type: REQUEST_TROUBADOUR_BATCH_CONTEXT_MESSAGE }, window.location.origin);
  }

  function toggleAlbum(albumId: string): void {
    const next = new Set(collapsedAlbumIds);
    if (next.has(albumId)) next.delete(albumId);
    else next.add(albumId);
    collapsedAlbumIds = next;
  }

  async function acceptContext(context: TroubadourBatchContext, force = false) {
    force ||= forceNextContext;
    forceNextContext = false;
    lastContext = context;
    controller.setRememberedFolders(context.rememberedFolders);
    if (!rememberedFolderId) rememberedFolderId = context.rememberedFolders[0]?.id ?? '';
    if (!force && settings.initialLoad === 'nothing') return;
    const tracks = !force && settings.initialLoad === 'current-track'
      ? context.tracks.filter((track) => track.references.some((reference) => reference.collection === 'current'))
      : context.tracks;
    await controller.ingestBatchTracks(tracks, settings.metadataReadConcurrency);
    if (settings.autoGroupOnLoad) controller.autoGroup(settings.autoGroupFallback);
  }

  onMount(() => listenForTroubadourBatchContext((context) => void acceptContext(context)));

  function handleError(error: unknown): void {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    renameError = error instanceof Error ? error.message : $t('troubadour.workbench.operationFailed', { default: 'The operation failed.' });
  }

  async function chooseFiles(): Promise<void> {
    const picker = window as Window & { showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]> };
    if (!picker.showOpenFilePicker) {
      fileInput.click();
      return;
    }
    try {
      await controller.ingestHandles(await picker.showOpenFilePicker(OPEN_FILE_OPTIONS), settings.metadataReadConcurrency);
    } catch (error) {
      handleError(error);
    }
  }

  async function chooseFolder(): Promise<void> {
    const picker = window as Window & { showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle> };
    if (!picker.showDirectoryPicker) {
      renameError = $t('troubadour.workbench.folderUnavailable', { default: 'Folder access is unavailable. Use Add files instead.' });
      return;
    }
    try {
      const directory = await picker.showDirectoryPicker({ mode: 'read' });
      await controller.ingestDirectory(directory, settings.folderScanDepth, settings.metadataReadConcurrency);
      if (settings.autoGroupOnLoad) controller.autoGroup(settings.autoGroupFallback);
    } catch (error) {
      handleError(error);
    }
  }

  async function addRememberedFolder(): Promise<void> {
    const folder = state.rememberedFolders.find((candidate) => candidate.id === rememberedFolderId);
    if (!folder) return;
    try {
      await controller.ingestDirectory(folder.handle, settings.folderScanDepth, settings.metadataReadConcurrency);
      if (settings.autoGroupOnLoad) controller.autoGroup(settings.autoGroupFallback);
    } catch (error) {
      handleError(error);
    }
  }

  async function handleFileFallback(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    await controller.ingestDropped(transfer, settings.folderScanDepth, settings.metadataReadConcurrency);
  }

  async function handleDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    dragActive = false;
    if (isItemDrag(event)) return;
    if (!event.dataTransfer) return;
    try {
      await controller.ingestDropped(event.dataTransfer, settings.folderScanDepth, settings.metadataReadConcurrency);
      if (settings.autoGroupOnLoad) controller.autoGroup(settings.autoGroupFallback);
    } catch (error) {
      handleError(error);
    }
  }

  function removeSelected(): void {
    if (!state.selectedIds.length) return;
    const removingDirty = selectedItems.some((item) => Object.keys(item.patch).length || item.artworkEdits.length);
    if (removingDirty && settings.confirmDirtyRemoval && !window.confirm($t('troubadour.workbench.confirmDirtyRemoval', {
      default: 'Remove staged dirty files from the workbench? Source files will not be deleted.'
    }))) return;
    controller.removeSelected();
  }

  async function save(all = false): Promise<void> {
    const results = await controller.saveSelectedOrAll({
      all,
      requestPermission: true,
      verify: true
    });
    publishTroubadourBatchResult({ results });
  }

  async function previewRenames(): Promise<void> {
    renameError = '';
    setActiveTab('rename');
    try {
      renameRows = await controller.buildRenamePreview(renameTemplate, {
        illegalCharacterReplacement: settings.illegalCharacterReplacement,
        normalizeWhitespace: settings.normalizeWhitespace,
        unicodeNormalization: settings.unicodeNormalization === 'nfc'
          ? 'NFC'
          : settings.unicodeNormalization === 'ascii' ? 'ascii' : 'none',
        extensionCase: settings.extensionCase,
        missingTokenPolicy: settings.missingTokenPolicy,
        collisionPolicy: settings.collisionPolicy
      });
    } catch (error) {
      handleError(error);
      renameRows = [];
    }
  }

  async function applyRenames(saveFirst = false): Promise<void> {
    if (saveFirst) {
      const saveResults = await controller.saveSelectedOrAll({ verify: true, requestPermission: true });
      publishTroubadourBatchResult({ results: saveResults });
      await previewRenames();
    }
    const { results } = await controller.applyRenames(renameRows, {
      verification: settings.copyVerification
    });
    publishTroubadourBatchResult({ results });
    await previewRenames();
  }

  function setRenameRowEnabled(id: string, enabled: boolean): void {
    renameRows = renameRows.map((row) => row.id === id ? { ...row, enabled } : row);
  }

  async function grantRenameAccess(): Promise<void> {
    const handles = new Set<FileSystemHandle>();
    for (const row of renameRows) {
      if (!row.problems.includes('permission-required')) continue;
      if (row.parentHandle) handles.add(row.parentHandle);
      if (row.fileHandle) handles.add(row.fileHandle);
    }
    // Invoke every request before yielding so Chromium retains the button's user activation.
    const requests = [...handles].map((handle) => handle.requestPermission?.({ mode: 'readwrite' }) ?? Promise.resolve('granted' as const));
    await Promise.all(requests);
    await previewRenames();
  }

  function setActiveTab(tab: TroubadourTab): void {
    troubadourWorkspaceState.setActiveTab(tab);
  }

  function moveDockTab(detail: DockTabMoveDetail): void {
    troubadourWorkspaceState.moveTab(detail);
    draggedDockTabId = null;
    dockDropZoneId = null;
  }

  function handleDockTabDragStart(tabId: string): void {
    draggedDockTabId = isTroubadourTab(tabId) ? tabId : null;
    dragActive = false;
  }

  function handleDockTabDragEnd(): void {
    draggedDockTabId = null;
    dockDropZoneId = null;
  }

  function handleDockPanelDragOver(event: DragEvent, zoneId: TroubadourDockZoneId): void {
    if (!hasDockTabDragData(event.dataTransfer, TROUBADOUR_DOCK_SCOPE)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dockDropZoneId = zoneId;
  }

  function handleDockPanelDrop(event: DragEvent, zoneId: TroubadourDockZoneId): void {
    const dragData = readDockTabDragData(event.dataTransfer, TROUBADOUR_DOCK_SCOPE);

    if (!dragData) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    moveDockTab({ ...dragData, targetZoneId: zoneId, position: 'end' });
  }

  function handleDockPanelDragLeave(event: DragEvent, zoneId: TroubadourDockZoneId): void {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget instanceof HTMLElement &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }

    if (dockDropZoneId === zoneId) dockDropZoneId = null;
  }

  function isSpectrogramItem(item: TroubadourWorkbenchItem | null | undefined): boolean {
    return Boolean(item && (STREAM_EXTENSIONS as readonly string[]).includes(item.extension));
  }

  function openSpectrogram(item: TroubadourWorkbenchItem | null = selectedPrimary): void {
    if (!item || !isSpectrogramItem(item)) return;
    spectrogramItemId = item.id;
    setActiveTab('spectrogram');
  }

  function openOptions(): void {
    windowManager.openPopup('troubadourOptions');
  }

  function createAlbum(): void {
    const first = selectedItems.map(effectiveFields).find(Boolean);
    pendingAlbumName = first?.album || $t('troubadour.workbench.newAlbum', { default: 'New album' });
    controller.createAlbum(pendingAlbumName);
  }

  function buildContextMenuItems(): MenuActionItem[] {
    const item = state.items.find((candidate) => candidate.id === contextItemId);
    return [
      { id: 'copyPath', label: $t('troubadour.workbench.copyPath', { default: 'Copy path' }), icon: 'content_copy', disabled: !item?.path },
      { id: 'spectrogram', label: $t('troubadour.menu.spectrogram', { default: 'Open selected file in Spectrogram' }), icon: 'waterfall_chart', disabled: !isSpectrogramItem(item), separatorBefore: true },
      { id: 'createAlbum', label: $t('troubadour.menu.createAlbum', { default: 'Create album from selection' }), icon: 'create_new_folder', separatorBefore: true },
      ...state.albums.map((album, index) => ({
        id: `assign:${album.id}`,
        label: $t('troubadour.workbench.assignToAlbum', { default: 'Assign to {album}', values: { album: album.title } }),
        icon: 'album',
        separatorBefore: index === 0
      })),
      { id: 'remove', label: $t('troubadour.menu.remove', { default: 'Remove from workbench' }), icon: 'remove', separatorBefore: true }
    ];
  }

  function openContextMenu(event: MouseEvent, item: TroubadourWorkbenchItem): void {
    event.preventDefault();
    if (!state.selectedIds.includes(item.id)) controller.select(item.id);
    contextItemId = item.id;
    contextMenuX = event.clientX;
    contextMenuY = event.clientY;
  }

  async function runContextAction(action: string): Promise<void> {
    const item = state.items.find((candidate) => candidate.id === contextItemId);
    contextItemId = null;
    if (action === 'copyPath' && item) await navigator.clipboard?.writeText(item.path);
    else if (action === 'spectrogram' && item) openSpectrogram(item);
    else if (action === 'createAlbum') createAlbum();
    else if (action.startsWith('assign:')) controller.assignSelectionToAlbum(action.slice(7));
    else if (action === 'remove') removeSelected();
  }

  function stateIcon(item: TroubadourWorkbenchItem): string {
    if (item.state === 'loading' || item.state === 'saving') return 'progress_activity';
    if (item.state === 'dirty') return 'edit';
    if (item.state === 'saved') return 'check_circle';
    if (item.state === 'unsupported') return 'visibility';
    if (item.state === 'failed' || item.state === 'unreadable' || item.state === 'conflicted') return 'error';
    if (item.state === 'permission-required') return 'lock';
    return 'audio_file';
  }

  function stateText(item: TroubadourWorkbenchItem): string {
    if (item.error) return item.error;
    return item.state.replace('-', ' ');
  }

  function fieldLabel(field: MediaMetadataFieldName): string {
    switch (field) {
      case 'title': return $t('troubadour.fields.title', { default: 'Title' });
      case 'artist': return $t('troubadour.fields.artist', { default: 'Artist' });
      case 'albumArtist': return $t('troubadour.fields.albumArtist', { default: 'Album artist' });
      case 'album': return $t('troubadour.fields.album', { default: 'Album' });
      case 'date': return $t('troubadour.fields.date', { default: 'Date' });
      case 'trackNumber': return $t('troubadour.fields.trackNumber', { default: 'Track number' });
      case 'tracksTotal': return $t('troubadour.fields.tracksTotal', { default: 'Track total' });
      case 'discNumber': return $t('troubadour.fields.discNumber', { default: 'Disc number' });
      case 'discsTotal': return $t('troubadour.fields.discsTotal', { default: 'Disc total' });
      case 'genre': return $t('troubadour.fields.genre', { default: 'Genre' });
      case 'composer': return $t('troubadour.fields.composer', { default: 'Composer' });
      case 'comment': return $t('troubadour.fields.comment', { default: 'Comment' });
      case 'lyrics': return $t('troubadour.fields.lyrics', { default: 'Lyrics' });
      case 'isrc': return 'ISRC';
      case 'bpm': return 'BPM';
      case 'grouping': return $t('troubadour.fields.grouping', { default: 'Grouping' });
      case 'copyright': return $t('troubadour.fields.copyright', { default: 'Copyright' });
      case 'titleSort': return $t('troubadour.fields.titleSort', { default: 'Title sort' });
      case 'artistSort': return $t('troubadour.fields.artistSort', { default: 'Artist sort' });
      case 'albumSort': return $t('troubadour.fields.albumSort', { default: 'Album sort' });
      case 'albumArtistSort': return $t('troubadour.fields.albumArtistSort', { default: 'Album artist sort' });
      case 'composerSort': return $t('troubadour.fields.composerSort', { default: 'Composer sort' });
    }
  }

  function selectRow(event: MouseEvent, item: TroubadourWorkbenchItem): void {
    controller.select(item.id, { additive: event.ctrlKey || event.metaKey, range: event.shiftKey });
  }

  function beginItemDrag(event: DragEvent, item: TroubadourWorkbenchItem): void {
    if (!state.selectedIds.includes(item.id)) controller.select(item.id);
    dragActive = false;
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) return;
    dataTransfer.effectAllowed = 'move';
    dataTransfer.setData(ITEM_DRAG_MIME, JSON.stringify(controller.getSnapshot().selectedIds));
  }

  function isItemDrag(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes(ITEM_DRAG_MIME);
  }

  function handleWindowDragOver(event: DragEvent): void {
    if (isItemDrag(event)) {
      dragActive = false;
      return;
    }
    if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
    event.preventDefault();
    dragActive = true;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  function handleWindowDragLeave(event: DragEvent): void {
    if (!isItemDrag(event) && event.relatedTarget === null) dragActive = false;
  }

  function dragOverAlbum(event: DragEvent, album: TroubadourAlbum): void {
    if (!isItemDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    dragAlbumId = album.id;
  }

  function leaveAlbum(event: DragEvent, album: TroubadourAlbum): void {
    const pane = event.currentTarget as HTMLElement;
    if (event.relatedTarget instanceof Node && pane.contains(event.relatedTarget)) return;
    if (dragAlbumId === album.id) dragAlbumId = null;
  }

  function dropOnAlbum(event: DragEvent, album: TroubadourAlbum): void {
    if (!isItemDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragAlbumId = null;
    try {
      const itemIds = JSON.parse(event.dataTransfer?.getData(ITEM_DRAG_MIME) ?? '[]');
      if (Array.isArray(itemIds)) controller.assignItemsToAlbum(itemIds.filter((id): id is string => typeof id === 'string'), album.id);
    } catch {
      // Ignore malformed internal drag data.
    }
  }

  function editField(field: MediaMetadataFieldName, event: Event): void {
    controller.editField(field, (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value);
  }

  function openArtworkPicker(mode: 'add' | 'replace'): void {
    artworkInputMode = mode;
    artworkInput.click();
  }

  async function artworkFromFile(file: File): Promise<MediaArtwork> {
    return {
      id: `pending:${crypto.randomUUID()}`,
      data: new Uint8Array(await file.arrayBuffer()),
      mimeType: file.type || 'image/jpeg',
      kind: settings.defaultArtworkKind === 'back' ? 'coverBack' : settings.defaultArtworkKind === 'front' ? 'coverFront' : 'unknown',
      name: file.name,
      size: file.size
    };
  }

  function stageArtwork(artwork: MediaArtwork, mode: 'add' | 'replace' = 'add'): void {
    if (mode === 'replace' && selectedArtwork) {
      controller.replaceArtwork(selectedArtwork.id, artwork);
      return;
    }
    if (settings.multipleImageBehavior === 'reject' && selectedAppliedDocuments.some((document) => document.artwork.length)) {
      renameError = $t('troubadour.workbench.multipleArtworkRejected', { default: 'The current artwork policy rejects additional images.' });
      return;
    }
    controller.addArtwork(artwork, settings.multipleImageBehavior);
  }

  async function addArtworkFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    stageArtwork(await artworkFromFile(file), artworkInputMode);
  }

  async function pasteArtwork(): Promise<void> {
    if (!navigator.clipboard?.read) return;
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((candidate) => candidate.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      stageArtwork(await artworkFromFile(new File([blob], 'clipboard-image', { type })), 'add');
      return;
    }
  }

  async function dropArtwork(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    dragActive = false;
    const file = [...(event.dataTransfer?.files ?? [])].find((candidate) => candidate.type.startsWith('image/'));
    if (file) stageArtwork(await artworkFromFile(file), 'add');
  }

  function handleArtworkDragOver(event: DragEvent): void {
    if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  }

  function handleArtworkDrop(event: DragEvent): void {
    if (Array.from(event.dataTransfer?.types ?? []).includes('Files')) {
      void dropArtwork(event);
    }
  }

  function clearArtwork(): void {
    const affected = selectedAppliedDocuments.filter((document) => document.artwork.length).length;
    if (affected >= settings.destructiveClearConfirmationThreshold && !window.confirm($t('troubadour.workbench.confirmClearArtwork', {
      default: 'Stage removal of all artwork from {count} selected files?',
      values: { count: affected }
    }))) return;
    controller.clearArtwork();
  }

  function setArtworkKind(kind: MediaArtwork['kind']): void {
    if (selectedArtwork) controller.replaceArtwork(selectedArtwork.id, { ...selectedArtwork, kind });
  }

  function applyArtworkToSelectedAlbum(): void {
    if (selectedArtwork && state.selectedAlbumId) {
      controller.applyArtworkToAlbum(state.selectedAlbumId, selectedArtwork, settings.multipleImageBehavior);
    }
  }

  async function copyArtwork(): Promise<void> {
    if (!selectedArtwork || !('ClipboardItem' in window)) return;
    const blob = new Blob([selectedArtwork.data.slice().buffer], { type: selectedArtwork.mimeType });
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
  }

  function extractArtwork(): void {
    if (!selectedArtwork) return;
    const blob = new Blob([selectedArtwork.data.slice().buffer], { type: selectedArtwork.mimeType });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = selectedArtwork.name || `cover.${selectedArtwork.mimeType.split('/')[1] || 'bin'}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 0);
  }

  function handleKeydown(event: KeyboardEvent): void {
    const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
    if (event.key === 'Delete' && !editing) removeSelected();
    else if (event.key === 'F5') void controller.reloadSelected();
    else if (event.key === 'F2') setActiveTab('rename');
    else if (!event.ctrlKey || event.altKey) return;
    else if (event.key.toLowerCase() === 'o' && event.shiftKey) void chooseFolder();
    else if (event.key.toLowerCase() === 'o') void chooseFiles();
    else if (event.key.toLowerCase() === 's' && event.shiftKey) void save(true);
    else if (event.key.toLowerCase() === 's') void save(false);
    else if (event.key.toLowerCase() === 'z' && !editing) controller.undo();
    else if (event.key.toLowerCase() === 'y' && !editing) controller.redo();
    else if (event.key.toLowerCase() === 'a' && !editing) controller.selectAll();
    else if (event.key === ',') openOptions();
    else if (event.key.toLowerCase() === 'w') window.close();
    else return;
    event.preventDefault();
  }

  onDestroy(() => {
    dockResizeCleanup?.();
    unsubscribeController();
    unsubscribeSettings();
    unsubscribeWorkspace();
    unsubscribeLyricsPreview();
    lyricsPreview.destroy();
    if (artworkUrl) URL.revokeObjectURL(artworkUrl);
  });
</script>

<svelte:head><title>{$t('troubadour.windowTitle', { default: 'izci Troubadour' })}</title></svelte:head>
<svelte:window on:keydown={handleKeydown} on:dragover={handleWindowDragOver} on:dragleave={handleWindowDragLeave} on:drop={handleDrop} on:dragend={() => { dragActive = false; dragAlbumId = null; handleDockTabDragEnd(); }} on:contextmenu={(event) => { if (event.target === document.body) event.preventDefault(); }} />

<div class="tool-shell troubadour-shell">
  <div class="window-frame-safe-strip" aria-hidden="true"></div>
  <input bind:this={fileInput} class="hidden-input" type="file" multiple accept="audio/*,.mp3,.wav,.flac,.ogg,.opus" on:change={(event) => void handleFileFallback(event)} />
  <input bind:this={artworkInput} class="hidden-input" type="file" accept="image/*" on:change={(event) => void addArtworkFile(event)} />

  <TroubadourMenuBar
    canSave={writableDirtyItems.length > 0}
    canUndo={state.canUndo}
    canRedo={state.canRedo}
    canRemove={state.selectedIds.length > 0}
    canAlbum={state.selectedIds.length > 0 || Boolean(state.selectedAlbumId)}
    canRename={renameRows.some((row) => row.enabled)}
    canSpectrogram={isSpectrogramItem(selectedPrimary)}
    busy={state.busy || loudnessBusy}
    {summary}
    on:addFiles={() => void chooseFiles()}
    on:addFolder={() => void chooseFolder()}
    on:addFromIzci={requestContext}
    on:save={() => void save(false)}
    on:saveAll={() => void save(true)}
    on:close={() => window.close()}
    on:undo={() => controller.undo()}
    on:redo={() => controller.redo()}
    on:selectAll={() => controller.selectAll()}
    on:remove={removeSelected}
    on:reload={() => void controller.reloadSelected()}
    on:createAlbum={createAlbum}
    on:autoGroup={() => controller.autoGroup(settings.autoGroupFallback)}
    on:renumber={() => state.selectedAlbumId && controller.renumberAlbum(state.selectedAlbumId)}
    on:dissolveAlbum={() => state.selectedAlbumId && controller.dissolveAlbum(state.selectedAlbumId)}
    on:previewRename={() => void previewRenames()}
    on:applyRename={() => void applyRenames(false)}
    on:spectrogram={() => openSpectrogram()}
    on:options={openOptions}
  />

  <div class="tool-row tool-toolbar troubadour-toolbar" role="toolbar" aria-label={$t('troubadour.workbench.commands', { default: 'Troubadour commands' })}>
    {#each [
      { icon: 'audio_file', label: $t('troubadour.workbench.addFiles', { default: 'Add files' }), action: () => void chooseFiles() },
      { icon: 'folder_open', label: $t('troubadour.workbench.addFolder', { default: 'Add folder' }), action: () => void chooseFolder() },
      { icon: 'playlist_add', label: $t('troubadour.menu.addFromIzci', { default: 'Add current izci selection' }), action: requestContext }
    ] as tool}
      <button class="icon-button hover-tooltip-anchor" type="button" aria-label={tool.label} disabled={state.busy || loudnessBusy} on:click={tool.action}><span class="material-symbols-outlined" aria-hidden="true">{tool.icon}</span><HoverTooltip>{tool.label}</HoverTooltip></button>
    {/each}
    {#if metadataWorkbenchVisible}
      <span class="toolbar-separator"></span>
      <button class="icon-button hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.createAlbum', { default: 'Create album' })} disabled={!state.selectedIds.length || state.busy} on:click={createAlbum}><span class="material-symbols-outlined">create_new_folder</span><HoverTooltip>{$t('troubadour.workbench.createAlbum', { default: 'Create album' })}</HoverTooltip></button>
      <button class="icon-button hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.autoGroup', { default: 'Auto-group' })} disabled={state.busy} on:click={() => controller.autoGroup(settings.autoGroupFallback)}><span class="material-symbols-outlined">auto_awesome_motion</span><HoverTooltip>{$t('troubadour.workbench.autoGroup', { default: 'Auto-group' })}</HoverTooltip></button>
      <span class="toolbar-separator"></span>
      <button class="icon-button hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.saveTags', { default: 'Save staged tags' })} disabled={!writableDirtyItems.length || state.busy} on:click={() => void save(false)}><span class="material-symbols-outlined">save</span><HoverTooltip>{$t('troubadour.workbench.saveTags', { default: 'Save staged tags' })}</HoverTooltip></button>
      <button class="icon-button hover-tooltip-anchor" type="button" aria-label={$t('troubadour.menu.undo', { default: 'Undo staged change' })} disabled={!state.canUndo || state.busy} on:click={() => controller.undo()}><span class="material-symbols-outlined">undo</span><HoverTooltip>{$t('troubadour.menu.undo', { default: 'Undo staged change' })}</HoverTooltip></button>
      <button class="icon-button hover-tooltip-anchor" type="button" aria-label={$t('troubadour.menu.redo', { default: 'Redo staged change' })} disabled={!state.canRedo || state.busy} on:click={() => controller.redo()}><span class="material-symbols-outlined">redo</span><HoverTooltip>{$t('troubadour.menu.redo', { default: 'Redo staged change' })}</HoverTooltip></button>
      <span class="toolbar-separator"></span>
      <label class="remembered-folder-control hover-tooltip-anchor"><span class="material-symbols-outlined" aria-hidden="true">folder_shared</span><select bind:value={rememberedFolderId} aria-label={$t('troubadour.workbench.chooseLibraryFolder', { default: 'Choose a folder from your izci library' })} disabled={!state.rememberedFolders.length || state.busy}><option value="">{$t('troubadour.workbench.none', { default: 'None' })}</option>{#each state.rememberedFolders as folder}<option value={folder.id}>{folder.name}</option>{/each}</select><HoverTooltip>{$t('troubadour.workbench.chooseLibraryFolder', { default: 'Choose a folder from your izci library' })}</HoverTooltip></label>
      {#if selectedRememberedFolder}<span class="root-permission hover-tooltip-anchor" class:granted={selectedRememberedFolder.permission === 'granted'} aria-label={selectedRememberedFolder.permission === 'granted' ? $t('troubadour.workbench.folderReady', { default: 'Folder is ready to use' }) : $t('troubadour.workbench.folderNeedsAccess', { default: 'Folder may ask for access' })}><span class="material-symbols-outlined" aria-hidden="true">{selectedRememberedFolder.permission === 'granted' ? 'verified' : 'lock'}</span><HoverTooltip>{selectedRememberedFolder.permission === 'granted' ? $t('troubadour.workbench.folderReady', { default: 'Folder is ready to use' }) : $t('troubadour.workbench.folderNeedsAccess', { default: 'Folder may ask for access' })}</HoverTooltip></span>{/if}
      <button class="icon-button hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.addLibraryFolder', { default: 'Add selected library folder' })} disabled={!rememberedFolderId || state.busy} on:click={() => void addRememberedFolder()}><span class="material-symbols-outlined" aria-hidden="true">drive_folder_upload</span><HoverTooltip>{$t('troubadour.workbench.addLibraryFolder', { default: 'Add selected library folder' })}</HoverTooltip></button>
    {/if}
    <span class="toolbar-spacer"></span>
    <button class="icon-button hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.options', { default: 'Troubadour Options' })} on:click={openOptions}><span class="material-symbols-outlined">settings</span><HoverTooltip>{$t('troubadour.workbench.options', { default: 'Troubadour Options' })}</HoverTooltip></button>
  </div>

  <main
    class="troubadour-dock-workspace"
    class:is-dragging-tab={draggedDockTabId !== null}
    class:is-resizing={isDockResizing}
    style={dockLayoutStyle}
    bind:this={dockWorkspaceElement}
  >
    {#each TROUBADOUR_DOCK_REGIONS as region (region.id)}
      {#if occupiedDockRegionIds.includes(region.id)}
        <section
          class={`troubadour-dock-region region-${region.id} split-${region.split}`}
          style={dockRegionStyle(region.id, dockState)}
          data-dock-region={region.id}
        >
          {#each region.zones as zoneId (zoneId)}
            {#if dockState.zones[zoneId].length}
              {@const zoneActiveTab = dockState.activeTabsByZone[zoneId]}
              <section
                class="troubadour-dock-panel"
                class:is-first-dock-zone={zoneId === region.zones[0]}
                class:is-second-dock-zone={zoneId === region.zones[1]}
                class:is-drop-target={dockDropZoneId === zoneId}
                data-dock-zone={zoneId}
                aria-label={zoneActiveTab ? dockTabsById[zoneActiveTab].label : undefined}
                on:dragover={(event) => handleDockPanelDragOver(event, zoneId)}
                on:drop={(event) => handleDockPanelDrop(event, zoneId)}
                on:dragleave={(event) => handleDockPanelDragLeave(event, zoneId)}
              >
                <DockableTabStrip
                  tabs={dockState.zones[zoneId].map((tab) => dockTabsById[tab])}
                  activeTab={zoneActiveTab}
                  {zoneId}
                  dragScope={TROUBADOUR_DOCK_SCOPE}
                  ariaLabel={$t('troubadour.dock.zoneTabs', { default: '{zone} tabs', values: { zone: zoneId } })}
                  className="tool-tabs troubadour-zone-tabs"
                  compactWhenNarrow
                  idPrefix="troubadour-tab"
                  on:tabChange={(event) => isTroubadourTab(event.detail) && setActiveTab(event.detail)}
                  on:tabMove={(event) => moveDockTab(event.detail)}
                  on:tabDragStart={(event) => handleDockTabDragStart(event.detail.tabId)}
                  on:tabDragEnd={handleDockTabDragEnd}
                />
                <div
                  class="troubadour-dock-panel-content"
                  role="tabpanel"
                  id={`troubadour-tab-panel-${zoneId}-${zoneActiveTab ?? 'empty'}`}
                  aria-labelledby={zoneActiveTab ? `troubadour-tab-${zoneId}-${zoneActiveTab}` : undefined}
                >
      {#if zoneActiveTab === 'files'}
        <section class="pane raw-files-pane" aria-label={$t('troubadour.workbench.files', { default: 'Files' })}>
          <div class="dense-grid file-grid" role="grid" aria-label={$t('troubadour.workbench.loadedFiles', { default: 'Loaded files' })}>
            <div class="grid-header" role="row"><span>{$t('troubadour.workbench.state', { default: 'State' })}</span><span>{$t('troubadour.workbench.file', { default: 'File' })}</span><span>{$t('troubadour.workbench.path', { default: 'Path' })}</span><span>{$t('troubadour.workbench.format', { default: 'Format' })}</span></div>
            {#each state.items as item (item.id)}
              <button class="grid-row file-row" class:selected={state.selectedIds.includes(item.id)} class:dirty={Object.keys(item.patch).length || item.artworkEdits.length} type="button" role="row" draggable="true" on:dragstart={(event) => beginItemDrag(event, item)} on:click={(event) => selectRow(event, item)} on:contextmenu={(event) => openContextMenu(event, item)}>
                <span class="state-cell" title={stateText(item)}><span class="material-symbols-outlined" class:spinning={item.state === 'loading' || item.state === 'saving'}>{stateIcon(item)}</span></span>
                <span title={item.file.name}>{item.file.name}</span><span class="path-cell" title={item.path}>{item.path}</span><span>{item.extension.toUpperCase()}</span>
              </button>
            {/each}
            {#if !state.items.length}<button class="tool-empty-state raw-empty" type="button" on:click={() => void chooseFiles()}><span class="material-symbols-outlined">audio_file</span><strong>{$t('troubadour.workbench.empty', { default: 'Add files or drop folders here' })}</strong><span>{$t('troubadour.workbench.transientHint', { default: 'Nothing is changed until Save or Apply renames.' })}</span></button>{/if}
          </div>
        </section>
      {:else if zoneActiveTab === 'albums'}
        <section class="pane albums-pane" aria-label={$t('troubadour.workbench.albums', { default: 'Albums' })}>
          <div class="album-tree" role="tree">
            {#each state.albums as album (album.id)}
              <section class="album-node" class:selected={state.selectedAlbumId === album.id} class:drop-target={dragAlbumId === album.id} role="treeitem" tabindex="-1" aria-selected={state.selectedAlbumId === album.id} aria-expanded={!collapsedAlbumIds.has(album.id)} on:dragover={(event) => dragOverAlbum(event, album)} on:dragleave={(event) => leaveAlbum(event, album)} on:drop={(event) => dropOnAlbum(event, album)}>
                <button class="album-heading" type="button" aria-expanded={!collapsedAlbumIds.has(album.id)} on:click={() => { controller.selectAlbum(album.id); toggleAlbum(album.id); }}><span class="material-symbols-outlined" aria-hidden="true">{collapsedAlbumIds.has(album.id) ? 'chevron_right' : 'expand_more'}</span><span class="album-heading-text"><strong>{album.title}</strong><small>{album.albumArtist || $t('troubadour.workbench.variousUnknown', { default: 'Various / unknown' })} · {$t('troubadour.workbench.trackCount', { default: '{count} tracks', values: { count: album.itemIds.length } })}</small></span>{#if album.itemIds.some((id) => dirtyItems.some((item) => item.id === id))}<span class="album-modified-dot" title={$t('troubadour.workbench.modified', { default: 'Modified' })}></span>{/if}</button>
                {#if !collapsedAlbumIds.has(album.id)}<div class="disc-tree" role="group">
                  {#each album.itemIds as itemId, index}
                    {@const item = state.items.find((candidate) => candidate.id === itemId)}
                    {#if item}<button class="album-track" class:selected={state.selectedIds.includes(item.id)} type="button" draggable="true" on:dragstart={(event) => beginItemDrag(event, item)} on:click={(event) => selectRow(event, item)} on:contextmenu={(event) => openContextMenu(event, item)}><span class="track-position">{effectiveFields(item)?.trackNumber || index + 1}</span><span>{effectiveFields(item)?.title || item.file.name}</span><small>{item.extension.toUpperCase()}</small></button>{/if}
                  {/each}
                </div>{/if}
              </section>
            {/each}
            {#if !state.albums.length}<div class="album-empty"><span class="material-symbols-outlined">account_tree</span><span>{$t('troubadour.workbench.albumEmpty', { default: 'Select files and create an album, or use Auto-group.' })}</span></div>{/if}
          </div>
        </section>
      {:else if zoneActiveTab === 'metadata'}
      <section class="metadata-tab-workbench">
        <section class="pane metadata-inspector" aria-label={$t('troubadour.workbench.metadataInspector', { default: 'Metadata inspector' })}>
          <div class="property-grid">
            {#each visibleFields as field}
              {@const fieldState = selectedFieldValue(state.items, state.selectedIds, field)}
              {@const dirty = selectedItems.some((item) => field in item.patch)}
              <label class="property-row" class:dirty>
                <span class="property-name">{fieldLabel(field)}{#if dirty}<span class="dirty-dot" title={$t('troubadour.workbench.staged', { default: 'Staged' })}></span>{/if}</span>
                {#if field === 'lyrics' || field === 'comment'}
                  <textarea value={fieldState.varies ? '' : fieldState.value} placeholder={fieldState.varies ? '<varies>' : ''} disabled={!selectedItems.some((item) => item.document)} on:change={(event) => editField(field, event)}></textarea>
                {:else}
                  <input value={fieldState.varies ? '' : fieldState.value} placeholder={fieldState.varies ? '<varies>' : ''} disabled={!selectedItems.some((item) => item.document)} on:change={(event) => editField(field, event)} />
                {/if}
                <span class="original-value" title={fieldState.originalVaries ? $t('troubadour.workbench.originalVaries', { default: 'Original values vary' }) : fieldState.original}>{fieldState.originalVaries ? '<varies>' : fieldState.original || '—'}</span>
                <button class="row-action hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.clearField', { default: 'Clear {field}', values: { field: fieldLabel(field) } })} disabled={!selectedItems.length} on:click={() => controller.editField(field, null)}><span class="material-symbols-outlined">backspace</span><HoverTooltip>{$t('troubadour.workbench.explicitClear', { default: 'Explicitly clear' })}</HoverTooltip></button>
                <button class="row-action hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.revertFieldNamed', { default: 'Revert {field}', values: { field: fieldLabel(field) } })} disabled={!dirty} on:click={() => controller.resetField(field)}><span class="material-symbols-outlined">undo</span><HoverTooltip>{$t('troubadour.workbench.revertField', { default: 'Revert field' })}</HoverTooltip></button>
              </label>
            {/each}
          </div>
          {#if settings.rawTagVisibility !== 'hidden'}
            <button class="raw-toggle" type="button" aria-expanded={rawExpanded} on:click={() => rawExpanded = !rawExpanded}><span class="material-symbols-outlined">{rawExpanded ? 'expand_less' : 'expand_more'}</span>{$t('troubadour.workbench.rawMetadata', { default: 'Advanced raw metadata' })} <span>{rawEntries.length}</span></button>
            {#if rawExpanded}<div class="raw-grid"><div class="raw-header"><span>{$t('troubadour.workbench.tag', { default: 'Tag' })}</span><span>{$t('troubadour.workbench.rawValue', { default: 'Raw value' })}</span></div>{#each rawEntries as [key, value]}<div class="raw-row"><code>{key}</code><span>{typeof value === 'string' ? value : value instanceof Uint8Array ? $t('troubadour.workbench.binaryBytes', { default: 'Binary · {count} B', values: { count: value.byteLength } }) : JSON.stringify(value)}</span></div>{/each}</div>{/if}
          {/if}
        </section>
        <section class="pane artwork-inspector" aria-label={$t('troubadour.workbench.artworkInspector', { default: 'Artwork inspector' })} on:dragover={handleArtworkDragOver} on:drop={handleArtworkDrop}>
          <div class="artwork-content">
            <div class="artwork-list" role="listbox" aria-label={$t('troubadour.workbench.embeddedImages', { default: 'Embedded images' })}>
              {#if artworkMixed}
                <div class="artwork-mixed"><span class="material-symbols-outlined">difference</span><span>{$t('troubadour.workbench.mixedArtworkHint', { default: 'Selected files contain different embedded images.' })}</span></div>
              {/if}
              {#each selectedApplied?.artwork ?? [] as artwork}
                <button type="button" class:selected={selectedArtwork?.id === artwork.id} on:click={() => selectedArtworkId = artwork.id}><span class="material-symbols-outlined">image</span><span><strong>{artwork.kind}</strong> <small>{artwork.mimeType}{artwork.width && artwork.height ? ` - ${artwork.width}×${artwork.height}` : ''} - {Math.ceil(artwork.size / 1024)} KiB</small></span></button>
              {/each}
            </div>
            <div class="artwork-preview" class:empty={!artworkUrl} class:fit-cover={settings.artworkPreviewFit === 'cover'} class:fit-actual={settings.artworkPreviewFit === 'actual'}>{#if artworkUrl}<img src={artworkUrl} alt={$t('troubadour.workbench.selectedArtwork', { default: 'Selected embedded artwork' })} />{:else}<span class="material-symbols-outlined">hide_image</span><span>{artworkMixed ? $t('troubadour.workbench.mixedArtwork', { default: 'Mixed artwork' }) : $t('troubadour.workbench.noArtwork', { default: 'No common artwork' })}</span>{/if}</div>
          </div>
          <div class="artwork-actions">
            <button class="icon-button hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.addArtwork', { default: 'Add' })} disabled={!selectedItems.some((item) => item.document)} on:click={() => openArtworkPicker('add')}><span class="material-symbols-outlined">add_photo_alternate</span><HoverTooltip>{$t('troubadour.workbench.addArtwork', { default: 'Add' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.replaceArtwork', { default: 'Replace' })} disabled={!selectedArtwork || artworkMixed} on:click={() => openArtworkPicker('replace')}><span class="material-symbols-outlined">find_replace</span><HoverTooltip>{$t('troubadour.workbench.replaceArtwork', { default: 'Replace' })}</HoverTooltip></button>
            <select class="artwork-kind" aria-label={$t('troubadour.workbench.artworkKind', { default: 'Artwork kind' })} value={selectedArtwork?.kind ?? ''} disabled={!selectedArtwork || artworkMixed} on:change={(event) => setArtworkKind(event.currentTarget.value as MediaArtwork['kind'])}><option value="coverFront">{$t('troubadour.workbench.frontCover', { default: 'Front' })}</option><option value="coverBack">{$t('troubadour.workbench.backCover', { default: 'Back' })}</option><option value="unknown">{$t('troubadour.workbench.otherArtwork', { default: 'Other' })}</option></select>
            <button class="icon-button hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.removeArtwork', { default: 'Remove artwork' })} disabled={!selectedArtwork || artworkMixed} on:click={() => selectedArtwork && controller.removeArtwork(selectedArtwork.id)}><span class="material-symbols-outlined">delete</span><HoverTooltip>{$t('troubadour.workbench.removeSelectedArtwork', { default: 'Remove selected artwork' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.clearArtwork', { default: 'Clear all artwork' })} disabled={!selectedAppliedDocuments.some((document) => document.artwork.length)} on:click={clearArtwork}><span class="material-symbols-outlined">delete_sweep</span><HoverTooltip>{$t('troubadour.workbench.clearSelectedArtwork', { default: 'Clear artwork from selected files' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.pasteArtwork', { default: 'Paste artwork' })} disabled={!selectedItems.some((item) => item.document) || !navigator.clipboard?.read} on:click={() => void pasteArtwork()}><span class="material-symbols-outlined">content_paste</span><HoverTooltip>{$t('troubadour.workbench.pasteImage', { default: 'Paste image' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.extractArtwork', { default: 'Extract artwork' })} disabled={!selectedArtwork} on:click={extractArtwork}><span class="material-symbols-outlined">download</span><HoverTooltip>{$t('troubadour.workbench.extractImage', { default: 'Extract image' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.copyArtwork', { default: 'Copy artwork' })} disabled={!selectedArtwork} on:click={() => void copyArtwork()}><span class="material-symbols-outlined">content_copy</span><HoverTooltip>{$t('troubadour.workbench.copyImage', { default: 'Copy image' })}</HoverTooltip></button>
            <button class="icon-button hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.applyArtworkToAlbum', { default: 'Apply artwork to album' })} disabled={!selectedArtwork || !state.selectedAlbumId} on:click={applyArtworkToSelectedAlbum}><span class="material-symbols-outlined">album</span><HoverTooltip>{$t('troubadour.workbench.applyToAlbumTracks', { default: 'Apply to all album tracks' })}</HoverTooltip></button>
          </div>
          {#if selectedArtwork && (selectedArtwork.size > settings.artworkSizeWarningMb * 1024 * 1024 || (selectedArtwork.width ?? 0) > settings.artworkDimensionWarningPx || (selectedArtwork.height ?? 0) > settings.artworkDimensionWarningPx)}<p class="artwork-warning"><span class="material-symbols-outlined">warning</span>{$t('troubadour.workbench.artworkWarning', { default: 'This image exceeds the configured warning threshold. It will not be resized automatically.' })}</p>{/if}
        </section>
      </section>
  {:else if zoneActiveTab === 'rename'}
    <main class="rename-workbench">
      <section class="rename-controls">
        <label><span>{$t('troubadour.workbench.template', { default: 'Template' })}</span><input bind:value={renameTemplate} spellcheck="false" on:keydown={(event) => event.key === 'Enter' && void previewRenames()} /></label>
        <button class="text-button" type="button" on:click={() => renameTemplate = '{albumArtist|trim} - {album} - {track:02} - {title}'}>{$t('troubadour.workbench.albumPreset', { default: 'Album preset' })}</button>
        <button class="text-button primary" type="button" disabled={state.busy} on:click={() => void previewRenames()}><span class="material-symbols-outlined">preview</span>{$t('troubadour.workbench.preview', { default: 'Preview' })}</button>
        <span class="template-help">{$t('troubadour.workbench.templateHelp', { default: 'Tokens: {tokens} · conditionals: {conditionals} · transforms: trim, lower, upper, title, slug, sanitize', values: { tokens: '{title} {artist} {album} {track:02}', conditionals: '[if:disc]Disc {disc} - [/if]' } })}</span>
      </section>
      <section class="rename-grid-wrap">
        <div class="dense-grid rename-grid" role="grid" aria-label="Rename preview">
          <div class="grid-header" role="row"><span>{$t('troubadour.workbench.use', { default: 'Use' })}</span><span>{$t('troubadour.workbench.oldPath', { default: 'Old path' })}</span><span>{$t('troubadour.workbench.proposedPath', { default: 'Proposed path' })}</span><span>{$t('troubadour.workbench.validation', { default: 'Validation' })}</span></div>
          {#each renameRows as row (row.id)}
            <div class="grid-row rename-row" class:invalid={row.problems.length} role="row"><span><input type="checkbox" checked={row.enabled} disabled={row.problems.length > 0} aria-label={$t('troubadour.workbench.renameFile', { default: 'Rename {name}', values: { name: row.file.name } })} on:change={(event) => setRenameRowEnabled(row.id, event.currentTarget.checked)} /></span><span title={row.path}>{row.path}</span><span title={row.proposedPath}>{row.proposedPath}</span><span class="validation-cell">{row.problems.length ? row.problems.join(' · ') : row.warnings.length ? row.warnings.join(' · ') : $t('troubadour.workbench.ready', { default: 'Ready' })}</span></div>
          {/each}
          {#if !renameRows.length}<div class="rename-empty"><span class="material-symbols-outlined">rule</span><strong>{$t('troubadour.workbench.previewFirst', { default: 'Preview before applying' })}</strong><span>{$t('troubadour.workbench.previewChecks', { default: 'Selection, staged metadata, permissions, source fingerprints, illegal names, and collisions are checked here.' })}</span></div>{/if}
        </div>
      </section>
      <footer class="rename-actions"><span>{$t('troubadour.workbench.renameSummary', { default: '{ready} ready · {blocked} blocked', values: { ready: renameRows.filter((row) => row.enabled).length, blocked: renameRows.filter((row) => row.problems.length).length } })}</span>{#if renameRows.some((row) => row.problems.includes('permission-required'))}<button class="text-button" type="button" disabled={state.busy} on:click={() => void grantRenameAccess()}><span class="material-symbols-outlined">lock_open</span>{$t('troubadour.workbench.grantAccess', { default: 'Grant access' })}</button>{/if}<button class="text-button" type="button" disabled={!renameRows.some((row) => row.enabled) || state.busy} on:click={() => void applyRenames(true)}>{$t('troubadour.workbench.saveThenRename', { default: 'Save tags then rename' })}</button><button class="text-button primary" type="button" disabled={!renameRows.some((row) => row.enabled) || state.busy} on:click={() => void applyRenames(false)}><span class="material-symbols-outlined">drive_file_rename_outline</span>{$t('troubadour.workbench.applyRenames', { default: 'Apply renames' })}</button></footer>
    </main>
  {:else if zoneActiveTab === 'loudness'}
    <LoudnessTab
      items={state.items}
      selectedIds={state.selectedIds}
      workbenchBusy={state.busy}
      on:toggleSelection={(event) => controller.select(event.detail, { additive: true })}
      on:selectAll={() => controller.selectAll()}
      on:clearSelection={() => controller.clearSelection()}
      on:removeSelected={removeSelected}
      on:written={() => void controller.reloadSelected()}
      on:busyChange={(event) => loudnessBusy = event.detail}
    />
  {:else if zoneActiveTab === 'lyrics'}
    {#key lyricsItem?.id ?? 'no-lyrics-track'}
      <LyricsEditor
        value={lyricsValue}
        currentTime={lyricsPreviewState.currentTime}
        duration={lyricsPreviewState.duration}
        disabled={!lyricsItem}
        playbackDisabled={!lyricsPreviewState.ready}
        playing={lyricsPreviewState.playing}
        trackTitle={lyricsItem?.file.name ?? ''}
        previewError={lyricsPreviewState.error}
        getCurrentTime={lyricsPreview.getCurrentTime}
        on:change={(event) => lyricsItem && controller.editItemField(lyricsItem.id, 'lyrics', event.detail)}
        on:togglePlayback={() => void lyricsPreview.togglePlayback()}
        on:seek={(event) => lyricsPreview.seek(event.detail)}
      />
    {/key}
  {:else if zoneActiveTab === 'spectrogram'}
    <SpectrogramTab item={spectrogramItem} />
  {/if}

                </div>
              </section>
            {/if}
          {/each}
          {#if dockState.zones[region.zones[0]].length && dockState.zones[region.zones[1]].length}
            <div
              class="dock-zone-half-resizer"
              class:is-horizontal={region.split === 'horizontal'}
              class:is-vertical={region.split === 'vertical'}
              role="separator"
              aria-label={$t('troubadour.dock.resizeHalves', { default: 'Resize {region}', values: { region: dockRegionLabel(region.id) } })}
              on:pointerdown={(event) => beginDockHalfResize(region.id, event)}
            ></div>
          {/if}
        </section>
      {/if}
    {/each}

    {#each dockColumnResizePairs as pair (`${pair.before}-${pair.after}`)}
      <div
        class={`dock-main-resizer dock-main-column-resizer separator-after-${pair.before}`}
        role="separator"
        aria-label={$t('troubadour.dock.resizeMain', { default: 'Resize {before} and {after}', values: { before: dockRegionLabel(pair.before), after: dockRegionLabel(pair.after) } })}
        on:pointerdown={(event) => beginMainDockResize('columns', pair.before, pair.after, event)}
      ></div>
    {/each}

    {#each dockRowResizePairs as pair (`${pair.before}-${pair.after}`)}
      <div
        class={`dock-main-resizer dock-main-row-resizer separator-after-${pair.before}`}
        role="separator"
        aria-label={$t('troubadour.dock.resizeMain', { default: 'Resize {before} and {after}', values: { before: dockRegionLabel(pair.before), after: dockRegionLabel(pair.after) } })}
        on:pointerdown={(event) => beginMainDockResize('rows', pair.before, pair.after, event)}
      ></div>
    {/each}

    <TroubadourDockCompass
      visible={draggedDockTabId !== null}
      ariaLabel={$t('troubadour.dock.compass', { default: 'Docking compass' })}
      guides={dockGuides}
      on:tabMove={(event) => moveDockTab(event.detail)}
    />
  </main>

  {#if metadataWorkbenchVisible || isDockTabActive('lyrics')}<footer class="tool-status-bar" class:error={Boolean(state.error || renameError)}>
    <span class="material-symbols-outlined" aria-hidden="true">{state.busy ? 'progress_activity' : state.error || renameError ? 'error' : 'info'}</span>
    <span>{state.error || renameError || state.message || $t('troubadour.workbench.offlineReady', { default: 'Offline workbench ready. Source files are unchanged.' })}</span>
    {#if selectedPrimary}<span class="current-path" title={selectedPrimary.path}>{selectedPrimary.path}</span>{/if}
    {#if state.activeJob}<span>{state.activeJob}{state.jobProgress !== null ? ` · ${Math.round(state.jobProgress * 100)}%` : ''}</span>{/if}
    <span class="summary">{$t('troubadour.workbench.statusSummary', { default: '{total} total · {selected} selected · {dirty} dirty · {permission} permission', values: { total: state.items.length, selected: state.selectedIds.length, dirty: dirtyItems.length, permission: state.items.filter((item) => item.state === 'permission-required').length } })}</span>
  </footer>{/if}

  {#if dragActive}<div class="tool-drop-overlay" aria-hidden="true">{$t('troubadour.workbench.drop', { default: 'Drop files or folders into the transient workbench' })}</div>{/if}
  {#if contextItemId}<MenuSurface items={contextMenuItems} x={contextMenuX} y={contextMenuY} on:action={(event) => void runContextAction(event.detail)} on:dismiss={() => contextItemId = null} />{/if}
</div>
