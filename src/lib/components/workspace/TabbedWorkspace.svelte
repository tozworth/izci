<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import BackdropZone from '$lib/components/BackdropZone.svelte';
  import LyricsPanel from '$lib/components/LyricsPanel.svelte';
  import PlaylistPanel from '$lib/components/PlaylistPanel.svelte';
  import TrackDetailsPanel from '$lib/components/TrackDetailsPanel.svelte';
  import type { LoadedStreamArtwork } from '$lib/services/stream-artwork';
  import { hasArtworkBackdrop, hasVisualizerBackdrop } from '$lib/stores/appearance-settings';
  import type {
    BackdropZoneEffect,
    LyricsDisplayStyle,
    PlaybackSnapshot,
    PlaylistItem,
    WorkspacePanelId,
    WorkspaceTab
  } from '$lib/types';
  import type { Readable } from 'svelte/store';
  import type {
    WorkspacePanelHandlers,
    WorkspacePanelProps,
    WorkspaceTabDefinition
  } from './types';

  export let snapshotStore: Readable<PlaybackSnapshot>;
  export let playbackSnapshot: PlaybackSnapshot | null = null;
  export let activeWorkspaceTab: WorkspaceTab;
  export let workspaceTabs: WorkspaceTabDefinition[] = [];
  export let playlistPanelProps: WorkspacePanelProps;
  export let playlistPanelHandlers: WorkspacePanelHandlers;
  export let libraryPanelProps: WorkspacePanelProps;
  export let libraryPanelHandlers: WorkspacePanelHandlers;
  export let selectedItem: PlaylistItem | null = null;
  export let lyricsTrack: PlaylistItem | null = null;
  export let detailsArtwork: LoadedStreamArtwork | null = null;
  export let backdropArtwork: LoadedStreamArtwork | null = null;
  export let artworkBackgroundBright = false;
  export let zoneEffects: Record<WorkspacePanelId, BackdropZoneEffect> = {
    playlist: 'none',
    library: 'none',
    details: 'none'
  };
  export let isDetailsVisible = false;
  export let isLyricsVisible = false;
  export let lyricsDisplayStyle: LyricsDisplayStyle = 'timestamped';
  export let lyricsAutoScroll = true;
  export let lyricsFontSize = 1;
  export let lyricsTheaterDowntimeDots = true;
  export let lyricsTheaterDowntimeThresholdSeconds = 10;
  export let lyricsTheaterSmoothScroll = true;
  export let lyricsResumeAutoScrollToken = 0;
  export let onCloseDetails: () => void = () => {};
  export let onCloseLyrics: () => void = () => {};

  const dispatch = createEventDispatcher<{
    seek: number;
    tabChange: WorkspaceTab;
  }>();

  function isClosableTab(tabId: WorkspaceTab): boolean {
    return tabId === 'details' || tabId === 'lyrics';
  }

  function closeTab(tabId: WorkspaceTab) {
    if (tabId === 'details') {
      onCloseDetails();
      return;
    }

    if (tabId === 'lyrics') {
      onCloseLyrics();
    }
  }

  function handleTabCloseClick(event: MouseEvent, tabId: WorkspaceTab) {
    event.stopPropagation();
    closeTab(tabId);
  }

  function handleTabAuxClick(event: MouseEvent, tabId: WorkspaceTab) {
    if (event.button !== 1 || !isClosableTab(tabId)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    closeTab(tabId);
  }

  function handleTabMouseDown(event: MouseEvent, tabId: WorkspaceTab) {
    if (event.button !== 1 || !isClosableTab(tabId)) {
      return;
    }

    event.preventDefault();
  }
</script>

<main class="workspace workspace-tabs-layout">
  <div class="workspace-tabs" role="tablist" aria-label="Workspace sections">
    {#each workspaceTabs as tab}
      <div class="workspace-tab-shell" class:has-close={isClosableTab(tab.id)}>
        <button
          type="button"
          class:active={activeWorkspaceTab === tab.id}
          class="workspace-tab"
          role="tab"
          aria-label={tab.label}
          aria-selected={activeWorkspaceTab === tab.id}
          aria-controls={`workspace-tab-panel-${tab.id}`}
          id={`workspace-tab-${tab.id}`}
          on:click={() => dispatch('tabChange', tab.id)}
          on:auxclick={(event) => handleTabAuxClick(event, tab.id)}
          on:mousedown={(event) => handleTabMouseDown(event, tab.id)}
        >
          <span class="material-symbols-outlined" aria-hidden="true">{tab.icon}</span>
          <span class="workspace-tab-label">{tab.label}</span>
        </button>

        {#if isClosableTab(tab.id)}
          <span class="workspace-tab-close-slot">
            <button
              type="button"
              class="workspace-tab-close-button"
              aria-label={`Close ${tab.label}`}
              title="Close"
              on:click={(event) => handleTabCloseClick(event, tab.id)}
              on:auxclick={(event) => handleTabAuxClick(event, tab.id)}
              on:mousedown={(event) => handleTabMouseDown(event, tab.id)}
            >
              <span class="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </span>
        {/if}
      </div>
    {/each}
  </div>

  <div
    class="workspace-tab-panel"
    role="tabpanel"
    id="workspace-tab-panel-playlist"
    aria-labelledby="workspace-tab-playlist"
    hidden={activeWorkspaceTab !== 'playlist'}
  >
    <BackdropZone
      effect={zoneEffects.playlist}
      artwork={backdropArtwork}
      artworkBright={artworkBackgroundBright}
      fillParent={true}
    >
      <PlaylistPanel
        {...playlistPanelProps}
        hideEyebrow={true}
        fillParent={true}
        on:addFiles={(event) => playlistPanelHandlers.addFiles(event.detail)}
        on:openFiles={playlistPanelHandlers.openFiles}
        on:select={playlistPanelHandlers.select}
        on:activate={playlistPanelHandlers.activate}
        on:contextAction={playlistPanelHandlers.contextAction}
        on:toggleShuffle={() => playlistPanelHandlers.toggleShuffle?.()}
        on:cycleRepeat={() => playlistPanelHandlers.cycleRepeat?.()}
      />
    </BackdropZone>
  </div>

  <div
    class="workspace-tab-panel"
    role="tabpanel"
    id="workspace-tab-panel-library"
    aria-labelledby="workspace-tab-library"
    hidden={activeWorkspaceTab !== 'library'}
  >
    <BackdropZone
      effect={zoneEffects.library}
      artwork={backdropArtwork}
      artworkBright={artworkBackgroundBright}
      fillParent={true}
    >
      <PlaylistPanel
        {...libraryPanelProps}
        hideEyebrow={true}
        fillParent={true}
        on:addFiles={(event) => libraryPanelHandlers.addFiles(event.detail)}
        on:openFiles={libraryPanelHandlers.openFiles}
        on:select={libraryPanelHandlers.select}
        on:setSelection={(event) => libraryPanelHandlers.setSelection?.(event)}
        on:activate={libraryPanelHandlers.activate}
        on:contextAction={libraryPanelHandlers.contextAction}
      />
    </BackdropZone>
  </div>

  {#if isDetailsVisible}
    <div
      class="workspace-tab-panel"
      role="tabpanel"
      id="workspace-tab-panel-details"
      aria-labelledby="workspace-tab-details"
      hidden={activeWorkspaceTab !== 'details'}
    >
      <BackdropZone
        effect={zoneEffects.details}
        artwork={backdropArtwork}
        artworkBright={artworkBackgroundBright}
        fillParent={true}
      >
        <TrackDetailsPanel
          track={selectedItem}
          artwork={detailsArtwork}
          artworkBackgroundActive={hasArtworkBackdrop(zoneEffects.details) && Boolean(backdropArtwork)}
          {artworkBackgroundBright}
          visualizerBackdropActive={hasVisualizerBackdrop(zoneEffects.details)}
          hideEyebrow={true}
          isTabbedLayout={true}
          fillParent={true}
        />
      </BackdropZone>
    </div>
  {/if}

  {#if isLyricsVisible}
    <div
      class="workspace-tab-panel"
      role="tabpanel"
      id="workspace-tab-panel-lyrics"
      aria-labelledby="workspace-tab-lyrics"
      hidden={activeWorkspaceTab !== 'lyrics'}
    >
      <BackdropZone
        effect={zoneEffects.details}
        artwork={backdropArtwork}
        artworkBright={artworkBackgroundBright}
        fillParent={true}
      >
        <LyricsPanel
          {snapshotStore}
          {playbackSnapshot}
          track={lyricsTrack}
          displayStyle={lyricsDisplayStyle}
          autoScroll={lyricsAutoScroll}
          fontSize={lyricsFontSize}
          theaterDowntimeDots={lyricsTheaterDowntimeDots}
          theaterDowntimeThresholdSeconds={lyricsTheaterDowntimeThresholdSeconds}
          theaterSmoothScroll={lyricsTheaterSmoothScroll}
          resumeAutoScrollToken={lyricsResumeAutoScrollToken}
          forceAutoScroll={activeWorkspaceTab === 'lyrics'}
          hideEyebrow={true}
          isTabbedLayout={true}
          fillParent={true}
          on:seek
        />
      </BackdropZone>
    </div>
  {/if}
</main>
