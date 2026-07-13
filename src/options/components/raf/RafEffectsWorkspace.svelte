<script lang="ts">
  import { RAF_EFFECT_DEFINITIONS, RAF_EFFECT_REGISTRY } from '$lib/services/raf-effect-registry';
  import { rafSettings } from '$lib/stores/raf-settings';
  import type { RafEffectSettings, RafEffectType } from '$lib/types';
  import RafEffectEditor from './RafEffectEditor.svelte';

  let selectedEffectId: string | null = null;
  let draggedId: string | null = null;
  let dropBoundary: number | null = null;
  let addMenu: HTMLDetailsElement;

  function addEffect(type: RafEffectType) {
    const nextSettings = rafSettings.addEffect(type);
    selectedEffectId = nextSettings.effects.at(-1)?.id ?? null;
    addMenu?.removeAttribute('open');
  }

  function removeEffect(id: string) {
    const index = $rafSettings.effects.findIndex((effect) => effect.id === id);
    const nextSettings = rafSettings.removeEffect(id);
    if (selectedEffectId === id) {
      selectedEffectId = nextSettings.effects[Math.min(index, nextSettings.effects.length - 1)]?.id ?? null;
    }
  }

  function toggleEffect(effect: RafEffectSettings) {
    rafSettings.updateEffect(effect.id, (current) => ({ ...current, enabled: !current.enabled }));
  }

  function setSloptimizerMode(effect: RafEffectSettings, advanced: boolean) {
    rafSettings.updateEffect(effect.id, (current) => current.type === 'sloptimizer'
      ? { ...current, advanced }
      : current);
  }

  function startDrag(event: DragEvent, id: string, index: number) {
    draggedId = id;
    selectedEffectId = id;
    dropBoundary = index;
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', id);
      event.dataTransfer.effectAllowed = 'move';
    }
  }

  function updateDropBoundary(event: DragEvent, index: number) {
    event.preventDefault();
    if (!draggedId) return;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    dropBoundary = event.clientY < rect.top + rect.height / 2 ? index : index + 1;
  }

  function dropEffect(event: DragEvent) {
    event.preventDefault();
    if (draggedId && dropBoundary !== null) {
      const sourceIndex = $rafSettings.effects.findIndex((effect) => effect.id === draggedId);
      const targetIndex = dropBoundary > sourceIndex ? dropBoundary - 1 : dropBoundary;
      rafSettings.moveEffect(draggedId, targetIndex);
    }
    clearDrag();
  }

  function clearDrag() {
    draggedId = null;
    dropBoundary = null;
  }

  $: if (!$rafSettings.effects.some((effect) => effect.id === selectedEffectId)) {
    selectedEffectId = $rafSettings.effects[0]?.id ?? null;
  }
  $: selectedEffect = $rafSettings.effects.find((effect) => effect.id === selectedEffectId) ?? null;
  $: selectedIndex = selectedEffect
    ? $rafSettings.effects.findIndex((effect) => effect.id === selectedEffect.id)
    : -1;
</script>

