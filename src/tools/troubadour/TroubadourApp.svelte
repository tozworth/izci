<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { translate } from '$lib/i18n';
  import DockableTabStrip from '$lib/components/DockableTabStrip.svelte';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import type { DockTabMoveDetail } from '$lib/components/docking/types';
  import { normalizeVisibleDockWeights } from '$lib/services/dock-layout';
  import { applyMetadataPatch } from '$lib/services/media-metadata/merge';
  import type { MediaArtwork, MediaMetadataFieldName } from '$lib/services/media-metadata/types';
  import {
    listenForTroubadourBatchContext,
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
    type TroubadourDockRegionId,
    type TroubadourDockZoneId,
    type TroubadourTab,
    type TroubadourWorkspaceState
  } from '$lib/stores/troubadour-workspace';
  import LoudnessTab from './LoudnessTab.svelte';
  import LyricsEditor from './LyricsEditor.svelte';
  import SpectrogramTab from './SpectrogramTab.svelte';
  import TroubadourDockCompass from './TroubadourDockCompass.svelte';
  import TroubadourMenuBar from './TroubadourMenuBar.svelte';
  import {
    createTroubadourController,
    selectedFieldValue,
    type TroubadourAlbum,
    type TroubadourWorkbenchItem
  } from './troubadour-controller';
  import { effectiveFields } from './troubadour-loading';
  import { requestRenameAccess } from './troubadour-rename';
  import type { RenamePreviewRow } from './rename-job';
  import {
    adjacentPairs,
    buildDockGuides,
    dockLayoutStyle as buildDockLayoutStyle,
    dockRegionLabel as dockRegionLabelForRegion,
    dockRegionStyle,
    dockTabDefinitions,
    handleDockPanelDragLeave as handleDockPanelDragLeaveForTarget,
    handleDockPanelDragOver as handleDockPanelDragOverForTarget,
    handleDockPanelDrop as handleDockPanelDropForTarget,
    handleDockTabDragEnd as handleDockTabDragEndForTarget,
    handleDockTabDragStart as handleDockTabDragStartForTarget,
    moveDockTab as moveDockTabForTarget,
    startDockHalfResize,
    startMainDockResize,
    type TroubadourDockTabTarget
  } from './troubadour-dock';
  import {
    addArtworkFile as addArtworkFileToWorkbench,
    applyArtworkToSelectedAlbum as applyArtworkToAlbumSelection,
    artworkMixedAcross,
    clearArtwork as clearWorkbenchArtwork,
    copyArtwork as copyWorkbenchArtwork,
    dropArtwork as dropArtworkToWorkbench,
    extractArtwork as extractWorkbenchArtwork,
    handleArtworkDragOver as artworkDragOver,
    handleArtworkDrop as artworkDrop,
    pasteArtwork as pasteArtworkToWorkbench,
    setArtworkKind as setWorkbenchArtworkKind,
    stageArtwork as stageWorkbenchArtwork,
    type ArtworkStagingTarget
  } from './artwork-staging';
  import {
    addRememberedFolder as addRememberedFolderFromTarget,
    chooseFiles as chooseFilesFromTarget,
    chooseFolder as chooseFolderFromTarget,
    handleDrop as handleDropFromTarget,
    handleFileFallback as handleFileFallbackFromTarget,
    handleWindowDragLeave as handleWindowDragLeaveForTarget,
    handleWindowDragOver as handleWindowDragOverForTarget,
    ITEM_DRAG_MIME,
    type TroubadourImportTarget
  } from './troubadour-imports';
  import {
    buildContextMenuItems,
    dragOverAlbum as dragOverAlbumForTarget,
    dropOnAlbum as dropOnAlbumForTarget,
    fieldLabel as fieldLabelForField,
    isSpectrogramItem,
    leaveAlbum as leaveAlbumForTarget,
    stateIcon as itemStateIcon,
    stateText as itemStateText,
    type TroubadourAlbumDragTarget
  } from './troubadour-rows';
  import { createLyricsPreview, isPreviewableKind, syncLyricsFile, type LyricsPreviewState } from './lyrics-preview';

  const SETTINGS_TO_FIELDS: Record<TroubadourMetadataField, MediaMetadataFieldName> = {
    title: 'title', artist: 'artist', albumArtist: 'albumArtist', album: 'album', date: 'date',
    trackNumber: 'trackNumber', trackTotal: 'tracksTotal', discNumber: 'discNumber', discTotal: 'discsTotal',
    genre: 'genre', composer: 'composer', comment: 'comment', lyrics: 'lyrics', isrc: 'isrc', bpm: 'bpm',
    grouping: 'grouping', copyright: 'copyright', titleSort: 'titleSort', artistSort: 'artistSort',
    albumSort: 'albumSort', albumArtistSort: 'albumArtistSort'
  };

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
  let loadingSource: 'files' | 'folder' | 'library-folder' | null = null;

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

  const importTarget: TroubadourImportTarget = {
    controller,
    get settings() { return settings; },
    translate,
    setLoadingSource: (source) => loadingSource = source,
    onError: handleError,
    setDragActive: (active) => dragActive = active
  };

  const artworkStagingTarget: ArtworkStagingTarget = {
    controller,
    get settings() { return settings; },
    get selectedArtwork() { return selectedArtwork; },
    get hasSelectionArtwork() { return selectedAppliedDocuments.some((document) => document.artwork.length); },
    translate,
    setDragActive: (active) => dragActive = active,
    setError: (message) => renameError = message
  };

  const dockTabTarget: TroubadourDockTabTarget = {
    moveTab: (detail) => troubadourWorkspaceState.moveTab(detail),
    get dropZoneId() { return dockDropZoneId; },
    setDraggedTabId: (id) => draggedDockTabId = id,
    setDropZoneId: (zoneId) => dockDropZoneId = zoneId,
    setDragActive: (active) => dragActive = active
  };

  const albumDragTarget: TroubadourAlbumDragTarget = {
    get dragAlbumId() { return dragAlbumId; },
    setDragAlbumId: (id) => dragAlbumId = id,
    assignItemsToAlbum: (itemIds, albumId) => controller.assignItemsToAlbum(itemIds, albumId)
  };

  $: selectedItems = state.items.filter((item) => state.selectedIds.includes(item.id));
  $: dirtyItems = state.items.filter((item) => Object.keys(item.patch).length || item.artworkEdits.length);
  $: writableDirtyItems = dirtyItems.filter((item) => item.fileHandle && item.document);
  $: visibleFields = settings.visibleMetadataFields.map((field) => SETTINGS_TO_FIELDS[field]);
  $: selectedPrimary = selectedItems[0] ?? null;
  $: lyricsItem = selectedItems.length === 1 && selectedPrimary?.document && isPreviewableKind(selectedPrimary.kind)
    ? selectedPrimary
    : null;
  $: lyricsValue = lyricsItem ? effectiveFields(lyricsItem)?.lyrics ?? '' : '';
  $: lyricsPreviewKind = lyricsItem?.kind ?? null;
  $: spectrogramItem = state.items.find((item) => item.id === spectrogramItemId) ?? null;
  $: selectedAppliedDocuments = selectedItems
    .filter((item) => item.document)
    .map((item) => applyMetadataPatch(item.document!, item.patch, item.artworkEdits));
  $: selectedApplied = selectedAppliedDocuments[0] ?? null;
  $: artworkMixed = artworkMixedAcross(selectedAppliedDocuments);
  $: selectedArtwork = selectedApplied?.artwork.find((artwork) => artwork.id === selectedArtworkId)
    ?? selectedApplied?.artwork[0]
    ?? null;
  $: selectedRememberedFolder = state.rememberedFolders.find((folder) => folder.id === rememberedFolderId) ?? null;
  $: rawEntries = selectedPrimary?.document
    ? Object.entries(selectedPrimary.document.raw).sort(([left], [right]) => left.localeCompare(right))
    : [];
  $: summary = state.items.length ? `${state.items.length} files · ${dirtyItems.length} dirty` : '';
  $: contextMenuItem = state.items.find((candidate) => candidate.id === contextItemId) ?? null;
  $: contextMenuItems = contextMenuItem ? buildContextMenuItems(contextMenuItem, state.albums, $t) : [];
  $: dockTabsById = dockTabDefinitions($t, !isSpectrogramItem(spectrogramItem ?? selectedPrimary));
  $: dockGuides = buildDockGuides($t);
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
  $: dockLayoutStyle = buildDockLayoutStyle({
    visibleDockRows,
    visibleDockColumns,
    dockRowResizePairs,
    dockColumnResizePairs,
    hasMainDockRegion,
    dockRowWeights,
    dockColumnWeights
  });
  $: updateArtworkUrl(selectedArtwork);
  $: if (isDockTabActive('spectrogram') && !spectrogramItemId && selectedPrimary && isSpectrogramItem(selectedPrimary)) {
    spectrogramItemId = selectedPrimary.id;
  }
  $: lyricsPreviewFile = syncLyricsFile(lyricsPreview, lyricsItem?.file ?? null, lyricsPreviewKind, lyricsPreviewFile, lyricsPreviewKind);

  function beginMainDockResize(
    axis: 'rows' | 'columns',
    before: TroubadourDockRegionId,
    after: TroubadourDockRegionId,
    event: PointerEvent
  ): void {
    const cleanup = startMainDockResize(
      dockWorkspaceElement,
      visibleDockColumns,
      dockState.layout,
      axis,
      before,
      after,
      event,
      (layout) => troubadourWorkspaceState.setLayout(layout),
      () => dockResizeCleanup?.()
    );
    if (!cleanup) return;
    isDockResizing = true;
    dockResizeCleanup = () => {
      cleanup();
      isDockResizing = false;
      dockResizeCleanup = null;
    };
  }

  function beginDockHalfResize(regionId: TroubadourDockRegionId, event: PointerEvent): void {
    const cleanup = startDockHalfResize(
      dockWorkspaceElement,
      dockState.layout,
      regionId,
      event,
      (layout) => troubadourWorkspaceState.setLayout(layout),
      () => dockResizeCleanup?.()
    );
    if (!cleanup) return;
    isDockResizing = true;
    dockResizeCleanup = () => {
      cleanup();
      isDockResizing = false;
      dockResizeCleanup = null;
    };
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
    await controller.ingestBatchTracks(
      tracks,
      settings.metadataReadConcurrency,
      settings.autoGroupOnLoad ? settings.autoGroupFallback : undefined
    );
  }

  onMount(() => listenForTroubadourBatchContext((context) => void acceptContext(context)));

  function handleError(error: unknown): void {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    renameError = error instanceof Error ? error.message : $t('troubadour.workbench.operationFailed', { default: 'The operation failed.' });
  }

  async function chooseFiles(): Promise<void> {
    await chooseFilesFromTarget(importTarget, fileInput);
  }

  async function chooseFolder(): Promise<void> {
    await chooseFolderFromTarget(importTarget);
  }

  async function addRememberedFolder(): Promise<void> {
    await addRememberedFolderFromTarget(importTarget, state.rememberedFolders, rememberedFolderId);
  }

  async function handleFileFallback(event: Event): Promise<void> {
    await handleFileFallbackFromTarget(importTarget, event);
  }

  async function handleDrop(event: DragEvent): Promise<void> {
    await handleDropFromTarget(importTarget, event);
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
    await controller.saveAndPublish({ all, requestPermission: true, verify: true, settings });
  }

  function displayedFieldValue(field: MediaMetadataFieldName, value: string): string {
    if (field !== 'date' || settings.dateDisplay === 'verbatim' || !value) return value;
    if (settings.dateDisplay === 'year') return value.slice(0, 4);
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString();
  }

  async function previewRenames(): Promise<RenamePreviewRow[]> {
    renameError = '';
    setActiveTab('rename');
    try {
      const rows = await controller.previewRenames(renameTemplate, settings);
      renameRows = settings.validationSeverity === 'all'
        ? rows
        : rows.map((row) => ({
          ...row,
          problems: row.problems,
          warnings: row.warnings.filter((warning) => validationWarningVisible(warning, settings.validationSeverity))
        }));
      return renameRows;
    } catch (error) {
      handleError(error);
      renameRows = [];
      return renameRows;
    }
  }

  function validationWarningVisible(warning: string, severity: TroubadourSettings['validationSeverity']): boolean {
    if (severity === 'all') return true;
    // 'unchanged' and 'case-only' are informational; 'missing:' entries are real problems.
    return !severity || warning.startsWith('missing:');
  }

  async function applyRenames(saveFirst = false): Promise<void> {
    await controller.applyRenamesAndPublish(renameRows, {
      saveFirst,
      verification: settings.copyVerification,
      refreshPreview: previewRenames,
      settings
    });
  }

  function setRenameRowEnabled(id: string, enabled: boolean): void {
    renameRows = renameRows.map((row) => row.id === id ? { ...row, enabled } : row);
  }

  async function grantRenameAccess(): Promise<void> {
    await requestRenameAccess(renameRows);
    await previewRenames();
  }

  function setActiveTab(tab: TroubadourTab): void {
    troubadourWorkspaceState.setActiveTab(tab);
  }

  function moveDockTab(detail: DockTabMoveDetail): void {
    moveDockTabForTarget(dockTabTarget, detail);
  }

  function handleDockTabDragStart(tabId: string): void {
    handleDockTabDragStartForTarget(dockTabTarget, tabId);
  }

  function handleDockTabDragEnd(): void {
    handleDockTabDragEndForTarget(dockTabTarget);
  }

  function handleDockPanelDragOver(event: DragEvent, zoneId: TroubadourDockZoneId): void {
    handleDockPanelDragOverForTarget(dockTabTarget, event, zoneId);
  }

  function handleDockPanelDrop(event: DragEvent, zoneId: TroubadourDockZoneId): void {
    handleDockPanelDropForTarget(dockTabTarget, event, zoneId);
  }

  function handleDockPanelDragLeave(event: DragEvent, zoneId: TroubadourDockZoneId): void {
    handleDockPanelDragLeaveForTarget(dockTabTarget, event, zoneId);
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

  function handleWindowDragOver(event: DragEvent): void {
    handleWindowDragOverForTarget(importTarget, event);
  }

  function handleWindowDragLeave(event: DragEvent): void {
    handleWindowDragLeaveForTarget(importTarget, event);
  }

  function dragOverAlbum(event: DragEvent, album: TroubadourAlbum): void {
    dragOverAlbumForTarget(albumDragTarget, event, album);
  }

  function leaveAlbum(event: DragEvent, album: TroubadourAlbum): void {
    leaveAlbumForTarget(albumDragTarget, event, album);
  }

  function dropOnAlbum(event: DragEvent, album: TroubadourAlbum): void {
    dropOnAlbumForTarget(albumDragTarget, event, album);
  }

  function editField(field: MediaMetadataFieldName, event: Event): void {
    controller.editField(field, (event.currentTarget as HTMLInputElement | HTMLTextAreaElement).value);
  }

  function openArtworkPicker(mode: 'add' | 'replace'): void {
    artworkInputMode = mode;
    artworkInput.click();
  }

  function stageArtwork(artwork: MediaArtwork, mode: 'add' | 'replace' = 'add'): void {
    stageWorkbenchArtwork(artworkStagingTarget, artwork, mode);
  }

  async function addArtworkFile(event: Event): Promise<void> {
    await addArtworkFileToWorkbench(artworkStagingTarget, event, artworkInputMode);
  }

  async function pasteArtwork(): Promise<void> {
    await pasteArtworkToWorkbench(artworkStagingTarget);
  }

  async function dropArtwork(event: DragEvent): Promise<void> {
    await dropArtworkToWorkbench(artworkStagingTarget, event);
  }

  function handleArtworkDragOver(event: DragEvent): void {
    artworkDragOver(event);
  }

  function handleArtworkDrop(event: DragEvent): void {
    artworkDrop(artworkStagingTarget, event);
  }

  function clearArtwork(): void {
    clearWorkbenchArtwork(artworkStagingTarget, selectedAppliedDocuments.filter((document) => document.artwork.length).length);
  }

  function setArtworkKind(kind: MediaArtwork['kind']): void {
    setWorkbenchArtworkKind(artworkStagingTarget, kind);
  }

  function applyArtworkToSelectedAlbum(): void {
    if (!selectedArtwork || !state.selectedAlbumId) return;
    const behavior = settings.albumArtworkDefault;
    if (behavior === 'selected') {
      stageArtwork(selectedArtwork, 'add');
      return;
    }
    if (behavior === 'ask'
      && !window.confirm($t('troubadour.workbench.confirmApplyToAllAlbumTracks', {
        default: 'Apply this artwork to every track in the album?'
      }))) return;
    applyArtworkToAlbumSelection(artworkStagingTarget, state.selectedAlbumId);
  }

  async function copyArtwork(): Promise<void> {
    await copyWorkbenchArtwork(selectedArtwork);
  }

  function extractArtwork(): void {
    extractWorkbenchArtwork(selectedArtwork);
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
      { icon: loadingSource === 'files' ? 'progress_activity' : 'audio_file', spinning: loadingSource === 'files', label: $t('troubadour.workbench.addFiles', { default: 'Add files' }), action: () => void chooseFiles() },
      { icon: loadingSource === 'folder' ? 'progress_activity' : 'folder_open', spinning: loadingSource === 'folder', label: $t('troubadour.workbench.addFolder', { default: 'Add folder' }), action: () => void chooseFolder() },
      { icon: 'add_to_queue', spinning: false, label: $t('troubadour.menu.addFromIzci', { default: 'Add current izci selection' }), action: requestContext }
    ] as tool}
      <button class="icon-button hover-tooltip-anchor" type="button" aria-label={tool.label} disabled={state.busy || loudnessBusy} on:click={tool.action}><span class="material-symbols-outlined" class:spinning={tool.spinning} aria-hidden="true">{tool.icon}</span><HoverTooltip>{tool.label}</HoverTooltip></button>
    {/each}
    {#if metadataWorkbenchVisible}
      <span class="toolbar-separator"></span>
      <button class="icon-button hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.createAlbum', { default: 'Create album' })} disabled={!state.selectedIds.length || state.busy} on:click={createAlbum}><span class="material-symbols-outlined">create_new_folder</span><HoverTooltip>{$t('troubadour.workbench.createAlbum', { default: 'Create album' })}</HoverTooltip></button>
      <button class="icon-button hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.autoGroup', { default: 'Auto-group' })} disabled={state.busy} on:click={() => controller.autoGroup(settings.autoGroupFallback)}><span class="material-symbols-outlined">auto_awesome_motion</span><HoverTooltip>{$t('troubadour.workbench.autoGroup', { default: 'Auto-group' })}</HoverTooltip></button>
      <span class="toolbar-separator"></span>
      <button class="icon-button hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.saveTags', { default: 'Save staged tags' })} disabled={!writableDirtyItems.length || state.busy} on:click={() => void save(false)}><span class="material-symbols-outlined">save</span><HoverTooltip>{$t('troubadour.workbench.saveTags', { default: 'Save staged tags' })}</HoverTooltip></button>
      <button class="icon-button hover-tooltip-anchor" type="button" aria-label={$t('troubadour.menu.undo', { default: 'Undo staged change' })} disabled={!state.canUndo || state.busy} on:click={() => controller.undo()}><span class="material-symbols-outlined">undo</span><HoverTooltip>{$t('troubadour.menu.undo', { default: 'Undo staged change' })}</HoverTooltip></button>
      <button class="icon-button hover-tooltip-anchor" type="button" aria-label={$t('troubadour.menu.redo', { default: 'Redo staged change' })} disabled={!state.canRedo || state.busy} on:click={() => controller.redo()}><span class="material-symbols-outlined">redo</span><HoverTooltip>{$t('troubadour.menu.redo', { default: 'Redo staged change' })}</HoverTooltip></button>
      {#if state.busy}<button class="icon-button danger hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.stopJob', { default: 'Stop the running job' })} on:click={() => controller.cancelActiveJob()}><span class="material-symbols-outlined">stop_circle</span><HoverTooltip>{$t('troubadour.workbench.stopJob', { default: 'Stop the running job' })}</HoverTooltip></button>{/if}
      <span class="toolbar-separator"></span>
      <label class="remembered-folder-control hover-tooltip-anchor"><span class="material-symbols-outlined" aria-hidden="true">folder_shared</span><select bind:value={rememberedFolderId} aria-label={$t('troubadour.workbench.chooseLibraryFolder', { default: 'Choose a folder from your izci library' })} disabled={!state.rememberedFolders.length || state.busy}><option value="">{$t('troubadour.workbench.none', { default: 'None' })}</option>{#each state.rememberedFolders as folder}<option value={folder.id}>{folder.name}</option>{/each}</select><HoverTooltip>{$t('troubadour.workbench.chooseLibraryFolder', { default: 'Choose a folder from your izci library' })}</HoverTooltip></label>
      {#if selectedRememberedFolder}<span class="root-permission hover-tooltip-anchor" class:granted={selectedRememberedFolder.permission === 'granted'} aria-label={selectedRememberedFolder.permission === 'granted' ? $t('troubadour.workbench.folderReady', { default: 'Folder is ready to use' }) : $t('troubadour.workbench.folderNeedsAccess', { default: 'Folder may ask for access' })}><span class="material-symbols-outlined" aria-hidden="true">{selectedRememberedFolder.permission === 'granted' ? 'verified' : 'lock'}</span><HoverTooltip>{selectedRememberedFolder.permission === 'granted' ? $t('troubadour.workbench.folderReady', { default: 'Folder is ready to use' }) : $t('troubadour.workbench.folderNeedsAccess', { default: 'Folder may ask for access' })}</HoverTooltip></span>{/if}
      <button class="icon-button hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.addLibraryFolder', { default: 'Add selected library folder' })} disabled={!rememberedFolderId || state.busy} on:click={() => void addRememberedFolder()}><span class="material-symbols-outlined" class:spinning={loadingSource === 'library-folder'} aria-hidden="true">{loadingSource === 'library-folder' ? 'progress_activity' : 'drive_folder_upload'}</span><HoverTooltip>{$t('troubadour.workbench.addLibraryFolder', { default: 'Add selected library folder' })}</HoverTooltip></button>
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
                <span class="state-cell" title={itemStateText(item)}><span class="material-symbols-outlined" class:spinning={item.state === 'loading' || item.state === 'saving'}>{itemStateIcon(item)}</span></span>
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
                <span class="property-name">{fieldLabelForField(field, $t)}{#if dirty}<span class="dirty-dot" title={$t('troubadour.workbench.staged', { default: 'Staged' })}></span>{/if}</span>
                {#if field === 'lyrics' || field === 'comment'}
                  <textarea value={fieldState.varies ? '' : fieldState.value} placeholder={fieldState.varies ? '<varies>' : ''} disabled={!selectedItems.some((item) => item.document)} on:change={(event) => editField(field, event)}></textarea>
                {:else}
                  <input value={fieldState.varies ? '' : (field === 'date' ? displayedFieldValue(field, fieldState.value) : fieldState.value)} placeholder={fieldState.varies ? '<varies>' : ''} disabled={!selectedItems.some((item) => item.document)} on:change={(event) => editField(field, event)} />
                {/if}
                <span class="original-value" title={fieldState.originalVaries ? $t('troubadour.workbench.originalVaries', { default: 'Original values vary' }) : fieldState.original}>{fieldState.originalVaries ? '<varies>' : displayedFieldValue(field, fieldState.original) || '—'}</span>
                <button class="row-action hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.clearField', { default: 'Clear {field}', values: { field: fieldLabelForField(field, $t) } })} disabled={!selectedItems.length} on:click={() => controller.editField(field, null)}><span class="material-symbols-outlined">backspace</span><HoverTooltip>{$t('troubadour.workbench.explicitClear', { default: 'Explicitly clear' })}</HoverTooltip></button>
                <button class="row-action hover-tooltip-anchor" type="button" aria-label={$t('troubadour.workbench.revertFieldNamed', { default: 'Revert {field}', values: { field: fieldLabelForField(field, $t) } })} disabled={!dirty} on:click={() => controller.resetField(field)}><span class="material-symbols-outlined">undo</span><HoverTooltip>{$t('troubadour.workbench.revertField', { default: 'Revert field' })}</HoverTooltip></button>
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
              aria-label={$t('troubadour.dock.resizeHalves', { default: 'Resize {region}', values: { region: dockRegionLabelForRegion(region.id, $t) } })}
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
        aria-label={$t('troubadour.dock.resizeMain', { default: 'Resize {before} and {after}', values: { before: dockRegionLabelForRegion(pair.before, $t), after: dockRegionLabelForRegion(pair.after, $t) } })}
        on:pointerdown={(event) => beginMainDockResize('columns', pair.before, pair.after, event)}
      ></div>
    {/each}

    {#each dockRowResizePairs as pair (`${pair.before}-${pair.after}`)}
      <div
        class={`dock-main-resizer dock-main-row-resizer separator-after-${pair.before}`}
        role="separator"
        aria-label={$t('troubadour.dock.resizeMain', { default: 'Resize {before} and {after}', values: { before: dockRegionLabelForRegion(pair.before, $t), after: dockRegionLabelForRegion(pair.after, $t) } })}
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
    <span class="material-symbols-outlined" class:spinning={state.busy} aria-hidden="true">{state.busy ? 'progress_activity' : state.error || renameError ? 'error' : 'info'}</span>
    <span>{state.error || renameError || (state.activeJob ? `${state.activeJob}${state.jobProgress !== null ? ` · ${Math.round(state.jobProgress * 100)}%` : ''}` : state.message) || $t('troubadour.workbench.offlineReady', { default: 'Offline workbench ready. Source files are unchanged.' })}</span>
    {#if selectedPrimary}<span class="current-path" title={selectedPrimary.path}>{selectedPrimary.path}</span>{/if}
    <span class="summary">{$t('troubadour.workbench.statusSummary', { default: '{total} total · {selected} selected · {dirty} dirty · {permission} permission', values: { total: state.items.length, selected: state.selectedIds.length, dirty: dirtyItems.length, permission: state.items.filter((item) => item.state === 'permission-required').length } })}</span>
  </footer>{/if}

  {#if dragActive}<div class="tool-drop-overlay" aria-hidden="true">{$t('troubadour.workbench.drop', { default: 'Drop files or folders into the transient workbench' })}</div>{/if}
  {#if contextItemId}<MenuSurface items={contextMenuItems} x={contextMenuX} y={contextMenuY} on:action={(event) => void runContextAction(event.detail)} on:dismiss={() => contextItemId = null} />{/if}
</div>
