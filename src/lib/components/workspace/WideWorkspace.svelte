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
  import WorkspaceResizer from '$lib/components/workspace/WorkspaceResizer.svelte';
  import type { Readable } from 'svelte/store';
  import type {
    WideWorkspaceResizeStartDetail,
    WorkspacePanelHandlers,
    WorkspacePanelProps
  } from './types';

  export let snapshotStore: Readable<PlaybackSnapshot>;
  export let playbackSnapshot: PlaybackSnapshot | null = null;
  export let playlistPanelProps: WorkspacePanelProps;
  export let playlistPanelHandlers: WorkspacePanelHandlers;
  export let libraryPanelProps: WorkspacePanelProps;
  export let libraryPanelHandlers: WorkspacePanelHandlers;
  export let panelWidths: Record<WorkspacePanelId, number>;
  export let resizerWidth = 1;
  export let isResizing = false;
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
  export let activeWorkspaceTab: WorkspaceTab = 'playlist';
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
    resizeStart: WideWorkspaceResizeStartDetail;
    seek: number;
    tabChange: WorkspaceTab;
  }>();

  $: visibleRightTabs = [
    isDetailsVisible ? { id: 'details' as const, icon: 'info', label: 'Details' } : null,
    isLyricsVisible ? { id: 'lyrics' as const, icon: 'lyrics', label: 'Lyrics' } : null
  ].filter((tab): tab is { id: 'details' | 'lyrics'; icon: string; label: string } => Boolean(tab));
  $: showRightPanelTabs = visibleRightTabs.length > 1;
  $: activeRightPanelTab =
    activeWorkspaceTab === 'lyrics' && isLyricsVisible
      ? 'lyrics'
      : activeWorkspaceTab === 'details' && isDetailsVisible
        ? 'details'
        : isDetailsVisible
          ? 'details'
          : 'lyrics';

  function closeRightPanelTab(tab: 'details' | 'lyrics') {
    if (tab === 'details') {
      onCloseDetails();
      return;
    }

    onCloseLyrics();
  }
</script>

<main class="workspace workspace-resizable" class:is-resizing={isResizing}>
  <div
    class="workspace-panel"
    style={`flex: 0 0 ${panelWidths.playlist}px; width: ${panelWidths.playlist}px;`}
  >
    <BackdropZone
      effect={zoneEffects.playlist}
      artwork={backdropArtwork}
      artworkBright={artworkBackgroundBright}
      fillParent={true}
      zoneId="playlist"
    >
      <PlaylistPanel
        {...playlistPanelProps}
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

  <WorkspaceResizer
    label="Resize playlist and library panels"
    width={resizerWidth}
    onPointerDown={(event) =>
      dispatch('resizeStart', { event, handle: 'playlist-library' })}
  />

  <div
    class="workspace-panel"
    style={`flex: 0 0 ${panelWidths.library}px; width: ${panelWidths.library}px;`}
  >
    <BackdropZone
      effect={zoneEffects.library}
      artwork={backdropArtwork}
      artworkBright={artworkBackgroundBright}
      fillParent={true}
      zoneId="library"
    >
      <PlaylistPanel
        {...libraryPanelProps}
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

  {#if isDetailsVisible || isLyricsVisible}
    <WorkspaceResizer
      label="Resize library and right panels"
      width={resizerWidth}
      onPointerDown={(event) =>
        dispatch('resizeStart', { event, handle: 'library-details' })}
    />

    <div
      class="workspace-panel"
      style={`flex: 0 0 ${panelWidths.details}px; width: ${panelWidths.details}px;`}
    >
      <BackdropZone
        effect={zoneEffects.details}
        artwork={backdropArtwork}
        artworkBright={artworkBackgroundBright}
        fillParent={true}
        zoneId="details"
      >
        {#if showRightPanelTabs}
          <div class="right-panel-tabs-layout">
            <div class="workspace-tabs right-panel-tabs" role="tablist" aria-label="Right panel views">
              {#each visibleRightTabs as tab}
                <div class="workspace-tab-shell has-close">
                  <button
                    type="button"
                    class:active={activeRightPanelTab === tab.id}
                    class="workspace-tab"
                    role="tab"
                    aria-label={tab.label}
                    aria-selected={activeRightPanelTab === tab.id}
                    aria-controls={`right-panel-tab-${tab.id}`}
                    id={`right-panel-tab-button-${tab.id}`}
                    on:click={() => dispatch('tabChange', tab.id)}
                  >
                    <span class="material-symbols-outlined" aria-hidden="true">{tab.icon}</span>
                    <span class="workspace-tab-label">{tab.label}</span>
                  </button>

                  <span class="workspace-tab-close-slot">
                    <button
                      type="button"
                      class="workspace-tab-close-button"
                      aria-label={`Close ${tab.label}`}
                      title="Close"
                      on:click={() => closeRightPanelTab(tab.id)}
                    >
                      <span class="material-symbols-outlined" aria-hidden="true">close</span>
                    </button>
                  </span>
                </div>
              {/each}
            </div>

            <div
              class="right-panel-tab-panel"
              role="tabpanel"
              id="right-panel-tab-details"
              aria-labelledby="right-panel-tab-button-details"
              hidden={activeRightPanelTab !== 'details'}
            >
              <TrackDetailsPanel
                track={selectedItem}
                artwork={detailsArtwork}
                artworkBackgroundActive={hasArtworkBackdrop(zoneEffects.details) && Boolean(backdropArtwork)}
                {artworkBackgroundBright}
                visualizerBackdropActive={hasVisualizerBackdrop(zoneEffects.details)}
                fillParent={true}
                hideEyebrow={true}
              />
            </div>

            <div
              class="right-panel-tab-panel"
              role="tabpanel"
              id="right-panel-tab-lyrics"
              aria-labelledby="right-panel-tab-button-lyrics"
              hidden={activeRightPanelTab !== 'lyrics'}
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
                forceAutoScroll={activeRightPanelTab === 'lyrics'}
                fillParent={true}
                hideEyebrow={true}
                on:seek
              />
            </div>
          </div>
        {:else if isDetailsVisible}
          <TrackDetailsPanel
            track={selectedItem}
            artwork={detailsArtwork}
            artworkBackgroundActive={hasArtworkBackdrop(zoneEffects.details) && Boolean(backdropArtwork)}
            {artworkBackgroundBright}
            visualizerBackdropActive={hasVisualizerBackdrop(zoneEffects.details)}
            fillParent={true}
            showCloseButton={true}
            onClose={onCloseDetails}
          />
        {:else}
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
            fillParent={true}
            showCloseButton={true}
            onClose={onCloseLyrics}
            on:seek
          />
        {/if}
      </BackdropZone>
    </div>
  {/if}
</main>
