<script lang="ts">
  import { onDestroy } from 'svelte';
  import PlayerControls from '$lib/components/PlayerControls.svelte';
  import TopMenuBar from '$lib/components/TopMenuBar.svelte';
  import TabbedWorkspace from '$lib/components/workspace/TabbedWorkspace.svelte';
  import WideWorkspace from '$lib/components/workspace/WideWorkspace.svelte';
  import type {
    WideWorkspaceResizeStartDetail,
    WorkspacePanelHandlers,
    WorkspacePanelProps,
    WorkspaceTabDefinition
  } from '$lib/components/workspace/types';
  import {
    createArtworkPresentationController,
    hasSameTrackMetadata,
    resolveTrackSnapshot
  } from '$lib/services/artwork-presentation';
  import { createImportController, FILE_INPUT_ACCEPT } from '$lib/services/import-controller';
  import { subscribeToLaunchedFiles } from '$lib/services/file-launch';
  import { mediaSessionService } from '$lib/services/media-session';
  import { playerController } from '$lib/services/player-controller';
  import {
    buildLibraryContextActions,
    buildPlaylistContextActions,
    buildSelectedWorkspaceTracks,
    getEquivalentLibraryIds,
    getOtherWorkspaceCollection,
    libraryHasAllTracks
  } from '$lib/services/workspace-actions';
  import {
    getWideContentWidth,
    resolveResizedPanelLayout,
    resolveWidePanelWidths,
    WORKSPACE_RESIZER_WIDTH
  } from '$lib/services/workspace-layout';
  import { windowManager } from '$lib/services/window-manager';
  import { windowControlsOverlayState } from '$lib/services/window-controls-overlay';
  import { appearanceSettings } from '$lib/stores/appearance-settings';
  import { libraryStore, playlistStore } from '$lib/stores/playlist';
  import { DEFAULT_PLAYER_VOLUME } from '$lib/stores/player-volume';
  import { workspacePanelLayout } from '$lib/stores/workspace-panel-layout';
  import type {
    ArtworkBackgroundMode,
    PlaybackSnapshot,
    PlaylistItem,
    PlaylistRepeatMode,
    PlaylistSelection,
    WorkspaceCollection,
    WorkspaceJumpRequest,
    WorkspacePanelLayoutSettings,
    WorkspaceResizeHandle,
    WorkspaceTab
  } from '$lib/types';
  import type { OptionsViewName } from './options/views';
  import {
    buildPlaylistItems,
    clonePlaylistItems,
    getTrackDisplayTitle,
    getTrackIdentity
  } from '$lib/utils/files';

  type TrackCollectionStore = typeof playlistStore;
  type PanelResizeState = {
    handle: WorkspaceResizeHandle;
    startX: number;
    startLayout: WorkspacePanelLayoutSettings;
  };

  const {
    items: playlistItemsStore,
    selectedIds: playlistSelectedIdsStore,
    selectedTrack: playlistSelectedTrackStore,
    shuffleEnabled: shuffleStore,
    repeatMode: repeatStore
  } = playlistStore;
  const {
    items: libraryItemsStore,
    selection: librarySelectionStore,
    selectedIds: librarySelectedIdsStore,
    selectedTrack: librarySelectedTrackStore
  } = libraryStore;

  const allWorkspaceTabs: WorkspaceTabDefinition[] = [
    { id: 'playlist', icon: 'queue_music', label: 'Playlist' },
    { id: 'library', icon: 'library_music', label: 'Library' },
    { id: 'details', icon: 'info', label: 'Details' }
  ];
  const libraryContextActions = buildLibraryContextActions();
  const artworkPresentation = createArtworkPresentationController({
    resolveTrackSnapshot: (track) =>
      resolveTrackSnapshot(track, selectedItem, playlistItems, libraryItems),
    isPlaybackDetailsPending: (trackId) =>
      pendingPlaybackTrackId === trackId || playingTrack?.id === trackId
  });

  let playlistItems: PlaylistItem[] = [];
  let libraryItems: PlaylistItem[] = [];
  let playlistSelectionIds: string[] = [];
  let librarySelectionIds: string[] = [];
  let librarySelectionAnchorId: string | null = null;
  let selectedPlaylistItem: PlaylistItem | null = null;
  let selectedLibraryItem: PlaylistItem | null = null;
  let selectedItem: PlaylistItem | null = null;
  let livePlayingTrack: PlaylistItem | null = null;
  let playerDisplayTrack: PlaylistItem | null = null;
  let playingTrack: PlaylistItem | null = null;
  let pendingPlaybackTrackId: string | null = null;
  let shuffleEnabled = false;
  let repeatMode: PlaylistRepeatMode = 'off';
  let playbackStatus: Pick<PlaybackSnapshot, 'state' | 'volume' | 'backend' | 'error'> = {
    state: 'idle',
    volume: DEFAULT_PLAYER_VOLUME,
    backend: null,
    error: undefined
  };
  let artworkPresentationState = artworkPresentation.getSnapshot();

  const unsubscribePlaylistItems = playlistItemsStore.subscribe((value) => (playlistItems = value));
  const unsubscribeLibraryItems = libraryItemsStore.subscribe((value) => (libraryItems = value));
  const unsubscribePlaylistSelectedIds = playlistSelectedIdsStore.subscribe(
    (value) => (playlistSelectionIds = value)
  );
  const unsubscribeLibrarySelectedIds = librarySelectedIdsStore.subscribe(
    (value) => (librarySelectionIds = value)
  );
  const unsubscribeLibrarySelection = librarySelectionStore.subscribe(
    (value) => (librarySelectionAnchorId = value.anchorId)
  );
  const unsubscribePlaylistSelectedTrack = playlistSelectedTrackStore.subscribe(
    (value) => (selectedPlaylistItem = value)
  );
  const unsubscribeLibrarySelectedTrack = librarySelectedTrackStore.subscribe(
    (value) => (selectedLibraryItem = value)
  );
  const unsubscribeShuffle = shuffleStore.subscribe((value) => (shuffleEnabled = value));
  const unsubscribeRepeat = repeatStore.subscribe((value) => (repeatMode = value));
  const unsubscribeTrack = playerController.currentTrack.subscribe((value) => {
    playingTrack = value;

    if (value?.id && pendingPlaybackTrackId === value.id) {
      pendingPlaybackTrackId = null;
    }

    if (!value?.metadata) {
      return;
    }

    playlistStore.updateMetadata(value.id, value.metadata);

    const playingIdentity = getTrackIdentity(value);

    for (const item of libraryItems) {
      if (getTrackIdentity(item) === playingIdentity) {
        libraryStore.updateMetadata(item.id, value.metadata);
      }
    }
  });
  const unsubscribePlaybackStatus = playerController.status.subscribe((value) => (playbackStatus = value));
  const unsubscribeArtworkPresentation = artworkPresentation.subscribe(
    (value) => (artworkPresentationState = value)
  );

  let fileInput: HTMLInputElement | null = null;
  let innerWidth = 0;
  let activeCollection: WorkspaceCollection = 'playlist';
  let activeWorkspaceTab: WorkspaceTab = 'playlist';
  let previousPlaybackState: PlaybackSnapshot['state'] = playbackStatus.state;
  let playRequestSequence = 0;
  let playlistJumpRequest: WorkspaceJumpRequest | null = null;
  let artworkBackgroundMode: ArtworkBackgroundMode = appearanceSettings.getSnapshot().artworkBackgroundMode;
  let isWorkspaceArtworkBackgroundEnabled = false;
  let isPlayerBarArtworkBackgroundEnabled = false;
  let isPlayerBarArtworkLayerActive = false;
  let isWorkspaceArtworkBackgroundActive = false;
  let isArtworkBackgroundActive = false;
  let isDetailsPanelVisible = true;
  let panelLayout = workspacePanelLayout.getSnapshot();
  let resizeState: PanelResizeState | null = null;
  let wideContentWidth = 0;
  let widePanelWidths = resolveWidePanelWidths(panelLayout, 0);
  let documentTitle = 'izci';
  let playlistPanelProps: WorkspacePanelProps;
  let libraryPanelProps: WorkspacePanelProps;
  let workspaceTabs: WorkspaceTabDefinition[] = allWorkspaceTabs.filter((tab) => tab.id !== 'details');

  const importController = createImportController({
    addFiles: handleAddFiles,
    clickFileInput: () => fileInput?.click()
  });
  const unsubscribeLaunchedFiles = subscribeToLaunchedFiles((files) => handleLaunchedFiles(files));
  const unsubscribeWorkspacePanelLayout = workspacePanelLayout.subscribe(
    (value) => (panelLayout = value)
  );
  const disconnectMediaSession = mediaSessionService.connect({
    snapshot: playerController.snapshot,
    track: playerController.currentTrack,
    handlers: {
      play: () => void handlePlay(),
      pause: handlePause,
      stop: handleStop,
      previousTrack: () => void handleStepTrack(-1),
      nextTrack: () => void handleStepTrack(1),
      seekTo: handleSeek
    }
  });

  $: isTabbedLayout = innerWidth <= 750;
  $: selectedItem = activeCollection === 'library' ? selectedLibraryItem : selectedPlaylistItem;
  $: livePlayingTrack = resolveTrackSnapshot(playingTrack, selectedItem, playlistItems, libraryItems);
  $: playerDisplayTrack = livePlayingTrack;
  $: artworkBackgroundMode = $appearanceSettings.artworkBackgroundMode;
  $: isWorkspaceArtworkBackgroundEnabled = artworkBackgroundMode === 'workspace';
  $: isPlayerBarArtworkBackgroundEnabled =
    artworkBackgroundMode === 'workspace' || artworkBackgroundMode === 'player';
  $: isPlayerBarArtworkLayerActive =
    artworkBackgroundMode === 'player' && Boolean(artworkPresentationState.visibleArtworkBackground);
  $: isWorkspaceArtworkBackgroundActive =
    isWorkspaceArtworkBackgroundEnabled && Boolean(artworkPresentationState.visibleArtworkBackground);
  $: isArtworkBackgroundActive =
    isPlayerBarArtworkBackgroundEnabled && Boolean(artworkPresentationState.visibleArtworkBackground);
  $: documentTitle =
    $appearanceSettings.showTrackTitleInWindowTitle && livePlayingTrack
      ? getTrackDisplayTitle(livePlayingTrack)
      : 'izci';
  $: {
    const viewportWidth =
      innerWidth > 0 ? innerWidth : typeof window !== 'undefined' ? window.innerWidth : 0;
    wideContentWidth = getWideContentWidth(viewportWidth, {
      detailsVisible: isDetailsPanelVisible,
      horizontalPadding: $appearanceSettings.compactShell ? 0 : undefined
    });
  }
  $: widePanelWidths = resolveWidePanelWidths(panelLayout, wideContentWidth, {
    detailsVisible: isDetailsPanelVisible
  });
  $: workspaceTabs = allWorkspaceTabs.filter(
    (tab) => tab.id !== 'details' || isDetailsPanelVisible
  );
  $: playlistPanelProps = {
    items: playlistItems,
    selectedIds: playlistSelectionIds,
    playingId: playingTrack?.id ?? null,
    jumpToItemRequest: playlistJumpRequest,
    panelTitle: 'Playlist',
    regionLabel: 'Playlist',
    shuffleEnabled,
    repeatMode,
    getContextMenuActions: getPlaylistContextActions
  };
  $: libraryPanelProps = {
    items: libraryItems,
    selectedIds: librarySelectionIds,
    selectionAnchorId: librarySelectionAnchorId,
    playingId: null,
    panelTitle: 'Library',
    regionLabel: 'Library',
    layout: 'columns',
    showShuffleControl: false,
    showRepeatControl: false,
    showSearchControl: true,
    getContextMenuActions: getLibraryContextActions
  };
  $: if (playlistSelectionIds.length > 0 && librarySelectionIds.length > 0) {
    clearSelection(getOtherWorkspaceCollection(activeCollection));
  }
  $: if (!isDetailsPanelVisible && activeWorkspaceTab === 'details') {
    setActiveWorkspaceTab(activeCollection);
  }
  $: {
    artworkPresentation.syncSelection(
      selectedItem,
      playlistSelectionIds.length > 0 || librarySelectionIds.length > 0
    );
    void artworkPresentation.syncDetailsDisplay();
  }
  $: void artworkPresentation.syncDisplayedArtwork(playerDisplayTrack);
  $: void artworkPresentation.syncArtworkBrightness(
    artworkPresentationState.visibleArtworkBackground,
    isArtworkBackgroundActive
  );
  $: artworkPresentation.syncArtworkMenuClasses(
    isWorkspaceArtworkBackgroundActive,
    artworkPresentationState.isArtworkBackgroundBright
  );
  $: artworkPresentation.setWindowControlsOverlayVisible($windowControlsOverlayState.visible);

  const playlistPanelHandlers: WorkspacePanelHandlers = {
    addFiles: (files) => handleAddFiles(files, 'playlist'),
    openFiles: () => void handleMenuOpenFiles('playlist'),
    select: (event) => handleSelect('playlist', event),
    activate: (event) => void handlePlaylistActivate(event.detail),
    contextAction: handlePlaylistContextAction,
    toggleShuffle: () => playlistStore.toggleShuffle(),
    cycleRepeat: () => playlistStore.cycleRepeatMode()
  };
  const libraryPanelHandlers: WorkspacePanelHandlers = {
    addFiles: (files) => handleAddFiles(files, 'library'),
    openFiles: () => void handleMenuOpenFiles('library'),
    select: (event) => handleSelect('library', event),
    setSelection: (event) => handleSetSelection('library', event),
    activate: (event) => void handleLibraryActivate(event.detail),
    contextAction: handleLibraryContextAction
  };

  function getCollectionStore(collection: WorkspaceCollection): TrackCollectionStore {
    return collection === 'library' ? libraryStore : playlistStore;
  }

  function getCollectionItems(collection: WorkspaceCollection): PlaylistItem[] {
    return collection === 'library' ? libraryItems : playlistItems;
  }

  function getCollectionSelectionIds(collection: WorkspaceCollection): string[] {
    return collection === 'library' ? librarySelectionIds : playlistSelectionIds;
  }

  function clearSelection(collection: WorkspaceCollection) {
    if (getCollectionSelectionIds(collection).length === 0) {
      return;
    }

    getCollectionStore(collection).setSelection({
      ids: [],
      anchorId: null,
      focusId: null
    });
  }

  function clearOtherSelection(collection: WorkspaceCollection) {
    clearSelection(getOtherWorkspaceCollection(collection));
  }

  function selectTrack(
    collection: WorkspaceCollection,
    id: string,
    options?: { range?: boolean; toggle?: boolean }
  ) {
    clearOtherSelection(collection);
    activeCollection = collection;
    getCollectionStore(collection).select(id, options);
  }

  function setCollectionSelection(
    collection: WorkspaceCollection,
    nextSelection: PlaylistSelection
  ) {
    clearOtherSelection(collection);
    activeCollection = collection;
    getCollectionStore(collection).setSelection(nextSelection);
  }

  function selectAllTracks(collection: WorkspaceCollection) {
    clearOtherSelection(collection);
    activeCollection = collection;
    getCollectionStore(collection).selectAll();
  }

  function setActiveWorkspaceTab(tab: WorkspaceTab) {
    activeWorkspaceTab = tab;

    if (tab !== 'details') {
      activeCollection = tab;
    }
  }

  function cleanupRemovedItems(items: PlaylistItem[]) {
    for (const item of items) {
      if (item.objectUrl) {
        URL.revokeObjectURL(item.objectUrl);
      }
    }
  }

  $: {
    if (
      playingTrack &&
      livePlayingTrack &&
      playingTrack.id === livePlayingTrack.id &&
      !hasSameTrackMetadata(playingTrack, livePlayingTrack)
    ) {
      playerController.refreshCurrentTrackMetadata(livePlayingTrack.id, livePlayingTrack.metadata);
    }
  }

  function addFiles(files: FileList | File[], target: WorkspaceCollection) {
    const nextItems = buildPlaylistItems(files);

    if (nextItems.length === 0) {
      return [];
    }

    return getCollectionStore(target).add(nextItems);
  }

  function handleAddFiles(
    files: FileList | File[],
    target: WorkspaceCollection = activeCollection
  ) {
    const nextItems = addFiles(files, target);

    if (nextItems.length > 0 && getCollectionSelectionIds(target).length === 0) {
      selectTrack(target, nextItems[0].id);
      return;
    }

    activeCollection = target;
  }

  async function handleLaunchedFiles(files: File[]) {
    const nextItems = buildPlaylistItems(files);

    if (nextItems.length === 0) {
      return;
    }

    await playlistStore.ready();
    setActiveWorkspaceTab('playlist');

    const { removedItems, addedItems } = playlistStore.replaceAll(nextItems);

    playerController.unload();
    cleanupRemovedItems(removedItems);

    if (addedItems.length > 0) {
      selectTrack('playlist', addedItems[0].id);
      await playTrack(addedItems[0]);
    }
  }

  function getTrackById(collection: WorkspaceCollection, id: string): PlaylistItem | null {
    const track = getCollectionItems(collection).find((item) => item.id === id);
    return track ?? null;
  }

  async function playTrack(track: PlaylistItem) {
    const requestId = ++playRequestSequence;
    pendingPlaybackTrackId = track.id;
    const playableTrack = await playlistStore.ensureLoaded(track.id, { prompt: true });

    if (requestId !== playRequestSequence) {
      if (pendingPlaybackTrackId === track.id) {
        pendingPlaybackTrackId = null;
      }
      return;
    }

    if (!playableTrack) {
      if (pendingPlaybackTrackId === track.id) {
        pendingPlaybackTrackId = null;
      }
      playerController.reportError('Could not access this file. Re-add it or grant file access.');
      return;
    }

    if (playingTrack?.id !== playableTrack.id) {
      await playerController.load(playableTrack, { autoPlay: true });

      if (requestId !== playRequestSequence) {
        if (pendingPlaybackTrackId === playableTrack.id) {
          pendingPlaybackTrackId = null;
        }
        return;
      }
      return;
    }

    if (pendingPlaybackTrackId === playableTrack.id) {
      pendingPlaybackTrackId = null;
    }

    if (
      playbackStatus.state === 'playing' ||
      playbackStatus.state === 'paused' ||
      playbackStatus.state === 'ended'
    ) {
      playerController.seek(0);
    }

    if (playbackStatus.state !== 'playing') {
      playerController.play();
    }
  }

  function handleSelect(
    collection: WorkspaceCollection,
    event: CustomEvent<{ id: string; range: boolean; toggle: boolean }>
  ) {
    selectTrack(collection, event.detail.id, {
      range: event.detail.range,
      toggle: event.detail.toggle
    });
  }

  function handleSetSelection(collection: WorkspaceCollection, event: CustomEvent<PlaylistSelection>) {
    setCollectionSelection(collection, event.detail);
  }

  async function handlePlaylistActivate(id: string) {
    const track = getTrackById('playlist', id);

    if (!track) {
      return;
    }

    selectTrack('playlist', id);
    await playTrack(track);
  }

  function handleShowPlaylistTrack(id: string) {
    setActiveWorkspaceTab('playlist');
    selectTrack('playlist', id);
    playlistJumpRequest = {
      id,
      token: (playlistJumpRequest?.token ?? 0) + 1
    };
  }

  function handleShowPlayerTrackDetails(id: string) {
    handleShowPlaylistTrack(id);
    handleShowTrackDetails();
  }

  async function handleLibraryActivate(id: string) {
    const track = getTrackById('library', id);

    if (!track) {
      return;
    }

    const [playlistTrack] = playlistStore.add(clonePlaylistItems([track]));

    if (!playlistTrack) {
      return;
    }

    selectTrack('playlist', playlistTrack.id);
    await playTrack(playlistTrack);
  }

  function beginPanelResize(event: PointerEvent, handle: WorkspaceResizeHandle) {
    if (isTabbedLayout) {
      return;
    }

    event.preventDefault();
    resizeState = {
      handle,
      startX: event.clientX,
      startLayout: panelLayout
    };
  }

  function handleWideWorkspaceResizeStart(event: CustomEvent<WideWorkspaceResizeStartDetail>) {
    beginPanelResize(event.detail.event, event.detail.handle);
  }

  function handlePanelResizeMove(event: PointerEvent) {
    if (!resizeState || isTabbedLayout) {
      return;
    }

    workspacePanelLayout.set(
      resolveResizedPanelLayout({
        handle: resizeState.handle,
        startLayout: resizeState.startLayout,
        delta: event.clientX - resizeState.startX,
        contentWidth: wideContentWidth,
        detailsVisible: isDetailsPanelVisible
      })
    );
  }

  function endPanelResize() {
    if (!resizeState) {
      return;
    }

    resizeState = null;
  }

  async function handleTogglePlayback() {
    if (playbackStatus.state === 'playing') {
      handlePause();
      return;
    }

    await handlePlay();
  }

  async function handleMenuOpenFiles(target: WorkspaceCollection = activeCollection) {
    await importController.openFiles(target);
  }

  async function handleMenuOpenFolder(target: WorkspaceCollection = activeCollection) {
    await importController.openFolder(target);
  }

  function handleMenuInput(event: Event) {
    importController.handleFileInputChange(event);
  }

  function handleOpenOptions(view?: OptionsViewName) {
    windowManager.openOptions(view);
  }

  function shouldIgnoreKeyboardTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    if (target.isContentEditable) {
      return true;
    }

    const tagName = target.tagName;
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
  }

  function handleWindowContextMenu(event: MouseEvent) {
    event.preventDefault();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Delete' && !event.ctrlKey && !event.altKey && !event.metaKey) {
      if (shouldIgnoreKeyboardTarget(event.target)) {
        return;
      }

      const ids = getCollectionSelectionIds(activeCollection);

      if (ids.length === 0) {
        return;
      }

      event.preventDefault();

      if (activeCollection === 'library') {
        removeLibraryItems(ids);
      } else {
        removePlaylistItems(ids);
      }

      return;
    }

    if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) {
      return;
    }

    if (shouldIgnoreKeyboardTarget(event.target)) {
      return;
    }

    switch (event.key.toLowerCase()) {
      case 'a':
        event.preventDefault();
        selectAllTracks(activeCollection);
        break;
      case 'o':
        event.preventDefault();
        void handleMenuOpenFiles();
        break;
      case 'p':
        event.preventDefault();
        handleOpenOptions();
        break;
      case 'q':
        event.preventDefault();
        windowManager.exit();
        break;
    }
  }

  function handleStop() {
    if (!playingTrack) {
      return;
    }

    playerController.pause();
    playerController.seek(0);
  }

  async function handlePlay() {
    if (playingTrack) {
      playerController.play();
      return;
    }

    if (!selectedPlaylistItem) {
      return;
    }

    await playTrack(selectedPlaylistItem);
  }

  function handlePause() {
    if (!playingTrack) {
      return;
    }

    playerController.pause();
  }

  function handleSeek(seconds: number) {
    if (!playingTrack) {
      return;
    }

    playerController.seek(seconds);
  }

  async function handleStepTrack(direction: -1 | 1) {
    const nextTrack = playlistStore.resolveStepTrack({
      currentId: playingTrack?.id,
      selectedId: selectedPlaylistItem?.id,
      direction,
      shuffle: shuffleEnabled,
      wrap: repeatMode === 'all'
    });

    if (!nextTrack) {
      return;
    }

    selectTrack('playlist', nextTrack.id);
    await playTrack(nextTrack);
  }

  async function handleTrackEnded() {
    const nextTrack = playlistStore.resolveTrackEnd({
      currentId: playingTrack?.id,
      shuffle: shuffleEnabled,
      repeatMode
    });

    if (!nextTrack) {
      return;
    }

    selectTrack('playlist', nextTrack.id);
    await playTrack(nextTrack);
  }

  function removePlaylistItems(ids: string[]) {
    if (ids.length === 0) {
      return;
    }

    const removedSet = new Set(ids);
    const removedItems = playlistStore.remove(ids);

    if (playingTrack && removedSet.has(playingTrack.id)) {
      playerController.unload();
    }

    cleanupRemovedItems(removedItems);
  }

  function removeLibraryItems(ids: string[]) {
    if (ids.length === 0) {
      return;
    }

    cleanupRemovedItems(libraryStore.remove(ids));
  }

  function getPlaylistContextActions(ids: string[]) {
    return buildPlaylistContextActions(playlistItems, libraryItems, ids);
  }

  function getLibraryContextActions() {
    return libraryContextActions;
  }

  function handleShowTrackDetails() {
    isDetailsPanelVisible = true;
    setActiveWorkspaceTab('details');
  }

  function handleCloseTrackDetails() {
    isDetailsPanelVisible = false;
  }

  function handlePlaylistContextAction(event: CustomEvent<{ actionId: string; ids: string[] }>) {
    const { actionId, ids } = event.detail;
    const tracks = buildSelectedWorkspaceTracks(playlistItems, ids);

    if (tracks.length === 0) {
      return;
    }

    if (actionId === 'track-details') {
      handleShowTrackDetails();
      return;
    }

    if (actionId === 'toggle-library') {
      if (libraryHasAllTracks(libraryItems, tracks)) {
        removeLibraryItems(getEquivalentLibraryIds(libraryItems, tracks));
        return;
      }

      const addedItems = libraryStore.add(clonePlaylistItems(tracks));

      if (addedItems.length > 0 && librarySelectionIds.length === 0) {
        selectTrack('library', addedItems[0].id);
      }

      return;
    }

    if (actionId === 'remove') {
      removePlaylistItems(ids);
    }
  }

  function handleLibraryContextAction(event: CustomEvent<{ actionId: string; ids: string[] }>) {
    const { actionId, ids } = event.detail;
    const tracks = buildSelectedWorkspaceTracks(libraryItems, ids);

    if (tracks.length === 0) {
      return;
    }

    if (actionId === 'track-details') {
      handleShowTrackDetails();
      return;
    }

    if (actionId === 'add-to-playlist') {
      const addedItems = playlistStore.add(clonePlaylistItems(tracks));

      if (addedItems.length > 0) {
        selectTrack('playlist', addedItems[0].id);
      }

      return;
    }

    if (actionId === 'replace-playlist') {
      const { removedItems, addedItems } = playlistStore.replaceAll(clonePlaylistItems(tracks));

      cleanupRemovedItems(removedItems);
      playerController.unload();

      if (addedItems.length > 0) {
        selectTrack('playlist', addedItems[0].id);
      }

      return;
    }

    if (actionId === 'remove') {
      removeLibraryItems(ids);
    }
  }

  $: if (playbackStatus.state !== previousPlaybackState) {
    if (playbackStatus.state === 'ended') {
      void handleTrackEnded();
    }

    previousPlaybackState = playbackStatus.state;
  }

  onDestroy(() => {
    artworkPresentation.destroy();
    unsubscribePlaylistItems();
    unsubscribeLibraryItems();
    unsubscribePlaylistSelectedIds();
    unsubscribeLibrarySelectedIds();
    unsubscribeLibrarySelection();
    unsubscribePlaylistSelectedTrack();
    unsubscribeLibrarySelectedTrack();
    unsubscribeShuffle();
    unsubscribeRepeat();
    unsubscribeTrack();
    unsubscribePlaybackStatus();
    unsubscribeArtworkPresentation();
    unsubscribeLaunchedFiles();
    unsubscribeWorkspacePanelLayout();
    disconnectMediaSession();
    playerController.destroy();
  });
