<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import BackdropZone from '$lib/components/BackdropZone.svelte';
  import type { LoadedStreamArtwork } from '$lib/services/stream-artwork';
  import { hasArtworkBackdrop, hasVisualizerBackdrop } from '$lib/stores/appearance-settings';
  import type {
    BackdropZoneEffect,
    BackdropZoneArtworkSettings,
    WorkspacePanelId,
    WorkspaceTab
  } from '$lib/types';
  import WorkspaceResizer from '$lib/components/workspace/WorkspaceResizer.svelte';
  import WorkspaceTabBar from '$lib/components/workspace/WorkspaceTabBar.svelte';
  import WorkspaceTabContent from '$lib/components/workspace/WorkspaceTabContent.svelte';
  import { hasWorkspaceTabDragData, readWorkspaceTabDragData } from './drag';
  import type {
    WideWorkspaceResizeStartDetail,
    WorkspacePanelDefinition,
    WorkspaceTabContentProps,
    WorkspaceTabMoveDetail
  } from './types';

  export let content: WorkspaceTabContentProps;
  export let workspacePanels: WorkspacePanelDefinition[] = [];
  export let panelWidths: Record<WorkspacePanelId, number>;
  export let resizerWidth = 1;
  export let isResizing = false;
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

  const dispatch = createEventDispatcher<{
    resizeStart: WideWorkspaceResizeStartDetail;
    seek: number;
    tabChange: WorkspaceTab;
    tabClose: WorkspaceTab;
    tabMove: WorkspaceTabMoveDetail;
  }>();

  const PANEL_LABELS: Record<WorkspacePanelId, string> = {
    left: 'Left',
    center: 'Center',
    right: 'Right'
  };

  let draggedTabId: WorkspaceTab | null = null;
  let dropTargetPanelId: WorkspacePanelId | null = null;

  $: visiblePanels = workspacePanels.filter((panel) => panel.isOpen);
  $: hiddenPanels = workspacePanels.filter((panel) => !panel.isOpen);

  function getPanelLabel(panelId: WorkspacePanelId): string {
    return `${PANEL_LABELS[panelId]} panel`;
  }

  function handlePanelDragOver(event: DragEvent, panelId: WorkspacePanelId) {
    if (!hasWorkspaceTabDragData(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    dropTargetPanelId = panelId;
  }

  function handlePanelDrop(event: DragEvent, panelId: WorkspacePanelId) {
    const dragData = readWorkspaceTabDragData(event.dataTransfer);

    if (!dragData) {
      return;
    }

    event.preventDefault();
    dropTargetPanelId = null;
    dispatch('tabMove', {
      ...dragData,
      targetPanelId: panelId,
      position: 'end'
    });
  }

  function handlePanelDragLeave(event: DragEvent, panelId: WorkspacePanelId) {
    const currentTarget = event.currentTarget;
    const relatedTarget = event.relatedTarget;

    if (
      currentTarget instanceof HTMLElement &&
      relatedTarget instanceof Node &&
      currentTarget.contains(relatedTarget)
    ) {
      return;
    }

    if (dropTargetPanelId === panelId) {
      dropTargetPanelId = null;
    }
  }

  function handleTabDragStart(tabId: WorkspaceTab) {
    draggedTabId = tabId;
  }

  function handleTabDragEnd() {
    draggedTabId = null;
    dropTargetPanelId = null;
  }
</script>

<main
  class="workspace workspace-resizable workspace-dock-layout"
  class:is-resizing={isResizing}
  class:is-dragging-tab={draggedTabId !== null}
>
  {#if visiblePanels.length > 0}
    {#each visiblePanels as panel, index (panel.id)}
      <div
        class="workspace-panel workspace-dock-panel"
        class:is-drop-target={dropTargetPanelId === panel.id}
        style={`flex: 0 0 ${panelWidths[panel.id]}px; width: ${panelWidths[panel.id]}px;`}
        role="group"
        aria-label={getPanelLabel(panel.id)}
        on:dragover={(event) => handlePanelDragOver(event, panel.id)}
        on:drop={(event) => handlePanelDrop(event, panel.id)}
        on:dragleave={(event) => handlePanelDragLeave(event, panel.id)}
      >
        <BackdropZone
          effect={zoneEffects[panel.id]}
          artwork={backdropArtwork}
          artworkSettings={zoneArtworkSettings[panel.id]}
          artworkBright={zoneArtworkBright[panel.id] || artworkBackgroundBright}
          fillParent={true}
          zoneId={panel.id}
        >
          <div class="workspace-dock-panel-content">
            <WorkspaceTabBar
              tabs={panel.tabs}
              activeTab={panel.activeTab}
              panelId={panel.id}
              ariaLabel={`${getPanelLabel(panel.id)} tabs`}
              className="dock-panel-tabs"
              on:tabChange={(event) => dispatch('tabChange', event.detail)}
              on:tabClose={(event) => dispatch('tabClose', event.detail)}
              on:tabMove={(event) => dispatch('tabMove', event.detail)}
              on:tabDragStart={(event) => handleTabDragStart(event.detail.tabId)}
              on:tabDragEnd={handleTabDragEnd}
            />

            {#if panel.activeTab}
              <div
                class="dock-panel-tab-panel"
                role="tabpanel"
                id={`workspace-tab-panel-${panel.id}-${panel.activeTab}`}
                aria-labelledby={`workspace-tab-${panel.id}-${panel.activeTab}`}
              >
                <WorkspaceTabContent
                  tab={panel.activeTab}
                  {content}
                  artworkBackgroundActive={hasArtworkBackdrop(zoneEffects[panel.id]) && Boolean(backdropArtwork)}
                  artworkBackgroundBright={zoneArtworkBright[panel.id] || artworkBackgroundBright}
                  visualizerBackdropActive={hasVisualizerBackdrop(zoneEffects[panel.id])}
                  on:seek
                />
              </div>
            {:else}
              <div
                class="workspace-empty-panel"
                aria-label={`${getPanelLabel(panel.id)} is empty`}
              ></div>
            {/if}
          </div>
        </BackdropZone>
      </div>

      {#if index < visiblePanels.length - 1}
        <WorkspaceResizer
          label={`Resize ${getPanelLabel(panel.id)} and ${getPanelLabel(visiblePanels[index + 1].id)}`}
          width={resizerWidth}
          onPointerDown={(event) =>
            dispatch('resizeStart', {
              event,
              handle: {
                before: panel.id,
                after: visiblePanels[index + 1].id
              }
            })}
        />
      {/if}
    {/each}
  {:else}
    <div class="workspace-empty-surface" aria-label="Workspace is empty"></div>
  {/if}

  {#if draggedTabId}
    {#each hiddenPanels as panel (panel.id)}
      <div
        class={`workspace-edge-drop-target workspace-edge-drop-target-${panel.id}`}
        class:is-drop-target={dropTargetPanelId === panel.id}
        role="group"
        aria-label={`Drop on ${getPanelLabel(panel.id)}`}
        on:dragover={(event) => handlePanelDragOver(event, panel.id)}
        on:drop={(event) => handlePanelDrop(event, panel.id)}
        on:dragleave={(event) => handlePanelDragLeave(event, panel.id)}
      ></div>
    {/each}
  {/if}
</main>
