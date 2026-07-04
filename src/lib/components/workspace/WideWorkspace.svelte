<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import BackdropZone from '$lib/components/BackdropZone.svelte';
  import PlaylistPanel from '$lib/components/PlaylistPanel.svelte';
  import TrackDetailsPanel from '$lib/components/TrackDetailsPanel.svelte';
  import type { LoadedStreamArtwork } from '$lib/services/stream-artwork';
  import { hasArtworkBackdrop, hasVisualizerBackdrop } from '$lib/stores/appearance-settings';
  import type { BackdropZoneEffect, PlaylistItem, WorkspacePanelId } from '$lib/types';
  import WorkspaceResizer from '$lib/components/workspace/WorkspaceResizer.svelte';
  import type {
    WideWorkspaceResizeStartDetail,
    WorkspacePanelHandlers,
    WorkspacePanelProps
  } from './types';

  export let playlistPanelProps: WorkspacePanelProps;
  export let playlistPanelHandlers: WorkspacePanelHandlers;
  export let libraryPanelProps: WorkspacePanelProps;
  export let libraryPanelHandlers: WorkspacePanelHandlers;
  export let panelWidths: Record<WorkspacePanelId, number>;
  export let resizerWidth = 1;
  export let isResizing = false;
  export let selectedItem: PlaylistItem | null = null;
  export let detailsArtwork: LoadedStreamArtwork | null = null;
  export let backdropArtwork: LoadedStreamArtwork | null = null;
  export let artworkBackgroundBright = false;
  export let zoneEffects: Record<WorkspacePanelId, BackdropZoneEffect> = {
    playlist: 'none',
    library: 'none',
    details: 'none'
  };
  export let isDetailsVisible = false;
  export let onCloseDetails: () => void = () => {};

  const dispatch = createEventDispatcher<{
    resizeStart: WideWorkspaceResizeStartDetail;
  }>();
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

  {#if isDetailsVisible}
    <WorkspaceResizer
      label="Resize library and details panels"
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
      >
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
      </BackdropZone>
    </div>
  {/if}
</main>
