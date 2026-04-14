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
  export let isDetailsVisible = false;
  export let onCloseDetails: () => void = () => {};

  const dispatch = createEventDispatcher<{
    tabChange: WorkspaceTab;
  }>();

  function handleDetailsCloseClick(event: MouseEvent) {
    event.stopPropagation();
    onCloseDetails();
  }

  function handleTabAuxClick(event: MouseEvent, tabId: WorkspaceTab) {
    if (event.button !== 1 || tabId !== 'details') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onCloseDetails();
  }

  function handleTabMouseDown(event: MouseEvent, tabId: WorkspaceTab) {
    if (event.button !== 1 || tabId !== 'details') {
      return;
    }

    event.preventDefault();
  }
</script>

<main class="workspace workspace-tabs-layout">
  <div class="workspace-tabs" role="tablist" aria-label="Workspace sections">
    {#each workspaceTabs as tab}
      <div class="workspace-tab-shell" class:has-close={tab.id === 'details'}>
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

        {#if tab.id === 'details'}
          <span class="workspace-tab-close-slot">
            <button
              type="button"
              class="workspace-tab-close-button"
              aria-label="Close Track Details"
              title="Close"
              on:click={handleDetailsCloseClick}
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

  {#if isDetailsVisible}
    <div
      class="workspace-tab-panel"
      role="tabpanel"
      id="workspace-tab-panel-details"
      aria-labelledby="workspace-tab-details"
      hidden={activeWorkspaceTab !== 'details'}
    >
      <TrackDetailsPanel
        track={selectedItem}
        hideEyebrow={true}
        isTabbedLayout={true}
      />
    </div>
  {/if}
</main>
