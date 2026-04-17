<script lang="ts">
  import { onDestroy } from 'svelte';
  import PlayerControls from '$lib/components/PlayerControls.svelte';
  import TopMenuBar from '$lib/components/TopMenuBar.svelte';
  import TabbedWorkspace from '$lib/components/workspace/TabbedWorkspace.svelte';
  import WideWorkspace from '$lib/components/workspace/WideWorkspace.svelte';
  import type {
    WorkspacePanelHandlers
  } from '$lib/components/workspace/types';
  import {
    createArtworkPresentationController,
    hasSameTrackMetadata,
    resolveTrackSnapshot
  } from '$lib/services/artwork-presentation';
  import { createImportController, FILE_INPUT_ACCEPT } from '$lib/services/import-controller';
  import { subscribeToLaunchedFiles } from '$lib/services/file-launch';
  import { createPlaybackCommandsController } from '$lib/services/playback-commands';
  import { createWorkspaceShellController } from '$lib/services/workspace-shell';
  import { mediaSessionService } from '$lib/services/media-session';
  import { playerController } from '$lib/services/player-controller';
  import {
    buildLibraryContextActions,
    buildPlaylistContextActions,
    buildSelectedWorkspaceTracks,
    getEquivalentLibraryIds,
    libraryHasAllTracks
  } from '$lib/services/workspace-actions';
  import {
    WORKSPACE_RESIZER_WIDTH
  } from '$lib/services/workspace-layout';
  import { windowManager } from '$lib/services/window-manager';
  import { windowControlsOverlayState } from '$lib/services/window-controls-overlay';
  import { appearanceSettings } from '$lib/stores/appearance-settings';
  import { libraryStore, playlistStore } from '$lib/stores/playlist';
  import { DEFAULT_PLAYER_VOLUME } from '$lib/stores/player-volume';
  import type {
    ArtworkBackgroundMode,
    PlaybackSnapshot,
    PlaylistItem,
    PlaylistRepeatMode,
    PlaylistSelection,
    WorkspaceCollection
  } from '$lib/types';
  import type { OptionsViewName } from './options/views';
  import {
    buildPlaylistItems,
    clonePlaylistItems,
    getTrackDisplayTitle,
    getTrackIdentity
  } from '$lib/utils/files';

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

  const libraryContextActions = buildLibraryContextActions();

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
  let shuffleEnabled = false;
  let repeatMode: PlaylistRepeatMode = 'off';
  let playbackStatus: Pick<PlaybackSnapshot, 'state' | 'volume' | 'backend' | 'error'> = {
    state: 'idle',
    volume: DEFAULT_PLAYER_VOLUME,
    backend: null,
    error: undefined
  };

  let fileInput: HTMLInputElement | null = null;
  let innerWidth = 0;
  let previousPlaybackState: PlaybackSnapshot['state'] = playbackStatus.state;
  let artworkBackgroundMode: ArtworkBackgroundMode = appearanceSettings.getSnapshot().artworkBackgroundMode;
  let isWorkspaceArtworkBackgroundEnabled = false;
  let isPlayerBarArtworkBackgroundEnabled = false;
  let isPlayerBarArtworkLayerActive = false;
  let isWorkspaceArtworkBackgroundActive = false;
  let isArtworkBackgroundActive = false;
  let documentTitle = 'izci';
  const workspaceShell = createWorkspaceShellController({
    getPlaylistContextActions,
    getLibraryContextActions
  });
  let workspaceShellState = workspaceShell.getSnapshot();
  const playbackCommands = createPlaybackCommandsController({
    getPlayingTrack: () => playingTrack,
    getSelectedPlaylistTrack: () => selectedPlaylistItem,
    getPlaybackState: () => playbackStatus.state,
    getShuffleEnabled: () => shuffleEnabled,
    getRepeatMode: () => repeatMode,
    getTrackById: (collection, id) =>
      (collection === 'library' ? libraryItems : playlistItems).find((item) => item.id === id) ?? null,
    selectTrack: workspaceShell.selectTrack,
    setActiveWorkspaceTab: workspaceShell.setActiveWorkspaceTab,
    cleanupRemovedItems
  });
  let playbackCommandsState = playbackCommands.getSnapshot();
  const artworkPresentation = createArtworkPresentationController({
    resolveTrackSnapshot: (track) =>
      resolveTrackSnapshot(track, selectedItem, playlistItems, libraryItems),
    isPlaybackDetailsPending: (trackId) =>
      playbackCommandsState.pendingPlaybackTrackId === trackId || playingTrack?.id === trackId
  });
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
    playbackCommands.notifyCurrentTrackChanged(value);

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
  const unsubscribeWorkspaceShell = workspaceShell.subscribe((value) => (workspaceShellState = value));
  const unsubscribePlaybackCommands = playbackCommands.subscribe(
    (value) => (playbackCommandsState = value)
  );
  const unsubscribeArtworkPresentation = artworkPresentation.subscribe(
    (value) => (artworkPresentationState = value)
  );

  const importController = createImportController({
    addFiles: handleAddFiles,
    clickFileInput: () => fileInput?.click()
  });
  const unsubscribeLaunchedFiles = subscribeToLaunchedFiles((files) =>
    void playbackCommands.replacePlaylistFromFiles(files)
  );
  const disconnectMediaSession = mediaSessionService.connect({
    snapshot: playerController.snapshot,
    track: playerController.currentTrack,
    handlers: {
      play: () => void playbackCommands.play(),
      pause: () => playbackCommands.pause(),
      stop: () => playbackCommands.stop(),
      previousTrack: () => void playbackCommands.stepTrack(-1),
      nextTrack: () => void playbackCommands.stepTrack(1),
      seekTo: (seconds) => playbackCommands.seek(seconds)
    }
  });

  $: selectedItem =
    workspaceShellState.activeCollection === 'library' ? selectedLibraryItem : selectedPlaylistItem;
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
  $: workspaceShell.sync({
    innerWidth,
    compactShell: $appearanceSettings.compactShell,
    playlistItems,
    libraryItems,
    playlistSelectionIds,
    librarySelectionIds,
    librarySelectionAnchorId,
    playingTrackId: playingTrack?.id ?? null,
    shuffleEnabled,
    repeatMode
  });
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
    activate: (event) => void playbackCommands.activatePlaylistTrack(event.detail),
    contextAction: handlePlaylistContextAction,
    toggleShuffle: () => playlistStore.toggleShuffle(),
    cycleRepeat: () => playlistStore.cycleRepeatMode()
  };
  const libraryPanelHandlers: WorkspacePanelHandlers = {
    addFiles: (files) => handleAddFiles(files, 'library'),
    openFiles: () => void handleMenuOpenFiles('library'),
    select: (event) => handleSelect('library', event),
    setSelection: (event) => handleSetSelection('library', event),
    activate: (event) => void playbackCommands.activateLibraryTrack(event.detail),
    contextAction: handleLibraryContextAction
  };

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

    return (target === 'library' ? libraryStore : playlistStore).add(nextItems);
  }

  function handleAddFiles(
    files: FileList | File[],
    target: WorkspaceCollection = workspaceShellState.activeCollection
  ) {
    const nextItems = addFiles(files, target);
    const selectedIds = target === 'library' ? librarySelectionIds : playlistSelectionIds;

    if (nextItems.length > 0 && selectedIds.length === 0) {
      workspaceShell.selectTrack(target, nextItems[0].id);
      return;
    }

    workspaceShell.focusCollection(target);
  }

  function handleSelect(
    collection: WorkspaceCollection,
    event: CustomEvent<{ id: string; range: boolean; toggle: boolean }>
  ) {
    workspaceShell.selectTrack(collection, event.detail.id, {
      range: event.detail.range,
      toggle: event.detail.toggle
    });
  }

  function handleSetSelection(collection: WorkspaceCollection, event: CustomEvent<PlaylistSelection>) {
    workspaceShell.setCollectionSelection(collection, event.detail);
  }

  function handleShowPlaylistTrack(id: string) {
    workspaceShell.showPlaylistTrack(id);
  }

  function handleShowPlayerTrackDetails(id: string) {
    handleShowPlaylistTrack(id);
    workspaceShell.showTrackDetails();
  }

  async function handleMenuOpenFiles(target: WorkspaceCollection = workspaceShellState.activeCollection) {
    await importController.openFiles(target);
  }

  async function handleMenuOpenFolder(target: WorkspaceCollection = workspaceShellState.activeCollection) {
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

      const ids =
        workspaceShellState.activeCollection === 'library' ? librarySelectionIds : playlistSelectionIds;

      if (ids.length === 0) {
        return;
      }

      event.preventDefault();

      if (workspaceShellState.activeCollection === 'library') {
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
        workspaceShell.selectAllTracks(workspaceShellState.activeCollection);
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

  function handlePlaylistContextAction(event: CustomEvent<{ actionId: string; ids: string[] }>) {
    const { actionId, ids } = event.detail;
    const tracks = buildSelectedWorkspaceTracks(playlistItems, ids);

    if (tracks.length === 0) {
      return;
    }

    if (actionId === 'track-details') {
      workspaceShell.showTrackDetails();
      return;
    }

    if (actionId === 'toggle-library') {
      if (libraryHasAllTracks(libraryItems, tracks)) {
        removeLibraryItems(getEquivalentLibraryIds(libraryItems, tracks));
        return;
      }

      const addedItems = libraryStore.add(clonePlaylistItems(tracks));

      if (addedItems.length > 0 && librarySelectionIds.length === 0) {
        workspaceShell.selectTrack('library', addedItems[0].id);
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
      workspaceShell.showTrackDetails();
      return;
    }

    if (actionId === 'add-to-playlist') {
      const addedItems = playlistStore.add(clonePlaylistItems(tracks));

      if (addedItems.length > 0) {
        workspaceShell.selectTrack('playlist', addedItems[0].id);
      }

      return;
    }

    if (actionId === 'replace-playlist') {
      const { removedItems, addedItems } = playlistStore.replaceAll(clonePlaylistItems(tracks));

      cleanupRemovedItems(removedItems);
      playerController.unload();

      if (addedItems.length > 0) {
        workspaceShell.selectTrack('playlist', addedItems[0].id);
      }

      return;
    }

    if (actionId === 'remove') {
      removeLibraryItems(ids);
    }
  }

  $: if (playbackStatus.state !== previousPlaybackState) {
    if (playbackStatus.state === 'ended') {
      void playbackCommands.handleTrackEnded();
    }

    previousPlaybackState = playbackStatus.state;
  }

  onDestroy(() => {
    artworkPresentation.destroy();
    workspaceShell.destroy();
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
    unsubscribeWorkspaceShell();
    unsubscribePlaybackCommands();
    unsubscribeArtworkPresentation();
    unsubscribeLaunchedFiles();
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
  on:pointermove={(event) => workspaceShell.handlePanelResizeMove(event)}
  on:pointerup={() => workspaceShell.endPanelResize()}
  on:pointercancel={() => workspaceShell.endPanelResize()}
/>

<div
  class="app-shell"
  class:tabbed-layout={workspaceShellState.isTabbedLayout}
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

  {#if workspaceShellState.isTabbedLayout}
    <TabbedWorkspace
      activeWorkspaceTab={workspaceShellState.activeWorkspaceTab}
      workspaceTabs={workspaceShellState.workspaceTabs}
      playlistPanelProps={workspaceShellState.playlistPanelProps}
      {playlistPanelHandlers}
      libraryPanelProps={workspaceShellState.libraryPanelProps}
      {libraryPanelHandlers}
      selectedItem={artworkPresentationState.detailsDisplayTrack}
      detailsArtwork={artworkPresentationState.visibleDetailsArtwork}
      isDetailsVisible={workspaceShellState.isDetailsPanelVisible}
      onCloseDetails={() => workspaceShell.closeTrackDetails()}
      on:tabChange={(event) => workspaceShell.setActiveWorkspaceTab(event.detail)}
    />
  {:else}
    <WideWorkspace
      playlistPanelProps={workspaceShellState.playlistPanelProps}
      {playlistPanelHandlers}
      libraryPanelProps={workspaceShellState.libraryPanelProps}
      {libraryPanelHandlers}
      panelWidths={workspaceShellState.widePanelWidths}
      resizerWidth={WORKSPACE_RESIZER_WIDTH}
      isResizing={workspaceShellState.isResizing}
      selectedItem={artworkPresentationState.detailsDisplayTrack}
      detailsArtwork={artworkPresentationState.visibleDetailsArtwork}
      isDetailsVisible={workspaceShellState.isDetailsPanelVisible}
      onCloseDetails={() => workspaceShell.closeTrackDetails()}
      on:resizeStart={(event) => workspaceShell.handleWideWorkspaceResizeStart(event.detail)}
    />
  {/if}

  {#if playbackStatus.error}
    <aside class="error-banner">{playbackStatus.error}</aside>
  {/if}

  <PlayerControls
    snapshotStore={playerController.snapshot}
    track={playerDisplayTrack}
    selectedTrack={selectedPlaylistItem}
    isTabbedLayout={workspaceShellState.isTabbedLayout}
    artwork={artworkPresentationState.displayedArtwork}
    artworkBackgroundPrimary={artworkPresentationState.artworkBackgroundPrimary}
    artworkBackgroundSecondary={artworkPresentationState.artworkBackgroundSecondary}
    activeArtworkBackgroundSlot={artworkPresentationState.activeArtworkBackgroundSlot}
    artworkBackgroundActive={isPlayerBarArtworkLayerActive}
    artworkBackgroundBright={artworkPresentationState.isArtworkBackgroundBright}
    on:toggle={() => void playbackCommands.togglePlayback()}
    on:stop={() => playbackCommands.stop()}
    on:previous={() => void playbackCommands.stepTrack(-1)}
    on:next={() => void playbackCommands.stepTrack(1)}
    on:seek={(event) => playbackCommands.seek(event.detail)}
    on:volume={(event) => playerController.setVolume(event.detail)}
    on:showTrack={(event) => handleShowPlayerTrackDetails(event.detail)}
  />
</div>
