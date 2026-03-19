<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import PlaylistPanel from '$lib/components/PlaylistPanel.svelte';
  import TrackDetailsPanel from '$lib/components/TrackDetailsPanel.svelte';
  import type { PlaylistItem, WorkspaceTab } from '$lib/types';
  import type {
    WorkspacePanelHandlers,
    WorkspacePanelProps,
    WorkspaceTabDefinition
  } from './types';

  export let activeWorkspaceTab: WorkspaceTab;
  export let workspaceTabs: WorkspaceTabDefinition[] = [];
  export let playlistPanelProps: WorkspacePanelProps;
  export let playlistPanelHandlers: WorkspacePanelHandlers;
  export let libraryPanelProps: WorkspacePanelProps;
  export let libraryPanelHandlers: WorkspacePanelHandlers;
  export let selectedItem: PlaylistItem | null = null;

  const dispatch = createEventDispatcher<{
    tabChange: WorkspaceTab;
  }>();
</script>

<main class="workspace workspace-tabs-layout">
  <div class="workspace-tabs" role="tablist" aria-label="Workspace sections">
    {#each workspaceTabs as tab}
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
      >
        <span class="material-symbols-outlined" aria-hidden="true">{tab.icon}</span>
        <span class="workspace-tab-label">{tab.label}</span>
      </button>
    {/each}
  </div>

  <div
    class="workspace-tab-panel"
    role="tabpanel"
    id="workspace-tab-panel-playlist"
    aria-labelledby="workspace-tab-playlist"
    hidden={activeWorkspaceTab !== 'playlist'}
  >
    <PlaylistPanel
      {...playlistPanelProps}
      hideEyebrow={true}
      on:addFiles={(event) => playlistPanelHandlers.addFiles(event.detail)}
      on:openFiles={playlistPanelHandlers.openFiles}
      on:select={playlistPanelHandlers.select}
      on:activate={playlistPanelHandlers.activate}
      on:contextAction={playlistPanelHandlers.contextAction}
      on:toggleShuffle={() => playlistPanelHandlers.toggleShuffle?.()}
      on:cycleRepeat={() => playlistPanelHandlers.cycleRepeat?.()}
    />
  </div>

  <div
    class="workspace-tab-panel"
    role="tabpanel"
    id="workspace-tab-panel-library"
    aria-labelledby="workspace-tab-library"
    hidden={activeWorkspaceTab !== 'library'}
  >
    <PlaylistPanel
      {...libraryPanelProps}
      hideEyebrow={true}
      on:addFiles={(event) => libraryPanelHandlers.addFiles(event.detail)}
      on:openFiles={libraryPanelHandlers.openFiles}
      on:select={libraryPanelHandlers.select}
      on:setSelection={(event) => libraryPanelHandlers.setSelection?.(event)}
      on:activate={libraryPanelHandlers.activate}
      on:contextAction={libraryPanelHandlers.contextAction}
    />
  </div>

  <div
    class="workspace-tab-panel"
    role="tabpanel"
    id="workspace-tab-panel-details"
    aria-labelledby="workspace-tab-details"
    hidden={activeWorkspaceTab !== 'details'}
  >
    <TrackDetailsPanel track={selectedItem} hideEyebrow={true} isTabbedLayout={true} />
  </div>
</main>
