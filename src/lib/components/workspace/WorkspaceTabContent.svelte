<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import LyricsPanel from '$lib/components/LyricsPanel.svelte';
  import PatternViewer from '$lib/components/PatternViewer.svelte';
  import TrackListPanel from '$lib/components/TrackListPanel.svelte';
  import UpNextPanel from '$lib/components/UpNextPanel.svelte';
  import TrackDetailsPanel from '$lib/components/TrackDetailsPanel.svelte';
  import ChatPanel from '$lib/components/ChatPanel.svelte';
  import ImageStage from '$lib/components/workspace/ImageStage.svelte';
  import VideoStage from '$lib/components/workspace/VideoStage.svelte';
  import VisualizerPanel from '$lib/components/workspace/VisualizerPanel.svelte';
  import type { VideoFitMode, WorkspaceTab } from '$lib/types';
  import type { WorkspaceTabContentProps } from './types';

  export let tab: WorkspaceTab;
  export let content: WorkspaceTabContentProps;
  export let mediaTheaterActive = content.videoTheaterActive;
  export let artworkBackgroundActive = false;
  export let artworkBackgroundBright = false;
  export let visualizerBackdropActive = false;
  export let isCompactWorkspace = false;
  export let librarySearchExpanded = false;

  const dispatch = createEventDispatcher<{
    toggleVideoTheater: void;
    setVideoFit: VideoFitMode;
  }>();
</script>

