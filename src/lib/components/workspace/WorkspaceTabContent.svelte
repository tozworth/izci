<script lang="ts">
  import LyricsPanel from '$lib/components/LyricsPanel.svelte';
  import PatternViewer from '$lib/components/PatternViewer.svelte';
  import PlaylistPanel from '$lib/components/PlaylistPanel.svelte';
  import TrackDetailsPanel from '$lib/components/TrackDetailsPanel.svelte';
  import VideoStage from '$lib/components/workspace/VideoStage.svelte';
  import type { WorkspaceTab } from '$lib/contracts/workspace';
  import type { WorkspaceTabContentProps } from './types';

  export let tab: WorkspaceTab;
  export let content: WorkspaceTabContentProps;
  export let artworkBackgroundActive = false;
  export let artworkBackgroundBright = false;
  export let visualizerBackdropActive = false;
  export let isCompactWorkspace = false;
</script>

{#if tab === 'playlist'}
  <PlaylistPanel
    {...content.playlistPanelProps}
    fillParent={true}
    hideEyebrow={true}
    on:addFiles={(event) => content.playlistPanelHandlers.addFiles(event.detail)}
    on:addFolders={(event) => content.playlistPanelHandlers.addFolders?.(event.detail)}
    on:openFiles={content.playlistPanelHandlers.openFiles}
    on:select={content.playlistPanelHandlers.select}
    on:setSelection={(event) => content.playlistPanelHandlers.setSelection?.(event)}
    on:activate={content.playlistPanelHandlers.activate}
    on:contextAction={content.playlistPanelHandlers.contextAction}
    on:toggleShuffle={() => content.playlistPanelHandlers.toggleShuffle?.()}
    on:cycleRepeat={() => content.playlistPanelHandlers.cycleRepeat?.()}
  />
{:else if tab === 'library'}
  <PlaylistPanel
    {...content.libraryPanelProps}
    libraryMode={true}
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
  />
{:else}
  <div class="video-tab-stage">
    <VideoStage
      element={content.videoTheaterActive ? null : content.videoElement}
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
  </div>
{/if}

<style>
  .video-tab-stage {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: #000;
  }
</style>
