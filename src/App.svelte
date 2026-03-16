<script lang="ts">
  import { onDestroy } from 'svelte';
  import PlayerControls from '$lib/components/PlayerControls.svelte';
  import PlaylistPanel from '$lib/components/PlaylistPanel.svelte';
  import TopMenuBar from '$lib/components/TopMenuBar.svelte';
  import TrackDetailsPanel from '$lib/components/TrackDetailsPanel.svelte';
  import { playerController } from '$lib/services/player-controller';
  import { DEFAULT_PLAYER_VOLUME } from '$lib/stores/player-volume';
  import { windowManager } from '$lib/services/window-manager';
  import { libraryStore, playlistStore } from '$lib/stores/playlist';
  import type { PlaybackSnapshot, PlaylistItem, PlaylistRepeatMode, PlaylistSelection } from '$lib/types';
  import {
    buildPlaylistItems,
    clonePlaylistItems,
    getTrackIdentity,
    readDirectorySurfaceFiles,
    readFileHandleFiles
  } from '$lib/utils/files';

  type WorkspaceCollection = 'playlist' | 'library';
  type WorkspaceTab = WorkspaceCollection | 'details';
  type TrackCollectionStore = typeof playlistStore;
  type ContextMenuAction = { id: string; label: string };
  type PickerWindow = Window &
    typeof globalThis & {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
      showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
    };

  const openFilePickerOptions: OpenFilePickerOptions = {
    multiple: true,
    types: [
      {
        description: 'Supported audio files',
        accept: {
          'audio/mpeg': ['.mp3'],
          'audio/wav': ['.wav'],
          'audio/flac': ['.flac'],
          'audio/ogg': ['.ogg', '.opus'],
          'audio/opus': ['.opus'],
          'audio/x-mod': ['.mod'],
          'audio/x-xm': ['.xm'],
          'audio/x-s3m': ['.s3m'],
          'audio/x-it': ['.it']
        }
      }
    ]
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

  let playlistItems: PlaylistItem[] = [];
  let libraryItems: PlaylistItem[] = [];
  let playlistSelectionIds: string[] = [];
  let librarySelectionIds: string[] = [];
  let librarySelectionAnchorId: string | null = null;
  let selectedPlaylistItem: PlaylistItem | null = null;
  let selectedLibraryItem: PlaylistItem | null = null;
  let selectedItem: PlaylistItem | null = null;
  let playingTrack: PlaylistItem | null = null;
  let shuffleEnabled = false;
  let repeatMode: PlaylistRepeatMode = 'off';
  let playback: PlaybackSnapshot = {
    state: 'idle',
    currentTime: 0,
    duration: 0,
    volume: DEFAULT_PLAYER_VOLUME,
    backend: null,
    error: undefined
  };

  const unsubscribePlaylistItems = playlistItemsStore.subscribe((value) => (playlistItems = value));
  const unsubscribeLibraryItems = libraryItemsStore.subscribe((value) => (libraryItems = value));
  const unsubscribePlaylistSelectedIds = playlistSelectedIdsStore.subscribe((value) => (playlistSelectionIds = value));
  const unsubscribeLibrarySelectedIds = librarySelectedIdsStore.subscribe((value) => (librarySelectionIds = value));
  const unsubscribeLibrarySelection = librarySelectionStore.subscribe((value) => (librarySelectionAnchorId = value.anchorId));
  const unsubscribePlaylistSelectedTrack = playlistSelectedTrackStore.subscribe((value) => (selectedPlaylistItem = value));
  const unsubscribeLibrarySelectedTrack = librarySelectedTrackStore.subscribe((value) => (selectedLibraryItem = value));
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
  const unsubscribePlayback = playerController.snapshot.subscribe((value) => (playback = value));

  let fileInput: HTMLInputElement | null = null;
  let innerWidth = 0;
  let activeCollection: WorkspaceCollection = 'playlist';
  let activeWorkspaceTab: WorkspaceTab = 'playlist';
  let pendingFileInputTarget: WorkspaceCollection = 'playlist';
  let previousPlaybackState: PlaybackSnapshot['state'] = playback.state;
  $: isTabbedLayout = innerWidth <= 1000;
  $: selectedItem = activeCollection === 'library' ? selectedLibraryItem : selectedPlaylistItem;

  const workspaceTabs = [
    { id: 'playlist', icon: 'queue_music', label: 'Playlist' },
    { id: 'library', icon: 'library_music', label: 'Library' },
    { id: 'details', icon: 'info', label: 'Details' }
  ] as const;

  function getCollectionStore(collection: WorkspaceCollection): TrackCollectionStore {
    return collection === 'library' ? libraryStore : playlistStore;
  }

  function getCollectionItems(collection: WorkspaceCollection): PlaylistItem[] {
    return collection === 'library' ? libraryItems : playlistItems;
  }

  function getCollectionSelectionIds(collection: WorkspaceCollection): string[] {
    return collection === 'library' ? librarySelectionIds : playlistSelectionIds;
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

  function buildSelectedTracks(collection: WorkspaceCollection, ids: string[]): PlaylistItem[] {
    const idSet = new Set(ids);
    return getCollectionItems(collection).filter((item) => idSet.has(item.id));
  }

  function libraryHasAllTracks(tracks: PlaylistItem[]): boolean {
    if (tracks.length === 0) {
      return false;
    }

    const libraryKeys = new Set(libraryItems.map((item) => getTrackIdentity(item)));
    return tracks.every((track) => libraryKeys.has(getTrackIdentity(track)));
  }

  function getEquivalentLibraryIds(tracks: PlaylistItem[]): string[] {
    const trackKeys = new Set(tracks.map((track) => getTrackIdentity(track)));
    return libraryItems.filter((item) => trackKeys.has(getTrackIdentity(item))).map((item) => item.id);
  }

  function addFiles(files: FileList | File[], target: WorkspaceCollection) {
    const nextItems = buildPlaylistItems(files);

    if (nextItems.length === 0) {
      return [];
    }

    return getCollectionStore(target).add(nextItems);
  }

  function handleAddFiles(files: FileList | File[], target: WorkspaceCollection = activeCollection) {
    const nextItems = addFiles(files, target);

    if (nextItems.length > 0 && getCollectionSelectionIds(target).length === 0) {
      getCollectionStore(target).select(nextItems[0].id);
    }

    activeCollection = target;
  }

  function getTrackById(collection: WorkspaceCollection, id: string): PlaylistItem | null {
    const track = getCollectionItems(collection).find((item) => item.id === id);
    return track ?? null;
  }

  async function playTrack(track: PlaylistItem) {
    const playableTrack = await playlistStore.ensureLoaded(track.id, { prompt: true });

    if (!playableTrack) {
      playerController.reportError('Could not access this file. Re-add it or grant file access.');
      return;
    }

    if (playingTrack?.id !== playableTrack.id) {
      await playerController.load(playableTrack);
      playerController.play();
      return;
    }

    if (playback.state === 'playing' || playback.state === 'paused' || playback.state === 'ended') {
      playerController.seek(0);
    }

    if (playback.state !== 'playing') {
      playerController.play();
    }
  }

  function handleSelect(collection: WorkspaceCollection, event: CustomEvent<{ id: string; range: boolean; toggle: boolean }>) {
    activeCollection = collection;
    getCollectionStore(collection).select(event.detail.id, {
      range: event.detail.range,
      toggle: event.detail.toggle
    });
  }

  function handleSetSelection(collection: WorkspaceCollection, event: CustomEvent<PlaylistSelection>) {
    activeCollection = collection;
    getCollectionStore(collection).setSelection(event.detail);
  }

  async function handlePlaylistActivate(id: string) {
    const track = getTrackById('playlist', id);

    if (!track) {
      return;
    }

    activeCollection = 'playlist';
    playlistStore.select(id);
    await playTrack(track);
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

    activeCollection = 'playlist';
    playlistStore.select(playlistTrack.id);
    await playTrack(playlistTrack);
  }

  async function handleTogglePlayback() {
    if (playingTrack) {
      playerController.togglePlayback(playback.state);
      return;
    }

    if (!selectedPlaylistItem) {
      return;
    }

    await playTrack(selectedPlaylistItem);
  }

  async function handleMenuOpenFiles(target: WorkspaceCollection = activeCollection) {
    const pickerWindow = typeof window === 'undefined' ? null : (window as PickerWindow);

    if (!pickerWindow?.showOpenFilePicker) {
      pendingFileInputTarget = target;
      fileInput?.click();
      return;
    }

    try {
      const handles = await pickerWindow.showOpenFilePicker(openFilePickerOptions);
      const files = await readFileHandleFiles(handles);

      if (files.length > 0) {
        handleAddFiles(files, target);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      throw error;
    }
  }

  async function handleMenuOpenFolder(target: WorkspaceCollection = activeCollection) {
    const pickerWindow = typeof window === 'undefined' ? null : (window as PickerWindow);

    if (!pickerWindow?.showDirectoryPicker) {
      return;
    }

    try {
      const directoryHandle = await pickerWindow.showDirectoryPicker();
      const files = await readDirectorySurfaceFiles(directoryHandle);

      if (files.length > 0) {
        handleAddFiles(files, target);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return;
      }

      throw error;
    }
  }

  async function handleMenuInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;

    if (input.files?.length) {
      handleAddFiles(input.files, pendingFileInputTarget);
      input.value = '';
    }
  }

  function handleOpenOptions() {
    windowManager.openOptions();
  }

  function shouldIgnoreShortcutTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    if (target.isContentEditable) {
      return true;
    }

    const tagName = target.tagName;
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) {
      return;
    }

    if (shouldIgnoreShortcutTarget(event.target)) {
      return;
    }

    switch (event.key.toLowerCase()) {
      case 'a':
        event.preventDefault();
        getCollectionStore(activeCollection).selectAll();
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

  async function handleStepTrack(direction: -1 | 1) {
    const nextTrack = playlistStore.resolveStepTrack({
      currentId: playingTrack?.id,
      selectedId: selectedPlaylistItem?.id,
      direction,
      shuffle: shuffleEnabled,
      wrap: repeatMode === 'all'
    });

    const currentTrackId = playingTrack?.id ?? selectedPlaylistItem?.id ?? null;

    if (!nextTrack || nextTrack.id === currentTrackId) {
      return;
    }

    activeCollection = 'playlist';
    playlistStore.select(nextTrack.id);
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

    activeCollection = 'playlist';
    playlistStore.select(nextTrack.id);
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

  function getPlaylistContextActions(ids: string[]): ContextMenuAction[] {
    const tracks = buildSelectedTracks('playlist', ids);

    return [
      {
        id: 'toggle-library',
        label: libraryHasAllTracks(tracks) ? 'Remove from library' : 'Add to library'
      },
      {
        id: 'remove',
        label: 'Remove'
      }
    ];
  }

  function getLibraryContextActions(): ContextMenuAction[] {
    return [
      {
        id: 'add-to-playlist',
        label: 'Add to playlist'
      },
      {
        id: 'replace-playlist',
        label: 'Replace playlist'
      },
      {
        id: 'remove',
        label: 'Remove'
      }
    ];
  }

  function handlePlaylistContextAction(event: CustomEvent<{ actionId: string; ids: string[] }>) {
    const { actionId, ids } = event.detail;
    const tracks = buildSelectedTracks('playlist', ids);

    if (tracks.length === 0) {
      return;
    }

    if (actionId === 'toggle-library') {
      if (libraryHasAllTracks(tracks)) {
        removeLibraryItems(getEquivalentLibraryIds(tracks));
        return;
      }

      const addedItems = libraryStore.add(clonePlaylistItems(tracks));

      if (addedItems.length > 0 && librarySelectionIds.length === 0) {
        libraryStore.select(addedItems[0].id);
      }

      return;
    }

    if (actionId === 'remove') {
      removePlaylistItems(ids);
    }
  }

  function handleLibraryContextAction(event: CustomEvent<{ actionId: string; ids: string[] }>) {
    const { actionId, ids } = event.detail;
    const tracks = buildSelectedTracks('library', ids);

    if (tracks.length === 0) {
      return;
    }

    if (actionId === 'add-to-playlist') {
      const addedItems = playlistStore.add(clonePlaylistItems(tracks));

      if (addedItems.length > 0) {
        activeCollection = 'playlist';
        playlistStore.select(addedItems[0].id);
      }

      return;
    }

    if (actionId === 'replace-playlist') {
      const { removedItems, addedItems } = playlistStore.replaceAll(clonePlaylistItems(tracks));

      cleanupRemovedItems(removedItems);
      playerController.unload();

      if (addedItems.length > 0) {
        activeCollection = 'playlist';
        playlistStore.select(addedItems[0].id);
      }

      return;
    }

    if (actionId === 'remove') {
      removeLibraryItems(ids);
    }
  }

  $: if (playback.state !== previousPlaybackState) {
    if (playback.state === 'ended') {
      void handleTrackEnded();
    }

    previousPlaybackState = playback.state;
  }

  onDestroy(() => {
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
    unsubscribePlayback();
    playerController.destroy();
  });
</script>

<svelte:head>
  <title>izci</title>
</svelte:head>

<svelte:window bind:innerWidth on:keydown={handleWindowKeydown} />

<div class="app-shell" class:tabbed-layout={isTabbedLayout}>
  <input
    bind:this={fileInput}
    class="sr-only"
    type="file"
    multiple
    accept=".mp3,.wav,.flac,.ogg,.opus,.mod,.xm,.s3m,.it"
    on:change={handleMenuInput}
  />

  <TopMenuBar
    on:openFiles={() => void handleMenuOpenFiles()}
    on:openFolder={() => void handleMenuOpenFolder()}
    on:openOptions={handleOpenOptions}
    on:exit={() => windowManager.exit()}
  />

  {#if isTabbedLayout}
    <main class="workspace workspace-tabs-layout">
      <div class="workspace-tabs" role="tablist" aria-label="Workspace sections">
        {#each workspaceTabs as tab}
          <button
            type="button"
            class:active={activeWorkspaceTab === tab.id}
            class="workspace-tab"
            role="tab"
            aria-label={tab.label}
            aria-selected={activeWorkspaceTab === tab.id}
            aria-controls={`workspace-tab-panel-${tab.id}`}
            id={`workspace-tab-${tab.id}`}
            on:click={() => setActiveWorkspaceTab(tab.id)}
          >
            <span class="material-symbols-outlined" aria-hidden="true">{tab.icon}</span>
            <span class="workspace-tab-label">{tab.label}</span>
          </button>
        {/each}
      </div>

      <div
        class="workspace-tab-panel"
        role="tabpanel"
        id="workspace-tab-panel-playlist"
        aria-labelledby="workspace-tab-playlist"
        hidden={activeWorkspaceTab !== 'playlist'}
      >
        <PlaylistPanel
          items={playlistItems}
          selectedIds={playlistSelectionIds}
          playingId={playingTrack?.id ?? null}
          panelTitle="Playlist"
          regionLabel="Playlist"
          hideEyebrow={true}
          {shuffleEnabled}
          {repeatMode}
          getContextMenuActions={getPlaylistContextActions}
          on:addFiles={(event) => handleAddFiles(event.detail, 'playlist')}
          on:openFiles={() => void handleMenuOpenFiles('playlist')}
          on:select={(event) => handleSelect('playlist', event)}
          on:activate={(event) => void handlePlaylistActivate(event.detail)}
          on:contextAction={handlePlaylistContextAction}
          on:toggleShuffle={() => playlistStore.toggleShuffle()}
          on:cycleRepeat={() => playlistStore.cycleRepeatMode()}
        />
      </div>

      <div
        class="workspace-tab-panel"
        role="tabpanel"
        id="workspace-tab-panel-library"
        aria-labelledby="workspace-tab-library"
        hidden={activeWorkspaceTab !== 'library'}
      >
        <PlaylistPanel
          items={libraryItems}
          selectedIds={librarySelectionIds}
          selectionAnchorId={librarySelectionAnchorId}
          playingId={null}
          panelTitle="Library"
          regionLabel="Library"
          layout="columns"
          hideEyebrow={true}
          showShuffleControl={false}
          showRepeatControl={false}
          getContextMenuActions={getLibraryContextActions}
          on:addFiles={(event) => handleAddFiles(event.detail, 'library')}
          on:openFiles={() => void handleMenuOpenFiles('library')}
          on:select={(event) => handleSelect('library', event)}
          on:setSelection={(event) => handleSetSelection('library', event)}
          on:activate={(event) => void handleLibraryActivate(event.detail)}
          on:contextAction={handleLibraryContextAction}
        />
      </div>

      <div
        class="workspace-tab-panel"
        role="tabpanel"
        id="workspace-tab-panel-details"
        aria-labelledby="workspace-tab-details"
        hidden={activeWorkspaceTab !== 'details'}
      >
        <TrackDetailsPanel track={selectedItem} hideEyebrow={true} isTabbedLayout={true} />
      </div>
    </main>
  {:else}
    <main class="workspace">
      <PlaylistPanel
        items={playlistItems}
        selectedIds={playlistSelectionIds}
        playingId={playingTrack?.id ?? null}
        panelTitle="Playlist"
        regionLabel="Playlist"
        {shuffleEnabled}
        {repeatMode}
        getContextMenuActions={getPlaylistContextActions}
        on:addFiles={(event) => handleAddFiles(event.detail, 'playlist')}
        on:openFiles={() => void handleMenuOpenFiles('playlist')}
        on:select={(event) => handleSelect('playlist', event)}
        on:activate={(event) => void handlePlaylistActivate(event.detail)}
        on:contextAction={handlePlaylistContextAction}
        on:toggleShuffle={() => playlistStore.toggleShuffle()}
        on:cycleRepeat={() => playlistStore.cycleRepeatMode()}
      />

      <PlaylistPanel
        items={libraryItems}
        selectedIds={librarySelectionIds}
        selectionAnchorId={librarySelectionAnchorId}
        playingId={null}
        panelTitle="Library"
        regionLabel="Library"
        layout="columns"
        showShuffleControl={false}
        showRepeatControl={false}
        getContextMenuActions={getLibraryContextActions}
        on:addFiles={(event) => handleAddFiles(event.detail, 'library')}
        on:openFiles={() => void handleMenuOpenFiles('library')}
        on:select={(event) => handleSelect('library', event)}
        on:setSelection={(event) => handleSetSelection('library', event)}
        on:activate={(event) => void handleLibraryActivate(event.detail)}
        on:contextAction={handleLibraryContextAction}
      />

      <TrackDetailsPanel track={selectedItem} />
    </main>
  {/if}

  {#if playback.error}
    <aside class="error-banner">{playback.error}</aside>
  {/if}

  <PlayerControls
    snapshot={playback}
    track={playingTrack}
    selectedTrack={selectedPlaylistItem}
    isTabbedLayout={isTabbedLayout}
    on:toggle={handleTogglePlayback}
    on:stop={handleStop}
    on:previous={() => void handleStepTrack(-1)}
    on:next={() => void handleStepTrack(1)}
    on:seek={(event) => playerController.seek(event.detail)}
    on:volume={(event) => playerController.setVolume(event.detail)}
  />
</div>
