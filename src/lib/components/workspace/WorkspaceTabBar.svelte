<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import DockableTabStrip from '$lib/components/DockableTabStrip.svelte';
  import type { DockTabMoveDetail } from '$lib/components/docking/types';
  import type { WorkspacePanelId, WorkspaceTab } from '$lib/types';
  import type {
    WorkspaceTabDefinition,
    WorkspaceTabDragDetail,
    WorkspaceTabMoveDetail
  } from './types';
  import { WORKSPACE_DOCK_SCOPE } from './types';

  export let tabs: WorkspaceTabDefinition[] = [];
  export let activeTab: WorkspaceTab | null = null;
  export let panelId: WorkspacePanelId | null = null;
  export let ariaLabel = 'Workspace tabs';
  export let className = '';
  export let closeable = true;
  export let dragEnabled = true;

  const dispatch = createEventDispatcher<{
    tabChange: WorkspaceTab;
    tabClose: WorkspaceTab;
    tabDragStart: WorkspaceTabDragDetail;
    tabDragEnd: void;
    tabMove: WorkspaceTabMoveDetail;
  }>();

  function getTabLabel(tab: WorkspaceTabDefinition): string {
    switch (tab.id) {
      case 'playlist': return $t('workspace.tabs.playlist', { default: 'Playlist' });
      case 'library': return $t('workspace.tabs.library', { default: 'Library' });
      case 'details': return $t('workspace.tabs.details', { default: 'Details' });
      case 'lyrics': return $t('workspace.tabs.lyrics', { default: 'Lyrics' });
      case 'patterns': return $t('workspace.tabs.patterns', { default: 'Patterns' });
      case 'video': return $t('workspace.tabs.video', { default: 'Video' });
      default: return tab.label;
    }
  }

  function handleTabMove(detail: DockTabMoveDetail): void {
    dispatch('tabMove', {
      tabId: detail.tabId as WorkspaceTab,
      sourcePanelId: detail.sourceZoneId as WorkspacePanelId | undefined,
      targetPanelId: detail.targetZoneId as WorkspacePanelId | undefined,
      targetTabId: detail.targetTabId as WorkspaceTab | undefined,
      position: detail.position
    });
  }

  $: localizedTabs = tabs.map((tab) => ({ ...tab, label: getTabLabel(tab) }));
  $: localizedAriaLabel = ariaLabel === 'Workspace tabs'
    ? $t('workspace.tabs.label', { default: 'Workspace tabs' })
    : ariaLabel;
</script>

<DockableTabStrip
  tabs={localizedTabs}
  activeTab={activeTab}
  zoneId={panelId}
  dragScope={WORKSPACE_DOCK_SCOPE}
  ariaLabel={localizedAriaLabel}
  className={`workspace-tabs ${className}`.trim()}
  {closeable}
  {dragEnabled}
  closeLabel={$t('workspace.tabs.close', { default: 'Close' })}
  closeNamedLabel={(label) => $t('workspace.tabs.closeNamed', { default: 'Close {tab}', values: { tab: label } })}
  idPrefix="workspace-tab"
  on:tabChange={(event) => dispatch('tabChange', event.detail as WorkspaceTab)}
  on:tabClose={(event) => dispatch('tabClose', event.detail as WorkspaceTab)}
  on:tabMove={(event) => handleTabMove(event.detail)}
  on:tabDragStart={(event) => dispatch('tabDragStart', {
    tabId: event.detail.tabId as WorkspaceTab,
    sourcePanelId: event.detail.sourceZoneId as WorkspacePanelId | undefined
  })}
  on:tabDragEnd={() => dispatch('tabDragEnd')}
/>
