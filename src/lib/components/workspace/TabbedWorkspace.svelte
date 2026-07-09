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
    BackdropZoneArtworkSettings,
    LyricsDisplayStyle,
    PlaybackSnapshot,
    PlaylistItem,
    WorkspacePanelId,
    WorkspaceTab
  } from '$lib/types';
  import type { Readable } from 'svelte/store';
  import WorkspaceTabBar from './WorkspaceTabBar.svelte';
  import type {
    WorkspacePanelHandlers,
    WorkspacePanelProps,
    WorkspaceTabDefinition,
    WorkspaceTabMoveDetail
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
    left: 'none',
    center: 'none',
    right: 'none'
  };
  export let zoneArtworkSettings: Record<WorkspacePanelId, BackdropZoneArtworkSettings | null> = {
    left: null,
    center: null,
    right: null
  };
  export let zoneArtworkBright: Record<WorkspacePanelId, boolean> = {
    left: false,
    center: false,
    right: false
  };
  export let lyricsDisplayStyle: LyricsDisplayStyle = 'timestamped';
  export let lyricsAutoScroll = true;
  export let lyricsFontSize = 1;
  export let lyricsTheaterDowntimeDots = true;
  export let lyricsTheaterDowntimeThresholdSeconds = 10;
  export let lyricsTheaterSmoothScroll = true;
  export let lyricsResumeAutoScrollToken = 0;

  const dispatch = createEventDispatcher<{
    seek: number;
    tabChange: WorkspaceTab;
    tabClose: WorkspaceTab;
    tabMove: WorkspaceTabMoveDetail;
  }>();

  function getBackdropPanelId(tabId: WorkspaceTab): WorkspacePanelId {
    if (tabId === 'playlist') {
      return 'left';
    }

    if (tabId === 'library') {
      return 'center';
    }

    return 'right';
  }

  $: activeBackdropPanelId = getBackdropPanelId(activeWorkspaceTab);
</script>

<main class="workspace workspace-tabs-layout">
  <WorkspaceTabBar
    tabs={workspaceTabs}
    activeTab={activeWorkspaceTab}
    ariaLabel="Workspace sections"
    on:tabChange={(event) => dispatch('tabChange', event.detail)}
    on:tabClose={(event) => dispatch('tabClose', event.detail)}
    on:tabMove={(event) => dispatch('tabMove', event.detail)}
  />

  {#if workspaceTabs.length === 0}
    <div class="workspace-empty-surface" aria-label="Workspace is empty"></div>
  {:else}
    <div
      class="workspace-tab-panel"
      role="tabpanel"
      id={`workspace-tab-panel-tabs-${activeWorkspaceTab}`}
      aria-labelledby={`workspace-tab-tabs-${activeWorkspaceTab}`}
    >
      <BackdropZone
        effect={zoneEffects[activeBackdropPanelId]}
        artwork={backdropArtwork}
        artworkSettings={zoneArtworkSettings[activeBackdropPanelId]}
        artworkBright={zoneArtworkBright[activeBackdropPanelId] || artworkBackgroundBright}
        fillParent={true}
        zoneId={activeBackdropPanelId}
      >
        {#if activeWorkspaceTab === 'playlist'}
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
        {:else if activeWorkspaceTab === 'library'}
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
        {:else if activeWorkspaceTab === 'details'}
          <TrackDetailsPanel
            track={selectedItem}
            artwork={detailsArtwork}
            artworkBackgroundActive={hasArtworkBackdrop(zoneEffects[activeBackdropPanelId]) && Boolean(backdropArtwork)}
            artworkBackgroundBright={zoneArtworkBright[activeBackdropPanelId] || artworkBackgroundBright}
            visualizerBackdropActive={hasVisualizerBackdrop(zoneEffects[activeBackdropPanelId])}
            hideEyebrow={true}
            isTabbedLayout={true}
            fillParent={true}
          />
        {:else if activeWorkspaceTab === 'lyrics'}
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
            forceAutoScroll={true}
            hideEyebrow={true}
            isTabbedLayout={true}
            fillParent={true}
            on:seek
          />
        {/if}
      </BackdropZone>
    </div>
  {/if}
</main>
