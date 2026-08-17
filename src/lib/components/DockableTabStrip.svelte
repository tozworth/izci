<script lang="ts">
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import HoverTooltip from './HoverTooltip.svelte';
  import TabStrip from './TabStrip.svelte';
  import { hasDockTabDragData, readDockTabDragData, writeDockTabDragData } from './docking/drag';
  import type { DockTabDefinition, DockTabDragDetail, DockTabMoveDetail } from './docking/types';

  export let tabs: DockTabDefinition[] = [];
  export let activeTab: string | null = null;
  export let zoneId: string | null = null;
  export let dragScope: string;
  export let ariaLabel: string;
  export let className = '';
  export let closeable = false;
  export let dragEnabled = true;
  export let compactWhenNarrow = true;
  export let closeLabel = 'Close';
  export let closeNamedLabel: (label: string) => string = (label) => `Close ${label}`;
  export let idPrefix = 'dock-tab';

  const dispatch = createEventDispatcher<{
    tabChange: string;
    tabClose: string;
    tabDragStart: DockTabDragDetail;
    tabDragEnd: void;
    tabMove: DockTabMoveDetail;
  }>();

  let dropIndicator: { tabId: string; position: 'before' | 'after' } | null = null;
  let tabBarElement: HTMLDivElement | null = null;
  let tabMeasurementElement: HTMLDivElement;
  let isIconOnly = false;
  let resizeObserver: ResizeObserver | null = null;
  let compactUpdateScheduled = false;
  let measurementSignature = '';

  function getMeasurementSignature(): string {
    return `${closeable ? 'closeable' : 'fixed'}:${tabs
      .map((tab) => `${tab.id}:${tab.icon}:${tab.label}:${tab.closeable !== false ? 'closeable' : 'fixed'}`)
      .join('|')}`;
  }

  function updateCompactMode(): void {
    if (!compactWhenNarrow || !tabBarElement || !tabMeasurementElement) {
      isIconOnly = false;
      return;
    }

    const availableWidth = tabBarElement.clientWidth;
    const requiredWidth = Math.ceil(tabMeasurementElement.scrollWidth);
    isIconOnly = availableWidth > 0 && requiredWidth > availableWidth;
  }

  function scheduleCompactUpdate(): void {
    if (compactUpdateScheduled) {
      return;
    }

    compactUpdateScheduled = true;
    void tick().then(() => {
      compactUpdateScheduled = false;
      updateCompactMode();
    });
  }

  function getDropPosition(event: DragEvent, element: HTMLElement): 'before' | 'after' {
    const rect = element.getBoundingClientRect();
    return event.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
  }

  function getMoveDetail(
    event: DragEvent,
    targetTabId: string | undefined,
    position: DockTabMoveDetail['position']
  ): DockTabMoveDetail | null {
    const dragData = readDockTabDragData(event.dataTransfer, dragScope);

    return dragData
      ? {
          ...dragData,
          targetZoneId: zoneId ?? undefined,
          targetTabId,
          position
        }
      : null;
  }

  function handleDragStart(event: DragEvent, tab: DockTabDefinition): void {
    if (!dragEnabled || !event.dataTransfer) {
      event.preventDefault();
      return;
    }

    const detail: DockTabDragDetail = {
      tabId: tab.id,
      sourceZoneId: zoneId ?? undefined
    };

    writeDockTabDragData(event.dataTransfer, dragScope, detail);
    dispatch('tabDragStart', detail);
  }

  function handleDragEnd(): void {
    dropIndicator = null;
    dispatch('tabDragEnd');
  }

  function handleTabDragOver(event: DragEvent, tabId: string): void {
    if (!hasDockTabDragData(event.dataTransfer, dragScope)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }

    if (event.currentTarget instanceof HTMLElement) {
      dropIndicator = {
        tabId,
        position: getDropPosition(event, event.currentTarget)
      };
    }
  }

  function handleTabDrop(event: DragEvent, tabId: string): void {
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

  function handleBarDragOver(event: DragEvent): void {
    if (!hasDockTabDragData(event.dataTransfer, dragScope)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    dropIndicator = null;
  }

  function handleBarDrop(event: DragEvent): void {
    const detail = getMoveDetail(event, undefined, 'end');

    if (!detail) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dropIndicator = null;
    dispatch('tabMove', detail);
  }

  function handleBarDragLeave(event: DragEvent): void {
    if (
      event.currentTarget instanceof HTMLElement &&
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }

    dropIndicator = null;
  }

  function isTabCloseable(tab: DockTabDefinition): boolean {
    return closeable && tab.closeable !== false;
  }

  function handleTabCloseClick(event: MouseEvent, tab: DockTabDefinition): void {
    event.stopPropagation();
    if (isTabCloseable(tab)) {
      dispatch('tabClose', tab.id);
    }
  }

  function handleTabAuxClick(event: MouseEvent, tab: DockTabDefinition): void {
    if (event.button !== 1 || !isTabCloseable(tab)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dispatch('tabClose', tab.id);
  }

  function handleTabMouseDown(event: MouseEvent, tab: DockTabDefinition): void {
    if (event.button === 1 && isTabCloseable(tab)) {
      event.preventDefault();
    }
  }

  onMount(() => {
    resizeObserver = new ResizeObserver(scheduleCompactUpdate);

    if (tabBarElement) resizeObserver.observe(tabBarElement);
    if (tabMeasurementElement) resizeObserver.observe(tabMeasurementElement);
    scheduleCompactUpdate();

    return () => {
      resizeObserver?.disconnect();
      resizeObserver = null;
    };
  });

  $: {
    const nextSignature = getMeasurementSignature();

    if (nextSignature !== measurementSignature) {
      measurementSignature = nextSignature;
      scheduleCompactUpdate();
    }
  }
</script>

<TabStrip
  className={`dockable-tabs ${className} ${isIconOnly ? 'is-icon-only' : ''}`.trim()}
  bind:element={tabBarElement}
  {ariaLabel}
  flushStart
  tabIndex={-1}
  on:dragover={handleBarDragOver}
  on:drop={handleBarDrop}
  on:dragleave={handleBarDragLeave}
>
  {#each tabs as tab (tab.id)}
    <div
      class="dock-tab-shell"
      class:has-close={isTabCloseable(tab)}
      class:drop-before={dropIndicator?.tabId === tab.id && dropIndicator.position === 'before'}
      class:drop-after={dropIndicator?.tabId === tab.id && dropIndicator.position === 'after'}
      role="presentation"
      draggable={dragEnabled}
      on:dragstart={(event) => handleDragStart(event, tab)}
      on:dragend={handleDragEnd}
      on:dragover={(event) => handleTabDragOver(event, tab.id)}
      on:drop={(event) => handleTabDrop(event, tab.id)}
    >
      <button
        type="button"
        class="tab-strip-tab dock-tab"
        class:active={activeTab === tab.id}
        role="tab"
        aria-label={tab.label}
        aria-selected={activeTab === tab.id}
        aria-controls={`${idPrefix}-panel-${zoneId ?? 'tabs'}-${tab.id}`}
        id={`${idPrefix}-${zoneId ?? 'tabs'}-${tab.id}`}
        draggable="false"
        disabled={tab.disabled}
        on:click={() => !tab.disabled && dispatch('tabChange', tab.id)}
        on:auxclick={(event) => handleTabAuxClick(event, tab)}
        on:mousedown={(event) => handleTabMouseDown(event, tab)}
      >
        <span class="material-symbols-outlined" aria-hidden="true">{tab.icon}</span>
        <span class="dock-tab-label">{tab.label}</span>
        {#if isIconOnly}
          <HoverTooltip align="center" nowrap>{tab.label}</HoverTooltip>
        {/if}
      </button>

      {#if isTabCloseable(tab)}
        <span class="dock-tab-close-slot">
          <button
            type="button"
            class="dock-tab-close-button"
            aria-label={closeNamedLabel(tab.label)}
            title={closeLabel}
            draggable="false"
            on:click={(event) => handleTabCloseClick(event, tab)}
            on:auxclick={(event) => handleTabAuxClick(event, tab)}
            on:mousedown={(event) => handleTabMouseDown(event, tab)}
          >
            <span class="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </span>
      {/if}
    </div>
  {/each}

  <div class="dock-tabs-measure" aria-hidden="true" bind:this={tabMeasurementElement}>
    {#each tabs as tab (tab.id)}
      <div class="dock-tab-shell" class:has-close={isTabCloseable(tab)}>
        <span class="tab-strip-tab dock-tab">
          <span class="material-symbols-outlined" aria-hidden="true">{tab.icon}</span>
          <span class="dock-tab-label">{tab.label}</span>
        </span>
        {#if isTabCloseable(tab)}
          <span class="dock-tab-close-slot"><span class="dock-tab-close-button"><span class="material-symbols-outlined" aria-hidden="true">close</span></span></span>
        {/if}
      </div>
    {/each}
  </div>
</TabStrip>

<style>
  .dock-tab-shell {
    position: relative;
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    min-width: 0;
  }

  .dock-tab-shell[draggable='true'] { cursor: grab; }
  .dock-tab-shell[draggable='true']:active { cursor: grabbing; }
  .dock-tab-shell.has-close .dock-tab { padding-right: 1.4rem; }

  .dock-tab-shell.drop-before::before,
  .dock-tab-shell.drop-after::after {
    content: "";
    position: absolute;
    top: 0.35rem;
    bottom: 0.3rem;
    z-index: 4;
    width: 2px;
    border-radius: 999px;
    background: var(--accent-strong);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-strong) 20%, transparent);
  }

  .dock-tab-shell.drop-before::before { left: -1px; }
  .dock-tab-shell.drop-after::after { right: -1px; }

  .dock-tab {
    flex: 0 1 auto;
  }

  .dock-tab > .material-symbols-outlined { font-size: 0.92rem; }

  .dock-tab-label {
    min-width: 0;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.dockable-tabs.is-icon-only) > .dock-tab-shell .dock-tab {
    justify-content: center;
    gap: 0;
    padding-inline: 0.42rem;
  }

  :global(.dockable-tabs.is-icon-only) > .dock-tab-shell.has-close .dock-tab { padding-right: 1.55rem; }
  :global(.dockable-tabs.is-icon-only) > .dock-tab-shell .dock-tab-label { display: none; }

  .dock-tabs-measure {
    position: absolute;
    top: 0;
    left: 0;
    z-index: -1;
    display: flex;
    align-items: center;
    gap: inherit;
    width: max-content;
    max-width: none;
    height: 0;
    overflow: visible;
    visibility: hidden;
    pointer-events: none;
  }

  .dock-tab-close-slot {
    position: absolute;
    top: 50%;
    right: 0.35rem;
    z-index: 3;
    transform: translateY(-50%);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    pointer-events: none;
  }

  .dock-tab-close-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1rem;
    height: 1rem;
    padding: 0;
    color: var(--workspace-tab-text, var(--tab-strip-text, var(--text)));
    background: transparent;
    border: 0;
    border-radius: 0.24rem;
    opacity: 0;
    pointer-events: none;
  }

  .dock-tab-shell:hover .dock-tab-close-button,
  .dock-tab-shell:focus-within .dock-tab-close-button {
    opacity: 1;
    pointer-events: auto;
  }

  .dock-tab-close-button:hover { background: var(--hover-surface); }
  .dock-tab-close-button > .material-symbols-outlined { font-size: 0.82rem; }
</style>
