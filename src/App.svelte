<script lang="ts">
  import { onDestroy } from 'svelte';
  import PlayerControls from '$lib/components/PlayerControls.svelte';
  import PlaylistPanel from '$lib/components/PlaylistPanel.svelte';
  import TopMenuBar from '$lib/components/TopMenuBar.svelte';
  import TrackDetailsPanel from '$lib/components/TrackDetailsPanel.svelte';
  import { playerController } from '$lib/services/player-controller';
  import { windowManager } from '$lib/services/window-manager';
  import { playlistStore } from '$lib/stores/playlist';
  import type { PlaybackSnapshot, PlaylistItem } from '$lib/types';
  import { buildPlaylistItems } from '$lib/utils/files';

  const { items, currentId } = playlistStore;

  let playlistItems: PlaylistItem[] = [];
  let selectedId: string | null = null;
  let selectedTrack: PlaylistItem | null = null;
  let playback: PlaybackSnapshot = {
    state: 'idle',
    currentTime: 0,
    duration: 0,
    volume: 0.85,
    backend: null,
    error: undefined
  };

  const unsubscribeItems = items.subscribe((value) => (playlistItems = value));
  const unsubscribeCurrentId = currentId.subscribe((value) => (selectedId = value));
  const unsubscribeTrack = playerController.currentTrack.subscribe((value) => {
    selectedTrack = value;

    if (value?.metadata) {
      playlistStore.updateMetadata(value.id, value.metadata);
    }
  });
  const unsubscribePlayback = playerController.snapshot.subscribe((value) => (playback = value));

  let fileInput: HTMLInputElement | null = null;

  function addFiles(files: FileList | File[]) {
    const nextItems = buildPlaylistItems(files);

    if (nextItems.length === 0) {
      return [];
    }

    playlistStore.add(nextItems);
    return nextItems;
  }

  async function handleAddFiles(files: FileList | File[]) {
    const nextItems = addFiles(files);

    if (nextItems.length === 0) {
      return;
    }

    if (!selectedTrack) {
      const first = nextItems[0];
      playlistStore.select(first.id);
      await playerController.load(first);
    }
  }

  async function handleSelect(id: string) {
    playlistStore.select(id);
    const track = playlistItems.find((item) => item.id === id);

    if (!track) {
      return;
    }

    await playerController.load(track);
  }

  function handleMenuOpenFiles() {
    fileInput?.click();
  }

  async function handleMenuInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;

    if (input.files?.length) {
      await handleAddFiles(input.files);
      input.value = '';
    }
  }

  function handleOpenOptions() {
    windowManager.openOptions();
  }

  function handleStop() {
    playerController.pause();
    playerController.seek(0);
  }

  async function handleStepTrack(direction: -1 | 1) {
    if (playlistItems.length === 0) {
      return;
    }

    const currentIndex = selectedId ? playlistItems.findIndex((item) => item.id === selectedId) : -1;
    const safeIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = Math.min(Math.max(safeIndex + direction, 0), playlistItems.length - 1);
    const nextTrack = playlistItems[nextIndex];

    if (!nextTrack || nextTrack.id === selectedId) {
      return;
    }

    playlistStore.select(nextTrack.id);
    await playerController.load(nextTrack);
  }

  onDestroy(() => {
    unsubscribeItems();
    unsubscribeCurrentId();
    unsubscribeTrack();
    unsubscribePlayback();
    playerController.destroy();
  });
</script>

<svelte:head>
  <title>izci</title>
</svelte:head>

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
    on:openOptions={handleOpenOptions}
    on:exit={() => windowManager.exit()}
  />

  <main class="workspace">
    <PlaylistPanel items={playlistItems} activeId={selectedId} on:addFiles={(event) => handleAddFiles(event.detail)} on:select={(event) => handleSelect(event.detail)} />

    <section class="panel canvas-panel">
      <div class="panel-header">
        <p class="eyebrow">Workspace</p>
      </div>

      <div class="canvas-placeholder">
        <p>Intentionally empty for the MVP.</p>
        <p>Future candidates: waveform, spectrum, module pattern view, or library tooling.</p>
      </div>
    </section>

    <TrackDetailsPanel track={selectedTrack} />
  </main>

  {#if playback.error}
    <aside class="error-banner">{playback.error}</aside>
  {/if}

  <PlayerControls
    snapshot={playback}
    track={selectedTrack}
    on:toggle={() => playerController.togglePlayback(playback.state)}
    on:stop={handleStop}
    on:previous={() => handleStepTrack(-1)}
    on:next={() => handleStepTrack(1)}
    on:seek={(event) => playerController.seek(event.detail)}
    on:volume={(event) => playerController.setVolume(event.detail)}
  />
</div>
