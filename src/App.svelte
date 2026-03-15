<script lang="ts">
  import { onDestroy } from 'svelte';
  import PlayerControls from '$lib/components/PlayerControls.svelte';
  import PlaylistPanel from '$lib/components/PlaylistPanel.svelte';
  import TopMenuBar from '$lib/components/TopMenuBar.svelte';
  import TrackDetailsPanel from '$lib/components/TrackDetailsPanel.svelte';
  import { playerController } from '$lib/services/player-controller';
  import { windowManager } from '$lib/services/window-manager';
  import { playlistStore } from '$lib/stores/playlist';
  import type { PlaybackSnapshot, PlaylistItem, PlaylistRepeatMode } from '$lib/types';
  import { buildPlaylistItems, readDirectorySurfaceFiles } from '$lib/utils/files';

  type DirectoryPickerWindow = Window &
    typeof globalThis & {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    };

  const { items, selectedIds, selectedTrack, shuffleEnabled: shuffleStore, repeatMode: repeatStore } = playlistStore;

  let playlistItems: PlaylistItem[] = [];
  let selectionIds: string[] = [];
  let selectedItem: PlaylistItem | null = null;
  let playingTrack: PlaylistItem | null = null;
  let shuffleEnabled = false;
  let repeatMode: PlaylistRepeatMode = 'off';
  let playback: PlaybackSnapshot = {
    state: 'idle',
    currentTime: 0,
    duration: 0,
    volume: 0.85,
    backend: null,
    error: undefined
  };

  const unsubscribeItems = items.subscribe((value) => (playlistItems = value));
  const unsubscribeSelectedIds = selectedIds.subscribe((value) => (selectionIds = value));
  const unsubscribeSelectedTrack = selectedTrack.subscribe((value) => (selectedItem = value));
  const unsubscribeShuffle = shuffleStore.subscribe((value) => (shuffleEnabled = value));
  const unsubscribeRepeat = repeatStore.subscribe((value) => (repeatMode = value));
  const unsubscribeTrack = playerController.currentTrack.subscribe((value) => {
    playingTrack = value;

    if (value?.metadata) {
      playlistStore.updateMetadata(value.id, value.metadata);
    }
  });
  const unsubscribePlayback = playerController.snapshot.subscribe((value) => (playback = value));

  let fileInput: HTMLInputElement | null = null;
  let innerWidth = 0;
  let activeWorkspaceTab: 'playlist' | 'workspace' | 'details' = 'playlist';
  let previousPlaybackState: PlaybackSnapshot['state'] = playback.state;
  $: isTabbedLayout = innerWidth <= 1080;

  const workspaceTabs = [
    { id: 'playlist', icon: 'queue_music', label: 'Playlist' },
    { id: 'workspace', icon: 'space_dashboard', label: 'Workspace' },
    { id: 'details', icon: 'info', label: 'Track Details' }
  ] as const;

  function addFiles(files: FileList | File[]) {
    const nextItems = buildPlaylistItems(files);

    if (nextItems.length === 0) {
      return [];
    }

    playlistStore.add(nextItems);
    return nextItems;
  }

  function handleAddFiles(files: FileList | File[]) {
    const nextItems = addFiles(files);

    if (nextItems.length > 0 && selectionIds.length === 0) {
      playlistStore.select(nextItems[0].id);
    }
  }

  function getTrackById(id: string): PlaylistItem | null {
    const track = playlistItems.find((item) => item.id === id);
    return track ?? null;
  }

  async function playTrack(track: PlaylistItem) {
    if (playingTrack?.id !== track.id) {
      await playerController.load(track);
    } else if (playback.state === 'ended') {
      playerController.seek(0);
    }

    playerController.play();
  }

  function handleSelect(event: CustomEvent<{ id: string; range: boolean; toggle: boolean }>) {
    playlistStore.select(event.detail.id, {
      range: event.detail.range,
      toggle: event.detail.toggle
    });
  }

  async function handlePlay(id: string) {
    const track = getTrackById(id);

    if (!track) {
      return;
    }

    playlistStore.select(id);
    await playTrack(track);
  }

  async function handleTogglePlayback() {
    if (playingTrack) {
      playerController.togglePlayback(playback.state);
      return;
    }

    if (!selectedItem) {
      return;
    }

    await playTrack(selectedItem);
  }

  function handleMenuOpenFiles() {
    fileInput?.click();
  }

  async function handleMenuOpenFolder() {
    const pickerWindow = typeof window === 'undefined' ? null : (window as DirectoryPickerWindow);

    if (!pickerWindow?.showDirectoryPicker) {
      return;
    }

    try {
      const directoryHandle = await pickerWindow.showDirectoryPicker();
      const files = await readDirectorySurfaceFiles(directoryHandle);

      if (files.length > 0) {
        handleAddFiles(files);
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
      handleAddFiles(input.files);
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
        playlistStore.selectAll();
        break;
      case 'o':
        event.preventDefault();
        handleMenuOpenFiles();
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
      selectedId: selectedItem?.id,
      direction,
      shuffle: shuffleEnabled,
      wrap: repeatMode === 'all'
    });

    const currentTrackId = playingTrack?.id ?? selectedItem?.id ?? null;

    if (!nextTrack || nextTrack.id === currentTrackId) {
      return;
    }

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

    playlistStore.select(nextTrack.id);
    await playTrack(nextTrack);
  }

  $: if (playback.state !== previousPlaybackState) {
    if (playback.state === 'ended') {
      void handleTrackEnded();
    }

    previousPlaybackState = playback.state;
  }

  function handleRemove(event: CustomEvent<string[]>) {
    const ids = event.detail;

    if (ids.length === 0) {
      return;
    }

    const removedSet = new Set(ids);
    const removedItems = playlistStore.remove(ids);

    if (playingTrack && removedSet.has(playingTrack.id)) {
      playerController.unload();
    }

    for (const item of removedItems) {
      if (item.objectUrl) {
        URL.revokeObjectURL(item.objectUrl);
      }
    }
  }

  onDestroy(() => {
    unsubscribeItems();
    unsubscribeSelectedIds();
    unsubscribeSelectedTrack();
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

<div class="app-shell">
  <input
    bind:this={fileInput}
    class="sr-only"
    type="file"
    multiple
    accept=".mp3,.wav,.flac,.ogg,.opus,.mod,.xm,.s3m,.it"
    on:change={handleMenuInput}
  />

  <TopMenuBar
    on:openFiles={handleMenuOpenFiles}
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
            aria-selected={activeWorkspaceTab === tab.id}
            aria-controls={`workspace-tab-panel-${tab.id}`}
            id={`workspace-tab-${tab.id}`}
            on:click={() => (activeWorkspaceTab = tab.id)}
          >
            <span class="material-symbols-outlined" aria-hidden="true">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        {/each}
      </div>

      <div class="workspace-tab-panel" role="tabpanel" id="workspace-tab-panel-playlist" aria-labelledby="workspace-tab-playlist" hidden={activeWorkspaceTab !== 'playlist'}>
        <PlaylistPanel
          items={playlistItems}
          selectedIds={selectionIds}
          playingId={playingTrack?.id ?? null}
          hideEyebrow={true}
          {shuffleEnabled}
          {repeatMode}
          on:addFiles={(event) => handleAddFiles(event.detail)}
          on:select={handleSelect}
          on:play={(event) => handlePlay(event.detail)}
          on:remove={handleRemove}
          on:toggleShuffle={() => playlistStore.toggleShuffle()}
          on:cycleRepeat={() => playlistStore.cycleRepeatMode()}
        />
      </div>

      <div class="workspace-tab-panel" role="tabpanel" id="workspace-tab-panel-workspace" aria-labelledby="workspace-tab-workspace" hidden={activeWorkspaceTab !== 'workspace'}>
        <section class="panel canvas-panel">
          <div class="panel-header">
            {#if !isTabbedLayout}
              <p class="eyebrow">Workspace</p>
            {/if}
          </div>

          <div class="canvas-placeholder">
            <p>Intentionally empty for the MVP.</p>
            <p>Future candidates: waveform, spectrum, module pattern view, or library tooling.</p>
          </div>
        </section>
      </div>

      <div class="workspace-tab-panel" role="tabpanel" id="workspace-tab-panel-details" aria-labelledby="workspace-tab-details" hidden={activeWorkspaceTab !== 'details'}>
        <TrackDetailsPanel track={selectedItem} hideEyebrow={true} />
      </div>
    </main>
  {:else}
    <main class="workspace">
      <PlaylistPanel
        items={playlistItems}
        selectedIds={selectionIds}
        playingId={playingTrack?.id ?? null}
        {shuffleEnabled}
        {repeatMode}
        on:addFiles={(event) => handleAddFiles(event.detail)}
        on:select={handleSelect}
        on:play={(event) => handlePlay(event.detail)}
        on:remove={handleRemove}
        on:toggleShuffle={() => playlistStore.toggleShuffle()}
        on:cycleRepeat={() => playlistStore.cycleRepeatMode()}
      />

      <section class="panel canvas-panel">
        <div class="panel-header">
          <p class="eyebrow">Workspace</p>
        </div>

        <div class="canvas-placeholder">
          <p>Intentionally empty for the MVP.</p>
          <p>Future candidates: waveform, spectrum, module pattern view, or library tooling.</p>
        </div>
      </section>

      <TrackDetailsPanel track={selectedItem} />
    </main>
  {/if}

  {#if playback.error}
    <aside class="error-banner">{playback.error}</aside>
  {/if}

  <PlayerControls
    snapshot={playback}
    track={playingTrack}
    selectedTrack={selectedItem}
    isTabbedLayout={isTabbedLayout}
    on:toggle={handleTogglePlayback}
    on:stop={handleStop}
    on:previous={() => handleStepTrack(-1)}
    on:next={() => handleStepTrack(1)}
    on:seek={(event) => playerController.seek(event.detail)}
    on:volume={(event) => playerController.setVolume(event.detail)}
  />
</div>
