<script lang="ts">
  import { tick } from 'svelte';
  import { portal } from '$lib/components/playlist-panel/actions/portal';
  import { windowDismiss } from '$lib/components/playlist-panel/actions/window-dismiss';
  import { RAF_EFFECT_DEFINITIONS, RAF_EFFECT_REGISTRY } from '$lib/services/raf-effect-registry';
  import { rafSettings } from '$lib/stores/raf-settings';
  import type { RafEffectSettings, RafEffectType } from '$lib/types';
  import RafEffectEditor from './RafEffectEditor.svelte';

  let selectedEffectId: string | null = null;
  let draggedId: string | null = null;
  let dropBoundary: number | null = null;
  let dragEngaged = false;
  let addMenu: HTMLDetailsElement;
  let contextMenu: { effectId: string; x: number; y: number } | null = null;
  let contextMenuElement: HTMLDivElement | null = null;

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

  async function openEffectContextMenu(event: MouseEvent, effectId: string) {
    event.preventDefault();
    event.stopPropagation();
    selectedEffectId = effectId;
    contextMenu = { effectId, x: event.clientX, y: event.clientY };
    await tick();
    if (!contextMenu || contextMenu.effectId !== effectId || !contextMenuElement) return;
    const padding = 8;
    contextMenu = {
      ...contextMenu,
      x: Math.max(padding, Math.min(contextMenu.x, window.innerWidth - contextMenuElement.offsetWidth - padding)),
      y: Math.max(padding, Math.min(contextMenu.y, window.innerHeight - contextMenuElement.offsetHeight - padding))
    };
  }

  function renameEffect(id: string) {
    contextMenu = null;
    const effect = $rafSettings.effects.find((candidate) => candidate.id === id);
    if (!effect) return;
    const displayName = window.prompt('Rename effect (leave blank to use its original name):', effect.displayName ?? '');
    if (displayName === null) return;
    rafSettings.renameEffect(id, displayName);
  }

  function cloneEffect(id: string) {
    contextMenu = null;
    const sourceIndex = $rafSettings.effects.findIndex((effect) => effect.id === id);
    const nextSettings = rafSettings.cloneEffect(id);
    selectedEffectId = nextSettings.effects[sourceIndex + 1]?.id ?? selectedEffectId;
  }

  function deleteEffect(id: string) {
    contextMenu = null;
    removeEffect(id);
  }

  function startDrag(event: DragEvent, id: string, index: number) {
    draggedId = id;
    selectedEffectId = id;
    dropBoundary = index;
    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', id);
      event.dataTransfer.effectAllowed = 'move';
      try {
        const row = (event.currentTarget as HTMLElement).closest('.effect-list-slot');
        if (row) {
          const dragImage = row.cloneNode(true) as HTMLElement;
          dragImage.classList.remove('show-drop-line', 'is-dragging');
          dragImage.style.position = 'fixed';
          dragImage.style.top = '-1000px';
          dragImage.style.left = '0';
          dragImage.style.width = `${row.getBoundingClientRect().width}px`;
          dragImage.style.pointerEvents = 'none';
          document.body.append(dragImage);
          event.dataTransfer.setDragImage(dragImage, 10, 11);
          setTimeout(() => dragImage.remove());
        }
      } catch {
        // Chromium's default drag image is an acceptable fallback.
      }
    }
  }

  function updateDropBoundary(event: DragEvent, index: number) {
    event.preventDefault();
    if (!draggedId) return;
    dragEngaged = true;
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
    dragEngaged = false;
  }

  $: if (!$rafSettings.effects.some((effect) => effect.id === selectedEffectId)) {
    selectedEffectId = $rafSettings.effects[0]?.id ?? null;
  }
  $: selectedEffect = $rafSettings.effects.find((effect) => effect.id === selectedEffectId) ?? null;
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
          class:selected={effect.id === selectedEffectId}
          class:bypassed={!effect.enabled}
          class:is-dragging={dragEngaged && draggedId === effect.id}
          class:show-drop-line={draggedId !== null && dropBoundary === index}
          role="listitem"
          on:dragover={(event) => updateDropBoundary(event, index)}
        >
          <button
            class="drag-handle"
            draggable="true"
            on:dragstart={(event) => startDrag(event, effect.id, index)}
            on:contextmenu={(event) => openEffectContextMenu(event, effect.id)}
            title={`Drag ${RAF_EFFECT_REGISTRY[effect.type].name} to reorder`}
            aria-label={`Drag ${RAF_EFFECT_REGISTRY[effect.type].name} to reorder`}
          ><span class="material-symbols-outlined" aria-hidden="true">drag_indicator</span></button>
          <button
            class="effect-list-item"
            on:click={() => (selectedEffectId = effect.id)}
            on:contextmenu={(event) => openEffectContextMenu(event, effect.id)}
            aria-pressed={effect.id === selectedEffectId}
          >
            <span class="material-symbols-outlined effect-list-icon" aria-hidden="true">{RAF_EFFECT_REGISTRY[effect.type].icon}</span>
            <span class="effect-list-copy">
              <span class="effect-display-name">{effect.displayName ?? RAF_EFFECT_REGISTRY[effect.type].name}</span>
              {#if effect.displayName}
                <span class="effect-type-name">{RAF_EFFECT_REGISTRY[effect.type].name}</span>
              {/if}
            </span>
          </button>
        </div>
      {/each}
      <div
        class="drop-tail"
        class:show-drop-line={draggedId !== null && dropBoundary === $rafSettings.effects.length}
        on:dragover={(event) => {
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
          dragEngaged = true;
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
        <span class="effect-config-heading">
          <strong>{selectedEffect.displayName ?? RAF_EFFECT_REGISTRY[selectedEffect.type].name}</strong>
          {#if selectedEffect.displayName}
            <span>{RAF_EFFECT_REGISTRY[selectedEffect.type].name}</span>
          {/if}
        </span>
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

{#if contextMenu}
  <div
    bind:this={contextMenuElement}
    class="effect-context-menu"
    data-menu-interactive="true"
    use:portal
    use:windowDismiss={{ enabled: true, onDismiss: () => (contextMenu = null) }}
    role="menu"
    aria-label="Effect actions"
    style={`left: ${contextMenu.x}px; top: ${contextMenu.y}px;`}
  >
    <button type="button" role="menuitem" on:click={() => renameEffect(contextMenu?.effectId ?? '')}>
      <span class="material-symbols-outlined" aria-hidden="true">edit</span>
      <span>Rename effect</span>
    </button>
    <button type="button" role="menuitem" on:click={() => cloneEffect(contextMenu?.effectId ?? '')}>
      <span class="material-symbols-outlined" aria-hidden="true">content_copy</span>
      <span>Clone effect</span>
    </button>
    <div class="context-menu-separator" role="separator" aria-hidden="true"></div>
    <button class="danger" type="button" role="menuitem" on:click={() => deleteEffect(contextMenu?.effectId ?? '')}>
      <span class="material-symbols-outlined" aria-hidden="true">delete</span>
      <span>Delete effect</span>
    </button>
  </div>
{/if}

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
  .effects-list { min-height: 0; flex: 1; padding: 0; overflow: auto; }
  .effect-list-slot { position: relative; min-width: 0; display: grid; grid-template-columns: 20px minmax(0, 1fr); align-items: center; background: transparent; font-size: 0.8rem; }
  .effect-list-slot:hover { background: var(--tree-hover); }
  .effect-list-slot.selected { background: var(--selection-strong); color: var(--text-strong); }
  .effect-list-slot.bypassed { opacity: 0.55; }
  .effect-list-slot.is-dragging { background: transparent; opacity: 0.58; cursor: grabbing; }
  .effect-list-slot.is-dragging button { pointer-events: none; }
  .drag-handle { width: 20px; align-self: stretch; min-height: 22px; padding: 0; display: grid; place-items: center; border-radius: 0; background: transparent; color: var(--muted); cursor: grab; opacity: 0; }
  .effect-list-slot:hover .drag-handle { opacity: 1; }
  .drag-handle:active { cursor: grabbing; }
  .drag-handle:hover { color: var(--text-strong); }
  .effect-list-item { min-width: 0; padding: 3px 6px 3px 1px; display: flex; align-items: center; gap: 6px; overflow: hidden; border-radius: 0; background: transparent; color: inherit; text-align: left; }
  .effect-list-copy { min-width: 0; display: flex; align-items: baseline; gap: 5px; overflow: hidden; white-space: nowrap; }
  .effect-display-name { min-width: 0; flex: 0 1 auto; overflow: hidden; text-overflow: ellipsis; }
  .effect-type-name { min-width: 0; flex: 1 1000 auto; overflow: hidden; color: var(--muted); font-size: 0.68rem; text-overflow: clip; }
  .effect-list-icon { flex: 0 0 auto; color: var(--accent-strong); }
  .effect-list-slot.show-drop-line::before,
  .drop-tail.show-drop-line::before { content: ''; position: absolute; z-index: 3; left: 3px; right: 3px; top: -1px; height: 2px; background: var(--accent-strong); pointer-events: none; }
  .drop-tail { position: relative; min-height: 40px; }
  .effect-config { min-width: 0; container-type: inline-size; }
  .effect-config-header { min-height: 40px; padding: 5px 9px; display: flex; align-items: center; gap: 6px; border-bottom: 1px solid var(--border-faint); }
  .effect-config-heading { min-width: 0; display: flex; align-items: baseline; gap: 6px; overflow: hidden; white-space: nowrap; }
  .effect-config-heading strong { min-width: 0; flex: 0 1 auto; overflow: hidden; color: var(--text-strong); text-overflow: ellipsis; }
  .effect-config-heading > span { min-width: 0; flex: 1 1000 auto; overflow: hidden; color: var(--muted); font-size: 0.7rem; text-overflow: clip; }
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
  .effect-context-menu { position: fixed; z-index: 60; width: max-content; min-width: 10.5rem; max-width: calc(100vw - 1rem); padding: 0.18rem; border: 1px solid var(--menu-popover-border); border-radius: 0.5rem; background: var(--menu-popover-bg); box-shadow: var(--menu-popover-shadow); font-size: 0.8rem; }
  .effect-context-menu button { width: 100%; padding: 0.32rem 0.42rem; display: flex; align-items: center; gap: 0.42rem; border-radius: 0.5rem; background: transparent; color: var(--menu-popover-text); text-align: left; white-space: nowrap; }
  .effect-context-menu button:hover { background: var(--menu-popover-hover); }
  .effect-context-menu button .material-symbols-outlined { color: var(--menu-popover-muted); font-size: 0.9rem; }
  .effect-context-menu button.danger:hover,
  .effect-context-menu button.danger:hover .material-symbols-outlined { color: var(--danger); }
  .context-menu-separator { height: 1px; margin: 0.18rem 0; background: var(--menu-popover-border); }

  @container (max-width: 390px) {
    .effects-workspace { grid-template-columns: 145px minmax(0, 1fr); }
    .effect-config-header { align-items: flex-start; flex-wrap: wrap; }
    .effect-config-actions { margin-left: 0; }
  }
</style>