</script>

<svelte:head>
  <title>{documentTitle}</title>
</svelte:head>

<svelte:window
  bind:innerWidth
  on:contextmenu={handleWindowContextMenu}
  on:keydown={handleWindowKeydown}
  on:pointermove={handlePanelResizeMove}
  on:pointerup={endPanelResize}
  on:pointercancel={endPanelResize}
/>

<div
  class="app-shell"
  class:tabbed-layout={isTabbedLayout}
  class:compact-shell={$appearanceSettings.compactShell}
  class:artwork-background-enabled={artworkBackgroundMode !== 'off'}
  class:artwork-background-active={isWorkspaceArtworkBackgroundActive}
  class:artwork-background-bright={
    isWorkspaceArtworkBackgroundActive && artworkPresentationState.isArtworkBackgroundBright
  }
  class:window-chrome-transition-bypass={artworkPresentationState.isWindowChromeTransitionBypassed}
  class:window-controls-overlay-active={$windowControlsOverlayState.visible}
>
  <div
    class="app-shell-background-layer"
    class:is-active={
      isWorkspaceArtworkBackgroundEnabled &&
      artworkPresentationState.activeArtworkBackgroundSlot === 'primary' &&
      Boolean(artworkPresentationState.artworkBackgroundPrimary)
    }
    style={`--artwork-background-image: ${
      artworkPresentationState.artworkBackgroundPrimary
        ? `url("${artworkPresentationState.artworkBackgroundPrimary.url}")`
        : 'none'
    };`}
    aria-hidden="true"
  ></div>
  <div
    class="app-shell-background-layer"
    class:is-active={
      isWorkspaceArtworkBackgroundEnabled &&
      artworkPresentationState.activeArtworkBackgroundSlot === 'secondary' &&
      Boolean(artworkPresentationState.artworkBackgroundSecondary)
    }
    style={`--artwork-background-image: ${
      artworkPresentationState.artworkBackgroundSecondary
        ? `url("${artworkPresentationState.artworkBackgroundSecondary.url}")`
        : 'none'
    };`}
    aria-hidden="true"
  ></div>
  <div
    class="app-shell-background-overlay"
    class:is-active={isWorkspaceArtworkBackgroundActive}
    aria-hidden="true"
  ></div>
  <div class="window-frame-safe-strip" aria-hidden="true"></div>
  <input
    bind:this={fileInput}
    class="sr-only"
    type="file"
    multiple
    accept={FILE_INPUT_ACCEPT}
    on:change={handleMenuInput}
  />

  <TopMenuBar
    on:openFiles={() => void handleMenuOpenFiles()}
    on:openFolder={() => void handleMenuOpenFolder()}
    on:openOptions={(event) => handleOpenOptions(event.detail?.view)}
    on:exit={() => windowManager.exit()}
  />

  {#if isTabbedLayout}
    <TabbedWorkspace
      {activeWorkspaceTab}
      {workspaceTabs}
      {playlistPanelProps}
      {playlistPanelHandlers}
      {libraryPanelProps}
      {libraryPanelHandlers}
      selectedItem={artworkPresentationState.detailsDisplayTrack}
      detailsArtwork={artworkPresentationState.visibleDetailsArtwork}
      isDetailsVisible={isDetailsPanelVisible}
      onCloseDetails={handleCloseTrackDetails}
      on:tabChange={(event) => setActiveWorkspaceTab(event.detail)}
    />
  {:else}
    <WideWorkspace
      {playlistPanelProps}
      {playlistPanelHandlers}
      {libraryPanelProps}
      {libraryPanelHandlers}
      panelWidths={widePanelWidths}
      resizerWidth={WORKSPACE_RESIZER_WIDTH}
      isResizing={Boolean(resizeState)}
      selectedItem={artworkPresentationState.detailsDisplayTrack}
      detailsArtwork={artworkPresentationState.visibleDetailsArtwork}
      isDetailsVisible={isDetailsPanelVisible}
      onCloseDetails={handleCloseTrackDetails}
      on:resizeStart={handleWideWorkspaceResizeStart}
    />
  {/if}

  {#if playbackStatus.error}
    <aside class="error-banner">{playbackStatus.error}</aside>
  {/if}

  <PlayerControls
    snapshotStore={playerController.snapshot}
    track={playerDisplayTrack}
    selectedTrack={selectedPlaylistItem}
    isTabbedLayout={isTabbedLayout}
    artwork={artworkPresentationState.displayedArtwork}
    artworkBackgroundPrimary={artworkPresentationState.artworkBackgroundPrimary}
    artworkBackgroundSecondary={artworkPresentationState.artworkBackgroundSecondary}
    activeArtworkBackgroundSlot={artworkPresentationState.activeArtworkBackgroundSlot}
    artworkBackgroundActive={isPlayerBarArtworkLayerActive}
    artworkBackgroundBright={artworkPresentationState.isArtworkBackgroundBright}
    on:toggle={handleTogglePlayback}
    on:stop={handleStop}
    on:previous={() => void handleStepTrack(-1)}
    on:next={() => void handleStepTrack(1)}
    on:seek={(event) => playerController.seek(event.detail)}
    on:volume={(event) => playerController.setVolume(event.detail)}
    on:showTrack={(event) => handleShowPlayerTrackDetails(event.detail)}
  />
</div>
