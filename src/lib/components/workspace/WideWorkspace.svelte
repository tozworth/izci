<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
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
  export let isCompactWorkspace = false;
  export let inactive = false;
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
    volumeStep: number;
    toggleVideoTheater: void;
    tabChange: WorkspaceTab;
    tabClose: WorkspaceTab;
    tabMove: WorkspaceTabMoveDetail;
  }>();

  let draggedTabId: WorkspaceTab | null = null;
  let dropTargetPanelId: WorkspacePanelId | null = null;

  $: visiblePanels = workspacePanels.filter((panel) => panel.isOpen);
  $: hiddenPanels = workspacePanels.filter(
    (panel) => !panel.isOpen && !panel.isResponsiveCollapsed
  );
  function getPanelLabel(panelId: WorkspacePanelId): string {
    switch (panelId) {
      case 'left': return $t('workspace.panels.left', { default: 'Left panel' });
      case 'center': return $t('workspace.panels.center', { default: 'Center panel' });
      case 'right': return $t('workspace.panels.right', { default: 'Right panel' });
    }
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
  inert={inactive ? true : undefined}
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
        <div class="workspace-panel-surface">
          <BackdropZone
            effect={zoneEffects[panel.backdropPanelId]}
            artwork={backdropArtwork}
            artworkSettings={zoneArtworkSettings[panel.backdropPanelId]}
            artworkBright={zoneArtworkBright[panel.backdropPanelId] || artworkBackgroundBright}
            fillParent={true}
            zoneId={panel.backdropPanelId}
          >
            <div class="workspace-dock-panel-content">
            <WorkspaceTabBar
              tabs={panel.tabs}
              activeTab={panel.activeTab}
              panelId={panel.id}
              ariaLabel={$t('workspace.panelTabs', { default: '{panel} tabs', values: { panel: getPanelLabel(panel.id) } })}
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
                  artworkBackgroundActive={hasArtworkBackdrop(zoneEffects[panel.backdropPanelId]) && Boolean(backdropArtwork)}
                  artworkBackgroundBright={zoneArtworkBright[panel.backdropPanelId] || artworkBackgroundBright}
                  visualizerBackdropActive={hasVisualizerBackdrop(zoneEffects[panel.backdropPanelId])}
                  {isCompactWorkspace}
                  on:seek
                  on:volumeStep={(event) => dispatch('volumeStep', event.detail)}
                  on:toggleVideoTheater={() => dispatch('toggleVideoTheater')}
                />
              </div>
            {:else}
              <div
                class="workspace-empty-panel"
                aria-label={$t('workspace.panelEmpty', { default: '{panel} is empty', values: { panel: getPanelLabel(panel.id) } })}
              ></div>
            {/if}
            </div>
          </BackdropZone>
        </div>

      </div>

      {#if index < visiblePanels.length - 1}
        <WorkspaceResizer
          label={$t('workspace.resizePanels', {
            default: 'Resize {before} and {after}',
            values: { before: getPanelLabel(panel.id), after: getPanelLabel(visiblePanels[index + 1].id) }
          })}
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
    <div class="workspace-empty-surface" aria-label={$t('workspace.empty', { default: 'Workspace is empty' })}></div>
  {/if}

  {#if draggedTabId}
    {#each hiddenPanels as panel (panel.id)}
      <div
        class={`workspace-edge-drop-target workspace-edge-drop-target-${panel.id}`}
        class:is-drop-target={dropTargetPanelId === panel.id}
        role="group"
        aria-label={$t('workspace.dropOnPanel', { default: 'Drop on {panel}', values: { panel: getPanelLabel(panel.id) } })}
        on:dragover={(event) => handlePanelDragOver(event, panel.id)}
        on:drop={(event) => handlePanelDrop(event, panel.id)}
        on:dragleave={(event) => handlePanelDragLeave(event, panel.id)}
      ></div>
    {/each}
  {/if}
</main>

<style>
  .workspace-panel-surface {
    min-width: 0;
    min-height: 0;
    width: 100%;
    height: 100%;
  }

</style>
