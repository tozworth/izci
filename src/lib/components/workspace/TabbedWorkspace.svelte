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
  import WorkspaceTabBar from './WorkspaceTabBar.svelte';
  import WorkspaceTabContent from './WorkspaceTabContent.svelte';
  import type {
    WorkspaceTabContentProps,
    WorkspaceTabDefinition,
    WorkspaceTabMoveDetail
  } from './types';

  export let content: WorkspaceTabContentProps;
  export let activeWorkspaceTab: WorkspaceTab;
  export let workspaceTabs: WorkspaceTabDefinition[] = [];
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
    seek: number;
    tabChange: WorkspaceTab;
    tabClose: WorkspaceTab;
    tabMove: WorkspaceTabMoveDetail;
  }>();

  function getBackdropPanelId(tabId: WorkspaceTab): WorkspacePanelId {
    if (tabId === 'playlist') {
      return 'left';
    }

    if (tabId === 'library') {
      return 'center';
    }

    return 'right';
  }

  $: activeBackdropPanelId = getBackdropPanelId(activeWorkspaceTab);
</script>

<main class="workspace workspace-tabs-layout">
  <WorkspaceTabBar
    tabs={workspaceTabs}
    activeTab={activeWorkspaceTab}
    ariaLabel="Workspace sections"
    on:tabChange={(event) => dispatch('tabChange', event.detail)}
    on:tabClose={(event) => dispatch('tabClose', event.detail)}
    on:tabMove={(event) => dispatch('tabMove', event.detail)}
  />

  {#if workspaceTabs.length === 0}
    <div class="workspace-empty-surface" aria-label="Workspace is empty"></div>
  {:else}
    <div
      class="workspace-tab-panel"
      role="tabpanel"
      id={`workspace-tab-panel-tabs-${activeWorkspaceTab}`}
      aria-labelledby={`workspace-tab-tabs-${activeWorkspaceTab}`}
    >
      <BackdropZone
        effect={zoneEffects[activeBackdropPanelId]}
        artwork={backdropArtwork}
        artworkSettings={zoneArtworkSettings[activeBackdropPanelId]}
        artworkBright={zoneArtworkBright[activeBackdropPanelId] || artworkBackgroundBright}
        fillParent={true}
        zoneId={activeBackdropPanelId}
      >
        <WorkspaceTabContent
          tab={activeWorkspaceTab}
          {content}
          artworkBackgroundActive={hasArtworkBackdrop(zoneEffects[activeBackdropPanelId]) && Boolean(backdropArtwork)}
          artworkBackgroundBright={zoneArtworkBright[activeBackdropPanelId] || artworkBackgroundBright}
          visualizerBackdropActive={hasVisualizerBackdrop(zoneEffects[activeBackdropPanelId])}
          isTabbedLayout={true}
          on:seek
        />
      </BackdropZone>
    </div>
  {/if}
</main>
