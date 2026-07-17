<script lang="ts">
  import LyricsPanel from '$lib/components/LyricsPanel.svelte';
  import PatternViewer from '$lib/components/PatternViewer.svelte';
  import PlaylistPanel from '$lib/components/PlaylistPanel.svelte';
  import TrackDetailsPanel from '$lib/components/TrackDetailsPanel.svelte';
  import type { WorkspaceTab } from '$lib/types';
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
  />
{:else if tab === 'details'}
  <TrackDetailsPanel
    track={content.selectedItem}
    artwork={content.detailsArtwork}
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
{:else}
  <PatternViewer
    track={content.patternTrack}
    snapshot={content.modulePatternSnapshot}
    playbackSnapshot={content.playbackSnapshot}
  />
{/if}
