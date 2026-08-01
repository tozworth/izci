<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { hasDockTabDragData, readDockTabDragData } from '$lib/components/docking/drag';
  import type { DockTabMoveDetail } from '$lib/components/docking/types';
  import {
    TROUBADOUR_DOCK_SCOPE,
    type TroubadourDockRegionId,
    type TroubadourDockZoneId
  } from '$lib/stores/troubadour-workspace';
  import type { TroubadourDockGuide } from './troubadour-dock';

  export let visible = false;
  export let ariaLabel: string;
  export let guides: TroubadourDockGuide[] = [];

  const dispatch = createEventDispatcher<{ tabMove: DockTabMoveDetail }>();
  let hoveredGuide: TroubadourDockRegionId | null = null;
  let hoveredZone: TroubadourDockZoneId | null = null;

  function getClosestZone(event: DragEvent, guide: TroubadourDockGuide): TroubadourDockZoneId {
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const useFirst = guide.split === 'horizontal'
      ? event.clientX < bounds.left + bounds.width / 2
      : event.clientY < bounds.top + bounds.height / 2;
    return guide.zones[useFirst ? 0 : 1];
  }

  function handleDragOver(event: DragEvent, guide: TroubadourDockGuide): void {
    if (!hasDockTabDragData(event.dataTransfer, TROUBADOUR_DOCK_SCOPE)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    hoveredGuide = guide.id;
    hoveredZone = getClosestZone(event, guide);
  }

  function handleDrop(event: DragEvent, guide: TroubadourDockGuide): void {
    const dragData = readDockTabDragData(event.dataTransfer, TROUBADOUR_DOCK_SCOPE);

    if (!dragData) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const targetZoneId = getClosestZone(event, guide);
    hoveredGuide = null;
    hoveredZone = null;
    dispatch('tabMove', { ...dragData, targetZoneId, position: 'end' });
  }

  function handleDragLeave(event: DragEvent, guide: TroubadourDockGuide): void {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget instanceof HTMLElement &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }

    if (hoveredGuide === guide.id) {
      hoveredGuide = null;
      hoveredZone = null;
    }
  }

  $: if (!visible) {
    hoveredGuide = null;
    hoveredZone = null;
  }
</script>

{#if visible}
  <div class="dock-compass" role="group" aria-label={ariaLabel}>
    {#each guides as guide (guide.id)}
      <div
        class={`dock-main-target dock-main-target-${guide.id} split-${guide.split}`}
        class:is-hovered={hoveredGuide === guide.id}
        role="group"
        aria-label={guide.label}
        on:dragover={(event) => handleDragOver(event, guide)}
        on:drop={(event) => handleDrop(event, guide)}
        on:dragleave={(event) => handleDragLeave(event, guide)}
      >
        <span class="dock-main-icon material-symbols-outlined" aria-hidden="true">{guide.icon}</span>
        {#each guide.zones as zoneId, index (zoneId)}
          <span
            class="dock-half-target"
            class:is-closest={hoveredZone === zoneId}
            aria-label={guide.zoneLabels[index]}
          ><span>{guide.zoneLabels[index]}</span></span>
        {/each}
      </div>
    {/each}
  </div>
{/if}

<style>
  .dock-compass {
    position: absolute;
    top: 50%;
    left: 50%;
    z-index: 40;
    transform: translate(-50%, -50%);
    display: grid;
    grid-template: repeat(3, 3.35rem) / repeat(3, 3.35rem);
    gap: 0.2rem;
    padding: 0.25rem;
    pointer-events: none;
    filter: drop-shadow(0 0.35rem 0.75rem rgb(0 0 0 / 0.32));
  }

  .dock-main-target {
    position: relative;
    display: flex;
    overflow: hidden;
    pointer-events: auto;
    color: var(--text-strong);
    background: color-mix(in srgb, var(--window-topbar-bg) 92%, var(--accent-strong-soft));
    border: 1px solid color-mix(in srgb, var(--border-strong, var(--border-soft)) 82%, var(--accent-strong));
    border-radius: 0.28rem;
  }

  .dock-main-target-top { grid-area: 1 / 2; }
  .dock-main-target-left { grid-area: 2 / 1; }
  .dock-main-target-middle { grid-area: 2 / 2; }
  .dock-main-target-right { grid-area: 2 / 3; }
  .dock-main-target-bottom { grid-area: 3 / 2; }
  .split-horizontal { flex-direction: row; }
  .split-vertical { flex-direction: column; }

  .dock-main-icon {
    position: absolute;
    top: 50%;
    left: 50%;
    z-index: 2;
    transform: translate(-50%, -50%);
    font-size: 1.25rem;
    pointer-events: none;
  }

  .dock-main-target.is-hovered .dock-main-icon { opacity: 0; }

  .dock-half-target {
    position: relative;
    display: grid;
    flex: 1 1 50%;
    place-items: center;
    min-width: 0;
    min-height: 0;
    opacity: 0;
    color: var(--muted);
    font-size: 0.52rem;
    line-height: 1.05;
    text-align: center;
  }

  .dock-main-target.is-hovered .dock-half-target { opacity: 1; }
  .dock-half-target + .dock-half-target { border-left: 1px solid var(--border-soft); }
  .split-vertical .dock-half-target + .dock-half-target {
    border-top: 1px solid var(--border-soft);
    border-left: 0;
  }

  .dock-half-target.is-closest {
    color: var(--text-strong);
    background: color-mix(in srgb, var(--accent-strong) 24%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-strong) 55%, transparent);
  }

  .dock-half-target > span {
    max-width: 100%;
    padding: 0.12rem;
    overflow: hidden;
  }
</style>
