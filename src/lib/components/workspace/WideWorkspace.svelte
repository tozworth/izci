<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import PlaylistPanel from '$lib/components/PlaylistPanel.svelte';
  import TrackDetailsPanel from '$lib/components/TrackDetailsPanel.svelte';
  import type { PlaylistItem, WorkspacePanelId } from '$lib/types';
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
  export let resizerWidth = 14;
  export let isResizing = false;
  export let selectedItem: PlaylistItem | null = null;
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
      <TrackDetailsPanel
        track={selectedItem}
        fillParent={true}
        showCloseButton={true}
        onClose={onCloseDetails}
      />
    </div>
  {/if}
</main>