<div class="effects-workspace">
  <aside class="effects-sidebar" aria-label="Raf effects">
    <header class="effects-sidebar-header">
      <strong>Effects</strong>
      <div class="effects-sidebar-actions" aria-label="Effect list actions">
        <details class="sidebar-add-menu" bind:this={addMenu}>
          <summary title="Add effect" aria-label="Add effect">
            <span class="material-symbols-outlined" aria-hidden="true">add</span>
          </summary>
          <div class="sidebar-add-menu-items">
            {#each RAF_EFFECT_DEFINITIONS as definition}
              <button on:click={() => addEffect(definition.type)}>
                <span class="material-symbols-outlined" aria-hidden="true">{definition.icon}</span>
                {definition.name}
              </button>
            {/each}
          </div>
        </details>
        <button
          on:click={() => selectedEffect && rafSettings.moveEffect(selectedEffect.id, selectedIndex - 1)}
          disabled={!selectedEffect || selectedIndex === 0}
          title="Move selected effect up"
          aria-label="Move selected effect up"
        ><span class="material-symbols-outlined" aria-hidden="true">arrow_upward</span></button>
        <button
          on:click={() => selectedEffect && rafSettings.moveEffect(selectedEffect.id, selectedIndex + 1)}
          disabled={!selectedEffect || selectedIndex === $rafSettings.effects.length - 1}
          title="Move selected effect down"
          aria-label="Move selected effect down"
        ><span class="material-symbols-outlined" aria-hidden="true">arrow_downward</span></button>
        <button
          class="remove"
          on:click={() => selectedEffect && removeEffect(selectedEffect.id)}
          disabled={!selectedEffect}
          title="Remove selected effect"
          aria-label="Remove selected effect"
        ><span class="material-symbols-outlined" aria-hidden="true">delete</span></button>
      </div>
    </header>

    <div class="effects-list" role="list" on:drop={dropEffect} on:dragend={clearDrag}>
      {#each $rafSettings.effects as effect, index (effect.id)}
        <div
          class="effect-list-slot"
          class:show-drop-line={draggedId !== null && dropBoundary === index}
          role="listitem"
          on:dragover={(event) => updateDropBoundary(event, index)}
        >
          <button
            class="drag-handle"
            draggable="true"
            on:dragstart={(event) => startDrag(event, effect.id, index)}
            title={`Drag ${RAF_EFFECT_REGISTRY[effect.type].name} to reorder`}
            aria-label={`Drag ${RAF_EFFECT_REGISTRY[effect.type].name} to reorder`}
          ><span class="material-symbols-outlined" aria-hidden="true">drag_indicator</span></button>
          <button
            class="effect-list-item"
            class:selected={effect.id === selectedEffectId}
            class:bypassed={!effect.enabled}
            on:click={() => (selectedEffectId = effect.id)}
            title={RAF_EFFECT_REGISTRY[effect.type].name}
            aria-pressed={effect.id === selectedEffectId}
          >
            <span class="material-symbols-outlined effect-list-icon" aria-hidden="true">{RAF_EFFECT_REGISTRY[effect.type].icon}</span>
            <span>{RAF_EFFECT_REGISTRY[effect.type].name}</span>
          </button>
        </div>
      {/each}
      <div
        class="drop-tail"
        class:show-drop-line={draggedId !== null && dropBoundary === $rafSettings.effects.length}
        on:dragover={(event) => {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
          dropBoundary = $rafSettings.effects.length;
        }}
        aria-hidden="true"
      ></div>
    </div>
  </aside>

  <section class="effect-config" class:is-bypassed={selectedEffect && !selectedEffect.enabled}>
    {#if selectedEffect}
      <header class="effect-config-header">
        <span class="material-symbols-outlined effect-config-icon" aria-hidden="true">{RAF_EFFECT_REGISTRY[selectedEffect.type].icon}</span>
        <strong>{RAF_EFFECT_REGISTRY[selectedEffect.type].name}</strong>
        {#if selectedEffect.type === 'sloptimizer'}
          <div class="mode-switch" aria-label="Sloptimizer editor mode">
            <button class:active={!selectedEffect.advanced} on:click={() => setSloptimizerMode(selectedEffect, false)} aria-pressed={!selectedEffect.advanced}>Simple</button>
            <button class:active={selectedEffect.advanced} on:click={() => setSloptimizerMode(selectedEffect, true)} aria-pressed={selectedEffect.advanced}>Advanced</button>
          </div>
        {/if}
        <div class="effect-config-actions">
          <button
            class:active={selectedEffect.enabled}
            on:click={() => toggleEffect(selectedEffect)}
            title={selectedEffect.enabled ? 'Bypass effect' : 'Power on effect'}
            aria-label={selectedEffect.enabled ? 'Bypass effect' : 'Power on effect'}
            aria-pressed={selectedEffect.enabled}
          ><span class="material-symbols-outlined" aria-hidden="true">power_settings_new</span></button>
          <button on:click={() => rafSettings.resetEffect(selectedEffect.id)} title="Reset effect" aria-label="Reset effect">
            <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>
          </button>
        </div>
      </header>
      <div class="effect-config-editor">
        <RafEffectEditor effect={selectedEffect} />
      </div>
    {:else}
      <div class="empty-config">
        <span class="material-symbols-outlined" aria-hidden="true">tune</span>
        <strong>Add an effect to start building the rack</strong>
      </div>
    {/if}
  </section>
</div>

<style>
  .effects-workspace { width: calc(100% + 20px); min-width: 0; min-height: 220px; flex: 1; margin: -6px -10px -8px; display: grid; grid-template-columns: clamp(160px, 28cqw, 210px) minmax(0, 1fr); }
  .effects-sidebar { min-width: 0; display: flex; flex-direction: column; background: color-mix(in srgb, var(--bg-tree) 74%, transparent); border-right: 1px solid var(--border-soft); }
  .effects-sidebar-header { min-height: 34px; padding: 4px 7px 4px 10px; display: flex; align-items: center; gap: 4px; border-bottom: 1px solid var(--border-faint); }
  .effects-sidebar-header strong { color: var(--text-strong); }
  .effects-sidebar-actions { min-width: 0; margin-left: auto; display: flex; align-items: center; gap: 1px; }
  .sidebar-add-menu { position: relative; }
  .sidebar-add-menu summary { width: 25px; height: 25px; padding: 0; display: grid; place-items: center; border-radius: 3px; color: var(--muted-strong); cursor: pointer; list-style: none; }
  .sidebar-add-menu summary::-webkit-details-marker { display: none; }
  .sidebar-add-menu summary:hover { background: var(--hover-surface); color: var(--text-strong); }
  .sidebar-add-menu-items { position: absolute; z-index: 8; top: calc(100% + 3px); left: 0; width: 150px; padding: 3px; display: grid; border: 1px solid var(--menu-bar-border); border-radius: 4px; background: var(--menu-popover-bg); box-shadow: var(--shadow); }
  .sidebar-add-menu-items button { min-width: 0; padding: 6px 7px; display: flex; align-items: center; gap: 6px; border-radius: 3px; background: transparent; color: var(--text); text-align: left; }
  .sidebar-add-menu-items button:hover { background: var(--hover-surface); color: var(--text-strong); }
  .effects-sidebar-actions > button,
  .effect-config-actions button { width: 25px; height: 25px; padding: 0; display: grid; place-items: center; border-radius: 3px; background: transparent; color: var(--muted-strong); }
  .effects-sidebar-actions > button:hover:not(:disabled),
  .effect-config-actions button:hover { background: var(--hover-surface); color: var(--text-strong); }
  .effects-sidebar-actions > button:disabled { opacity: 0.3; }
  .effects-sidebar-actions .remove:hover:not(:disabled) { color: var(--danger); }
  .effects-list { min-height: 0; flex: 1; padding: 4px; overflow: auto; }
  .effect-list-slot { position: relative; min-width: 0; display: grid; grid-template-columns: 22px minmax(0, 1fr); align-items: center; }
  .drag-handle { width: 22px; height: 28px; padding: 0; display: grid; place-items: center; border-radius: 3px; background: transparent; color: var(--muted); cursor: grab; }
  .drag-handle:active { cursor: grabbing; }
  .drag-handle:hover { background: var(--hover-surface); color: var(--text-strong); }
  .effect-list-item { min-width: 0; height: 28px; padding: 0 6px; display: flex; align-items: center; gap: 6px; overflow: hidden; border-radius: 3px; background: transparent; color: var(--text); text-align: left; }
  .effect-list-item > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .effect-list-item:hover { background: var(--tree-hover); }
  .effect-list-item.selected { background: var(--selection-strong); color: var(--text-strong); }
  .effect-list-item.bypassed { opacity: 0.55; }
  .effect-list-icon { flex: 0 0 auto; color: var(--accent-strong); }
  .effect-list-slot.show-drop-line::before,
  .drop-tail.show-drop-line::before { content: ''; position: absolute; z-index: 3; left: 3px; right: 3px; top: -1px; height: 2px; background: var(--accent-strong); pointer-events: none; }
  .drop-tail { position: relative; min-height: 40px; }
  .effect-config { min-width: 0; container-type: inline-size; }
  .effect-config-header { min-height: 40px; padding: 5px 9px; display: flex; align-items: center; gap: 6px; border-bottom: 1px solid var(--border-faint); }
  .effect-config-header strong { color: var(--text-strong); }
  .effect-config-icon { color: var(--accent-strong); }
  .effect-config-actions { margin-left: auto; display: flex; align-items: center; gap: 1px; }
  .effect-config-actions button.active { color: var(--accent-strong); }
  .effect-config-editor { min-width: 0; padding: 12px 10px; transition: opacity 120ms ease; }
  .effect-config.is-bypassed .effect-config-editor { opacity: 0.55; }
  .mode-switch { display: inline-flex; border: 1px solid var(--border-faint); }
  .mode-switch button { min-height: 22px; padding: 2px 7px; border-radius: 0; background: transparent; color: var(--muted-strong); font-size: 10px; }
  .mode-switch button + button { border-left: 1px solid var(--border-faint); }
  .mode-switch button.active { background: var(--accent); color: var(--accent-text, #fff); }
  .mode-switch button:hover:not(.active) { background: var(--hover-surface); color: var(--text-strong); }
  .empty-config { min-height: 180px; padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; color: var(--muted); text-align: center; }
  .empty-config .material-symbols-outlined { color: var(--accent-strong); font-size: 26px; }
  .empty-config strong { color: var(--text-strong); }

  @container (max-width: 390px) {
    .effects-workspace { grid-template-columns: 145px minmax(0, 1fr); }
    .effect-config-header { align-items: flex-start; flex-wrap: wrap; }
    .effect-config-actions { margin-left: 0; }
  }
</style>
