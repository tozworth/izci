<script lang="ts">
  import { onDestroy } from 'svelte';
  import PlayerControls from '$lib/components/PlayerControls.svelte';
  import TopMenuBar from '$lib/components/TopMenuBar.svelte';
  import TabbedWorkspace from '$lib/components/workspace/TabbedWorkspace.svelte';
  import WideWorkspace from '$lib/components/workspace/WideWorkspace.svelte';
  import { analyzeArtworkBackground } from '$lib/services/artwork-background';
  import type {
    WideWorkspaceResizeStartDetail,
    WorkspacePanelHandlers,
    WorkspacePanelProps,
    WorkspaceTabDefinition
  } from '$lib/components/workspace/types';
  import { createImportController, FILE_INPUT_ACCEPT } from '$lib/services/import-controller';
  import { subscribeToLaunchedFiles } from '$lib/services/file-launch';
  import { mediaSessionService } from '$lib/services/media-session';
  import { playerController } from '$lib/services/player-controller';
  import {
    getTrackArtworkLoadKey,
    loadTrackArtwork,
    revokeTrackArtwork,
    type LoadedStreamArtwork
  } from '$lib/services/stream-artwork';
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
  type ArtworkBackgroundSlot = 'primary' | 'secondary';

  const ARTWORK_BACKGROUND_TRANSITION_MS = 220;

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

  let playlistItems: PlaylistItem[] = [];
  let libraryItems: PlaylistItem[] = [];
  let playlistSelectionIds: string[] = [];
  let librarySelectionIds: string[] = [];
  let librarySelectionAnchorId: string | null = null;
  let selectedPlaylistItem: PlaylistItem | null = null;
  let selectedLibraryItem: PlaylistItem | null = null;
  let selectedItem: PlaylistItem | null = null;
  let detailsDisplayTrack: PlaylistItem | null = null;
  let playerDisplayTrack: PlaylistItem | null = null;
  let playingTrack: PlaylistItem | null = null;
  let shuffleEnabled = false;
  let repeatMode: PlaylistRepeatMode = 'off';
  let playbackStatus: Pick<PlaybackSnapshot, 'state' | 'volume' | 'backend' | 'error'> = {
    state: 'idle',
    volume: DEFAULT_PLAYER_VOLUME,
    backend: null,
    error: undefined
  };

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

  let fileInput: HTMLInputElement | null = null;
  let innerWidth = 0;
  let activeCollection: WorkspaceCollection = 'playlist';
  let activeWorkspaceTab: WorkspaceTab = 'playlist';
  let previousPlaybackState: PlaybackSnapshot['state'] = playbackStatus.state;
  let playRequestSequence = 0;
  let playlistJumpRequest: WorkspaceJumpRequest | null = null;
  let displayedArtwork: LoadedStreamArtwork | null = null;
  let detailsArtwork: LoadedStreamArtwork | null = null;
  let artworkBackgroundPrimary: LoadedStreamArtwork | null = null;
  let artworkBackgroundSecondary: LoadedStreamArtwork | null = null;
  let activeArtworkBackgroundSlot: ArtworkBackgroundSlot = 'primary';
  let activeArtworkBackground: LoadedStreamArtwork | null = null;
  let artworkLoadToken = 0;
  let detailsArtworkLoadToken = 0;
  let artworkBackgroundCleanupTimer: ReturnType<typeof setTimeout> | null = null;
  let displayedArtworkKey = '';
  let detailsDisplayRequestKey = '';
  let artworkBrightnessKey = '';
  let artworkBackgroundMode: ArtworkBackgroundMode = appearanceSettings.getSnapshot().artworkBackgroundMode;
  let isWorkspaceArtworkBackgroundEnabled = false;
  let isPlayerBarArtworkBackgroundEnabled = false;
  let isWorkspaceArtworkBackgroundActive = false;
  let isArtworkBackgroundActive = false;
  let isArtworkBackgroundBright = false;
  let isDetailsPanelVisible = false;
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
  $: playerDisplayTrack = playingTrack ?? selectedPlaylistItem;
  $: activeArtworkBackground =
    activeArtworkBackgroundSlot === 'primary' ? artworkBackgroundPrimary : artworkBackgroundSecondary;
  $: artworkBackgroundMode = $appearanceSettings.artworkBackgroundMode;
  $: isWorkspaceArtworkBackgroundEnabled = artworkBackgroundMode === 'workspace';
  $: isPlayerBarArtworkBackgroundEnabled =
    artworkBackgroundMode === 'workspace' || artworkBackgroundMode === 'player';
  $: isWorkspaceArtworkBackgroundActive =
    isWorkspaceArtworkBackgroundEnabled && Boolean(activeArtworkBackground);
  $: isArtworkBackgroundActive =
    isPlayerBarArtworkBackgroundEnabled && Boolean(activeArtworkBackground);
  $: documentTitle = playingTrack ? getTrackDisplayTitle(playingTrack) : 'izci';
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
    const nextArtworkKey = getTrackArtworkLoadKey(playerDisplayTrack);

    if (nextArtworkKey !== displayedArtworkKey) {
      displayedArtworkKey = nextArtworkKey;
      void syncDisplayedArtwork(playerDisplayTrack);
    }
  }
  $: {
    const nextDetailsKey = getTrackArtworkLoadKey(selectedItem);

    if (nextDetailsKey !== detailsDisplayRequestKey) {
      detailsDisplayRequestKey = nextDetailsKey;
      void syncDetailsDisplay(selectedItem);
    }
  }
  $: {
    const nextBrightnessKey = isArtworkBackgroundActive && activeArtworkBackground
      ? activeArtworkBackground.url
      : '';

    if (nextBrightnessKey !== artworkBrightnessKey) {
      artworkBrightnessKey = nextBrightnessKey;
      void syncArtworkBrightness(activeArtworkBackground, isArtworkBackgroundActive);
    }
  }
  $: syncArtworkMenuClasses(isWorkspaceArtworkBackgroundActive, isArtworkBackgroundBright);

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

  function getArtworkBackground(slot: ArtworkBackgroundSlot): LoadedStreamArtwork | null {
    return slot === 'primary' ? artworkBackgroundPrimary : artworkBackgroundSecondary;
  }

  function setArtworkBackground(slot: ArtworkBackgroundSlot, artwork: LoadedStreamArtwork | null) {
    if (slot === 'primary') {
      artworkBackgroundPrimary = artwork;
      return;
    }

    artworkBackgroundSecondary = artwork;
  }

  function clearArtworkBackgroundCleanupTimer() {
    if (artworkBackgroundCleanupTimer === null) {
      return;
    }

    clearTimeout(artworkBackgroundCleanupTimer);
    artworkBackgroundCleanupTimer = null;
  }

  function scheduleArtworkBackgroundCleanup(slot: ArtworkBackgroundSlot) {
    clearArtworkBackgroundCleanupTimer();

    artworkBackgroundCleanupTimer = setTimeout(() => {
      artworkBackgroundCleanupTimer = null;

      if (slot === activeArtworkBackgroundSlot) {
        return;
      }

      const artwork = getArtworkBackground(slot);

      if (!artwork) {
        return;
      }

      revokeTrackArtwork(artwork);
      setArtworkBackground(slot, null);
    }, ARTWORK_BACKGROUND_TRANSITION_MS);
  }

  function replaceArtworkBackground(artwork: LoadedStreamArtwork | null) {
    const nextSlot: ArtworkBackgroundSlot =
      activeArtworkBackgroundSlot === 'primary' ? 'secondary' : 'primary';
    const previousActiveSlot = activeArtworkBackgroundSlot;
    const previousActiveArtwork = getArtworkBackground(previousActiveSlot);
    const staleArtwork = getArtworkBackground(nextSlot);

    clearArtworkBackgroundCleanupTimer();

    if (staleArtwork) {
      revokeTrackArtwork(staleArtwork);
    }

    setArtworkBackground(nextSlot, artwork);
    activeArtworkBackgroundSlot = nextSlot;

    if (!previousActiveArtwork) {
      setArtworkBackground(previousActiveSlot, null);
      return;
    }

    scheduleArtworkBackgroundCleanup(previousActiveSlot);
  }

  function clearDisplayedArtwork() {
    displayedArtwork = null;
  }

  function setDetailsDisplay(track: PlaylistItem | null, artwork: LoadedStreamArtwork | null) {
    const previousArtwork = detailsArtwork;
    detailsDisplayTrack = track;
    detailsArtwork = artwork;

    if (previousArtwork && previousArtwork !== artwork) {
      revokeTrackArtwork(previousArtwork);
    }
  }

  function clearDetailsDisplay() {
    setDetailsDisplay(null, null);
  }

  function clearArtworkBackgrounds() {
    clearArtworkBackgroundCleanupTimer();
    revokeTrackArtwork(artworkBackgroundPrimary);
    revokeTrackArtwork(artworkBackgroundSecondary);
    artworkBackgroundPrimary = null;
    artworkBackgroundSecondary = null;
    isArtworkBackgroundBright = false;
  }

  async function syncDisplayedArtwork(track: PlaylistItem | null) {
    const loadToken = ++artworkLoadToken;

    if (!track) {
      clearDisplayedArtwork();
      replaceArtworkBackground(null);
      return;
    }

    const artwork = await loadTrackArtwork(track);

    if (loadToken !== artworkLoadToken) {
      revokeTrackArtwork(artwork);
      return;
    }

    displayedArtwork = artwork;
    replaceArtworkBackground(artwork);
  }

  async function syncDetailsDisplay(track: PlaylistItem | null) {
    const loadToken = ++detailsArtworkLoadToken;

    if (!track) {
      clearDetailsDisplay();
      return;
    }

    const artwork = await loadTrackArtwork(track);

    if (loadToken !== detailsArtworkLoadToken) {
      revokeTrackArtwork(artwork);
      return;
    }

    setDetailsDisplay(track, artwork);
  }

  async function syncArtworkBrightness(artwork: LoadedStreamArtwork | null, enabled: boolean) {
    const brightnessKey = enabled && artwork ? artwork.url : '';

    if (brightnessKey.length === 0) {
      isArtworkBackgroundBright = false;
      return;
    }

    const analysis = await analyzeArtworkBackground(artwork);

    if (artworkBrightnessKey !== brightnessKey) {
      return;
    }

    isArtworkBackgroundBright = analysis.isBright;
  }

  function syncArtworkMenuClasses(active: boolean, bright: boolean) {
    if (typeof document === 'undefined' || !document.body) {
      return;
    }

    document.body.classList.toggle('artwork-background-active', active);
    document.body.classList.toggle('artwork-background-bright', active && bright);
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
    const playableTrack = await playlistStore.ensureLoaded(track.id, { prompt: true });

    if (requestId !== playRequestSequence) {
      return;
    }

    if (!playableTrack) {
      playerController.reportError('Could not access this file. Re-add it or grant file access.');
      return;
    }

    if (playingTrack?.id !== playableTrack.id) {
      await playerController.load(playableTrack, { autoPlay: true });

      if (requestId !== playRequestSequence) {
        return;
      }
      return;
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
    artworkLoadToken += 1;
    detailsArtworkLoadToken += 1;
    clearDisplayedArtwork();
    clearDetailsDisplay();
    clearArtworkBackgrounds();
    syncArtworkMenuClasses(false, false);
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
    isWorkspaceArtworkBackgroundActive && isArtworkBackgroundBright
  }
  class:window-controls-overlay-active={$windowControlsOverlayState.visible}
>
  <div
    class="app-shell-background-layer"
    class:is-active={
      isWorkspaceArtworkBackgroundEnabled &&
      activeArtworkBackgroundSlot === 'primary' &&
      Boolean(artworkBackgroundPrimary)
    }
    style={`--artwork-background-image: ${
      artworkBackgroundPrimary ? `url("${artworkBackgroundPrimary.url}")` : 'none'
    };`}
    aria-hidden="true"
  ></div>
  <div
    class="app-shell-background-layer"
    class:is-active={
      isWorkspaceArtworkBackgroundEnabled &&
      activeArtworkBackgroundSlot === 'secondary' &&
      Boolean(artworkBackgroundSecondary)
    }
    style={`--artwork-background-image: ${
      artworkBackgroundSecondary ? `url("${artworkBackgroundSecondary.url}")` : 'none'
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
      selectedItem={detailsDisplayTrack}
      {detailsArtwork}
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
      selectedItem={detailsDisplayTrack}
      {detailsArtwork}
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
    track={playingTrack}
    selectedTrack={selectedPlaylistItem}
    isTabbedLayout={isTabbedLayout}
    artwork={displayedArtwork}
    artworkBackgroundActive={isArtworkBackgroundActive}
    artworkBackgroundBright={isArtworkBackgroundBright}
    on:toggle={handleTogglePlayback}
    on:stop={handleStop}
    on:previous={() => void handleStepTrack(-1)}
    on:next={() => void handleStepTrack(1)}
    on:seek={(event) => playerController.seek(event.detail)}
    on:volume={(event) => playerController.setVolume(event.detail)}
    on:showTrack={(event) => handleShowPlaylistTrack(event.detail)}
  />
</div>
