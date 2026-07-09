<script lang="ts">
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import type { WorkspacePanelId, WorkspaceTab } from '$lib/types';
  import type {
    WorkspaceTabDefinition,
    WorkspaceTabDragDetail,
    WorkspaceTabMoveDetail
  } from './types';
  import {
    hasWorkspaceTabDragData,
    readWorkspaceTabDragData,
    writeWorkspaceTabDragData
  } from './drag';

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

  let dropIndicator: { tabId: WorkspaceTab; position: 'before' | 'after' } | null = null;
  let tabBarElement: HTMLDivElement;
  let tabMeasurementElement: HTMLDivElement;
  let isIconOnly = false;
  let resizeObserver: ResizeObserver | null = null;
  let iconOnlyUpdateScheduled = false;
  let tabMeasurementSignature = '';

  function getMeasurementSignature(): string {
    return `${closeable ? 'closeable' : 'fixed'}:${tabs
      .map((tab) => `${tab.id}:${tab.icon}:${tab.label}`)
      .join('|')}`;
  }

  function updateIconOnly() {
    if (!tabBarElement || !tabMeasurementElement) {
      return;
    }

    const availableWidth = tabBarElement.clientWidth;
    const requiredWidth = Math.ceil(tabMeasurementElement.scrollWidth);
    isIconOnly = availableWidth > 0 && requiredWidth > availableWidth;
  }

  function scheduleIconOnlyUpdate() {
    if (iconOnlyUpdateScheduled) {
      return;
    }

    iconOnlyUpdateScheduled = true;
    void tick().then(() => {
      iconOnlyUpdateScheduled = false;
      updateIconOnly();
    });
  }

  function getDropPosition(event: DragEvent, element: HTMLElement): 'before' | 'after' {
    const rect = element.getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
  }

  function getMoveDetail(
    event: DragEvent,
    targetTabId: WorkspaceTab | undefined,
    position: WorkspaceTabMoveDetail['position']
  ): WorkspaceTabMoveDetail | null {
    const dragData = readWorkspaceTabDragData(event.dataTransfer);

    if (!dragData) {
      return null;
    }

    return {
      ...dragData,
      targetPanelId: panelId ?? undefined,
      targetTabId,
      position
    };
  }

  function handleDragStart(event: DragEvent, tabId: WorkspaceTab) {
    if (!dragEnabled || !event.dataTransfer) {
      event.preventDefault();
      return;
    }

    const detail = {
      tabId,
      sourcePanelId: panelId ?? undefined
    };

    writeWorkspaceTabDragData(event.dataTransfer, detail);
    dispatch('tabDragStart', detail);
  }

  function handleDragEnd() {
    dropIndicator = null;
    dispatch('tabDragEnd');
  }

  function handleTabDragOver(event: DragEvent, tabId: WorkspaceTab) {
    if (!hasWorkspaceTabDragData(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    const currentTarget = event.currentTarget;

    if (currentTarget instanceof HTMLElement) {
      dropIndicator = {
        tabId,
        position: getDropPosition(event, currentTarget)
      };
    }
  }

  function handleTabDrop(event: DragEvent, tabId: WorkspaceTab) {
    const position = dropIndicator?.tabId === tabId ? dropIndicator.position : 'after';
    const detail = getMoveDetail(event, tabId, position);

    if (!detail) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dropIndicator = null;
    dispatch('tabMove', detail);
  }

  function handleBarDragOver(event: DragEvent) {
    if (!hasWorkspaceTabDragData(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    dropIndicator = null;
  }

  function handleBarDrop(event: DragEvent) {
    const detail = getMoveDetail(event, undefined, 'end');

    if (!detail) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dropIndicator = null;
    dispatch('tabMove', detail);
  }

  function handleBarDragLeave(event: DragEvent) {
    const currentTarget = event.currentTarget;
    const relatedTarget = event.relatedTarget;

    if (
      currentTarget instanceof HTMLElement &&
      relatedTarget instanceof Node &&
      currentTarget.contains(relatedTarget)
    ) {
      return;
    }

    dropIndicator = null;
  }

  function closeTab(tabId: WorkspaceTab) {
    if (closeable) {
      dispatch('tabClose', tabId);
    }
  }

  function handleTabCloseClick(event: MouseEvent, tabId: WorkspaceTab) {
    event.stopPropagation();
    closeTab(tabId);
  }

  function handleTabAuxClick(event: MouseEvent, tabId: WorkspaceTab) {
    if (event.button !== 1 || !closeable) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    closeTab(tabId);
  }

  function handleTabMouseDown(event: MouseEvent) {
    if (event.button !== 1 || !closeable) {
      return;
    }

    event.preventDefault();
  }

  onMount(() => {
    resizeObserver = new ResizeObserver(scheduleIconOnlyUpdate);

    if (tabBarElement) {
      resizeObserver.observe(tabBarElement);
    }

    if (tabMeasurementElement) {
      resizeObserver.observe(tabMeasurementElement);
    }

    scheduleIconOnlyUpdate();

    return () => {
      resizeObserver?.disconnect();
      resizeObserver = null;
    };
  });

  $: {
    const nextMeasurementSignature = getMeasurementSignature();

    if (nextMeasurementSignature !== tabMeasurementSignature) {
      tabMeasurementSignature = nextMeasurementSignature;
      scheduleIconOnlyUpdate();
    }
  }
</script>

<div
  class={`workspace-tabs ${className}`.trim()}
  class:is-icon-only={isIconOnly}
  bind:this={tabBarElement}
  role="tablist"
  aria-label={ariaLabel}
  tabindex="-1"
  on:dragover={handleBarDragOver}
  on:drop={handleBarDrop}
  on:dragleave={handleBarDragLeave}
>
  {#each tabs as tab}
    <div
      class="workspace-tab-shell"
      class:has-close={closeable}
      class:drop-before={dropIndicator?.tabId === tab.id && dropIndicator.position === 'before'}
      class:drop-after={dropIndicator?.tabId === tab.id && dropIndicator.position === 'after'}
      role="presentation"
      draggable={dragEnabled}
      on:dragstart={(event) => handleDragStart(event, tab.id)}
      on:dragend={handleDragEnd}
      on:dragover={(event) => handleTabDragOver(event, tab.id)}
      on:drop={(event) => handleTabDrop(event, tab.id)}
    >
      <button
        type="button"
        class:active={activeTab === tab.id}
        class="workspace-tab"
        role="tab"
        aria-label={tab.label}
        aria-selected={activeTab === tab.id}
        aria-controls={`workspace-tab-panel-${panelId ?? 'tabs'}-${tab.id}`}
        id={`workspace-tab-${panelId ?? 'tabs'}-${tab.id}`}
        draggable="false"
        title={tab.label}
        on:click={() => dispatch('tabChange', tab.id)}
        on:auxclick={(event) => handleTabAuxClick(event, tab.id)}
        on:mousedown={handleTabMouseDown}
      >
        <span class="material-symbols-outlined" aria-hidden="true">{tab.icon}</span>
        <span class="workspace-tab-label">{tab.label}</span>
      </button>

      {#if closeable}
        <span class="workspace-tab-close-slot">
          <button
            type="button"
            class="workspace-tab-close-button"
            aria-label={`Close ${tab.label}`}
            title="Close"
            draggable="false"
            on:click={(event) => handleTabCloseClick(event, tab.id)}
            on:auxclick={(event) => handleTabAuxClick(event, tab.id)}
            on:mousedown={handleTabMouseDown}
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </span>
      {/if}
    </div>
  {/each}

  <div class="workspace-tabs-measure" aria-hidden="true" bind:this={tabMeasurementElement}>
    {#each tabs as tab}
      <div class="workspace-tab-shell" class:has-close={closeable}>
        <span class="workspace-tab">
          <span class="material-symbols-outlined" aria-hidden="true">{tab.icon}</span>
          <span class="workspace-tab-label">{tab.label}</span>
        </span>

        {#if closeable}
          <span class="workspace-tab-close-slot">
            <span class="workspace-tab-close-button">
              <span class="material-symbols-outlined" aria-hidden="true">close</span>
            </span>
          </span>
        {/if}
      </div>
    {/each}
  </div>
</div>