{#if tab === 'queue'}
  <div class="queue-tab-stack">
    <TrackListPanel
      {...content.queuePanelProps}
      items={content.queuePanelProps.items}
      fillParent={true}
      hideEyebrow={true}
      on:addFiles={(event) => content.queuePanelHandlers.addFiles(event.detail)}
      on:addFolders={(event) => content.queuePanelHandlers.addFolders?.(event.detail)}
      on:openFiles={content.queuePanelHandlers.openFiles}
      on:select={content.queuePanelHandlers.select}
      on:setSelection={(event) => content.queuePanelHandlers.setSelection?.(event)}
      on:activate={content.queuePanelHandlers.activate}
      on:contextAction={content.queuePanelHandlers.contextAction}
      on:toggleShuffle={() => content.queuePanelHandlers.toggleShuffle?.()}
      on:cycleRepeat={() => content.queuePanelHandlers.cycleRepeat?.()}
    />
    <UpNextPanel
      items={content.upNextPanelProps.items}
      playingId={content.upNextPanelProps.playingId}
      mobilePresentation={content.queuePanelProps.mobilePresentation ?? false}
      getContextMenuActions={content.upNextPanelProps.getContextMenuActions}
      on:activate={content.upNextPanelHandlers.activate}
      on:contextAction={content.upNextPanelHandlers.contextAction}
    />
  </div>
{:else if tab === 'library'}
  <TrackListPanel
    {...content.libraryPanelProps}
    items={content.libraryPanelProps.items}
    libraryMode={true}
    bind:searchInputExpanded={librarySearchExpanded}
    fillParent={true}
    hideEyebrow={true}
    on:addFiles={(event) => content.libraryPanelHandlers.addFiles(event.detail)}
    on:addFolders={(event) => content.libraryPanelHandlers.addFolders?.(event.detail)}
    on:openFiles={content.libraryPanelHandlers.openFiles}
    on:select={content.libraryPanelHandlers.select}
    on:setSelection={(event) => content.libraryPanelHandlers.setSelection?.(event)}
    on:activate={content.libraryPanelHandlers.activate}
    on:contextAction={content.libraryPanelHandlers.contextAction}
    on:libraryGroupRequestHandled={(event) => content.libraryPanelHandlers.libraryGroupRequestHandled?.(event)}
  />
{:else if tab === 'details'}
  <TrackDetailsPanel
    track={content.selectedItem}
    artwork={content.detailsArtwork}
    libraryTargets={content.detailsLibraryTargets}
    onNavigateToLibrary={content.navigateTrackDetailsToLibrary}
    {artworkBackgroundActive}
    {artworkBackgroundBright}
    {visualizerBackdropActive}
    {isCompactWorkspace}
    fillParent={true}
    hideEyebrow={true}
  />
{:else if tab === 'lyrics'}
  <LyricsPanel
    snapshotStore={content.snapshotStore}
    playbackSnapshot={content.playbackSnapshot}
    track={content.lyricsTrack}
    displayStyle={content.lyricsDisplayStyle}
    autoScroll={content.lyricsAutoScroll}
    fontSize={content.lyricsFontSize}
    theaterDowntimeDots={content.lyricsTheaterDowntimeDots}
    theaterDowntimeThresholdSeconds={content.lyricsTheaterDowntimeThresholdSeconds}
    theaterSmoothScroll={content.lyricsTheaterSmoothScroll}
    resumeAutoScrollToken={content.lyricsResumeAutoScrollToken}
    forceAutoScroll={true}
    {isCompactWorkspace}
    fillParent={true}
    hideEyebrow={true}
    on:seek
  />
{:else if tab === 'patterns'}
  <PatternViewer
    track={content.patternTrack}
    snapshot={content.modulePatternSnapshot}
    playbackSnapshot={content.playbackSnapshot}
    channelSnapshot={content.patternChannelControls.snapshot}
    on:toggleChannelMute={(event) => content.patternChannelControls.toggleMute(event.detail.trackId, event.detail.index)}
    on:toggleChannelSolo={(event) => content.patternChannelControls.toggleSolo(event.detail.trackId, event.detail.index)}
  />
{:else if tab === 'visualizer'}
  <VisualizerPanel artworkUrl={content.visualizerArtworkUrl} />
{:else if tab === 'chat'}
  <ChatPanel
    messages={content.chatMessages}
    motd={content.chatMotd}
    motdHostName={content.chatMotdHostName}
    sendMessage={content.sendChatMessage}
    sendNowPlaying={content.sendChatNowPlaying}
    nowPlayingTrack={content.chatNowPlayingTrack}
    activateTrack={content.activateChatTrack}
    connected={content.chatConnected}
  />
{:else if tab === 'media'}
  <div class="media-tab-stage" class:is-image={Boolean(content.imageElement) || content.playbackSnapshot?.backend === 'image'}>
    {#if content.imageElement}
      <ImageStage
        element={mediaTheaterActive ? null : content.imageElement}
        parkingHost={content.videoParkingHost}
        fitMode={content.videoFitMode}
        zoom={content.imageZoom}
        on:toggleTheater={() => dispatch('toggleVideoTheater')}
        on:setFit={(event) => dispatch('setVideoFit', event.detail)}
        on:zoomStep
        on:resetZoom
      />
    {:else if content.playbackSnapshot?.backend === 'image'}
      <!-- Themed placeholder while the image element decodes; avoids a black VideoStage flash. -->
      <ImageStage
        element={null}
        parkingHost={content.videoParkingHost}
        fitMode={content.videoFitMode}
        zoom={content.imageZoom}
        on:toggleTheater={() => dispatch('toggleVideoTheater')}
        on:setFit={(event) => dispatch('setVideoFit', event.detail)}
        on:zoomStep
        on:resetZoom
      />
    {:else}
      <VideoStage
        element={mediaTheaterActive ? null : content.videoElement}
        parkingHost={content.videoParkingHost}
        fitMode={content.videoFitMode}
        snapshot={content.playbackSnapshot}
        pictureInPictureSupported={content.videoPictureInPictureSupported}
        seekFeedback={content.videoSeekFeedback}
        on:volumeStep
        on:toggleVideoTheater
        on:togglePictureInPicture
        on:setVideoFit
      />
    {/if}
  </div>
{/if}

<style>
  .queue-tab-stack {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  .queue-tab-stack :global(.track-list-panel.fill-parent) {
    height: auto;
    flex: 1 1 0;
    min-height: 0;
  }

  .media-tab-stage {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: #000;
  }

  .media-tab-stage.is-image {
    background: var(--body-background);
  }
</style>
