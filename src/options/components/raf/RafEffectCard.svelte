<script lang="ts">
  import { RAF_EFFECT_REGISTRY } from '$lib/services/raf-effect-registry';
  import { rafSettings } from '$lib/stores/raf-settings';
  import type { RafEffectSettings } from '$lib/types';
  import CrystalizerEditor from './CrystalizerEditor.svelte';
  import GraphicEqEditor from './GraphicEqEditor.svelte';
  import StereoWidthEditor from './StereoWidthEditor.svelte';
  import SloptimizerEditor from './SloptimizerEditor.svelte';

  export let effect: RafEffectSettings;
  export let index: number;
  export let total: number;
  export let isDragging = false;
  export let onDragStart: (id: string) => void;
  export let onDragEnd: () => void;

  function toggle() {
    rafSettings.updateEffect(effect.id, (current) => ({ ...current, enabled: !current.enabled }));
  }

  function setSloptimizerMode(advanced: boolean) {
    rafSettings.updateEffect(effect.id, (current) => current.type === 'sloptimizer'
      ? { ...current, advanced }
      : current);
  }

  function startDrag(event: DragEvent) {
    onDragStart(effect.id);

    if (event.dataTransfer) {
      event.dataTransfer.setData('text/plain', effect.id);
      event.dataTransfer.effectAllowed = 'move';
      try {
        const header = (event.currentTarget as HTMLElement).closest('header');
        if (header) event.dataTransfer.setDragImage(header, 14, 14);
      } catch {
        // Chromium's default drag image is an acceptable fallback.
      }
    }
  }

  function endDrag() {
    onDragEnd();
  }
</script>

<article class="effect-card" class:is-bypassed={!effect.enabled} class:is-dragging={isDragging}>
  <header>
    <button class="icon-button drag-handle" draggable="true" on:dragstart={startDrag} on:dragend={endDrag} title="Drag to reorder" aria-label={`Drag ${RAF_EFFECT_REGISTRY[effect.type].name}`}>
      <span class="material-symbols-outlined" aria-hidden="true">drag_indicator</span>
    </button>
    <span class="material-symbols-outlined effect-icon" aria-hidden="true">{RAF_EFFECT_REGISTRY[effect.type].icon}</span>
    <strong>{RAF_EFFECT_REGISTRY[effect.type].name}</strong>
    {#if effect.type === 'sloptimizer'}
      <div class="mode-pill" aria-label="Sloptimizer editor mode">
        <button class:active={!effect.advanced} on:click={() => setSloptimizerMode(false)} aria-pressed={!effect.advanced}>Simple</button>
        <button class:active={effect.advanced} on:click={() => setSloptimizerMode(true)} aria-pressed={effect.advanced}>Advanced</button>
      </div>
    {/if}
    <div class="card-actions">
      <button
        class="icon-button bypass-toggle"
        class:active={effect.enabled}
        on:click={toggle}
        title={effect.enabled ? 'Bypass effect' : 'Power on effect'}
        aria-label={effect.enabled ? 'Bypass effect' : 'Power on effect'}
        aria-pressed={effect.enabled}
      >
        <span class="material-symbols-outlined" aria-hidden="true">power_settings_new</span>
      </button>
      <button class="icon-button" on:click={() => rafSettings.moveEffect(effect.id, index - 1)} disabled={index === 0} title="Move up" aria-label="Move effect up"><span class="material-symbols-outlined">arrow_upward</span></button>
      <button class="icon-button" on:click={() => rafSettings.moveEffect(effect.id, index + 1)} disabled={index === total - 1} title="Move down" aria-label="Move effect down"><span class="material-symbols-outlined">arrow_downward</span></button>
      <button class="icon-button" on:click={() => rafSettings.resetEffect(effect.id)} title="Reset effect" aria-label="Reset effect"><span class="material-symbols-outlined">restart_alt</span></button>
      <button class="icon-button remove" on:click={() => rafSettings.removeEffect(effect.id)} title="Remove effect" aria-label="Remove effect"><span class="material-symbols-outlined">delete</span></button>
    </div>
  </header>
  <div class="effect-editor">
    {#if effect.type === 'graphic-eq'}
      <GraphicEqEditor settings={effect} />
    {:else if effect.type === 'stereo-width'}
      <StereoWidthEditor settings={effect} />
    {:else if effect.type === 'crystalizer'}
      <CrystalizerEditor settings={effect} />
    {:else}
      <SloptimizerEditor settings={effect} />
    {/if}
  </div>
</article>

<style>
  .effect-card { width: 100%; min-width: 0; border: 1px solid var(--border-soft); border-radius: 6px; background: var(--bg-card); overflow: hidden; }
  .effect-card.is-bypassed .effect-editor { opacity: 0.55; }
  .effect-card.is-dragging { border-style: dashed; border-color: var(--accent-strong); background: transparent; opacity: 0.58; cursor: grabbing; }
  .effect-card.is-dragging .effect-editor { display: none; }
  .effect-card.is-dragging header { border-bottom: 0; }
  .effect-card.is-dragging button { pointer-events: none; }
  header { min-width: 0; min-height: 33px; display: flex; flex-wrap: wrap; align-items: center; gap: 3px 5px; padding: 2px 5px; border-bottom: 1px solid var(--border-faint); }
  strong { min-width: 0; color: var(--text-strong); }
  .effect-icon { color: var(--accent-strong); }
  .mode-pill { display: inline-flex; overflow: hidden; border: 1px solid var(--border-faint); border-radius: 999px; }
  .mode-pill button { min-height: 22px; padding: 2px 7px; border: 0; border-radius: 0; color: var(--muted-strong); font-size: 10px; }
  .mode-pill button + button { border-left: 1px solid var(--border-faint); }
  .mode-pill button.active { background: var(--accent); color: var(--accent-text, #fff); }
  .mode-pill button:hover:not(.active) { background: var(--hover-surface); color: var(--text-strong); }
  .drag-handle { cursor: grab; }
  .drag-handle:active { cursor: grabbing; }
  .bypass-toggle { color: var(--muted-strong); }
  .bypass-toggle.active { color: var(--accent-strong); }
  .card-actions { min-width: 0; display: flex; align-items: center; gap: 1px; margin-left: auto; }
  button { color: var(--text); background: transparent; border-radius: 4px; }
  button:hover:not(:disabled) { background: var(--hover-surface); color: var(--text-strong); }
  button:disabled { opacity: 0.3; }
  .icon-button { width: 25px; height: 25px; display: inline-grid; place-items: center; padding: 0; }
  .icon-button .material-symbols-outlined { font-size: 16px; }
  .remove:hover { color: var(--danger, #ef6b73); }
  .effect-editor { width: 100%; min-width: 0; padding: 6px; overflow: hidden; transition: opacity 120ms ease; }

  @container (max-width: 300px) {
    .card-actions { order: 3; width: 100%; margin-left: 0; justify-content: flex-end; border-top: 1px solid var(--border-faint); padding-top: 2px; }
  }
</style>
