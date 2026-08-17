<script lang="ts">
  import { t } from 'svelte-i18n';
  import { rafSettings } from '$lib/stores/raf-settings';
  import type { RafEffectSettings } from '$lib/types';
  import AutoAmpEditor from './AutoAmpEditor.svelte';
  import CrystalizerEditor from './CrystalizerEditor.svelte';
  import GraphicEqEditor from './GraphicEqEditor.svelte';
  import PitchEditor from './PitchEditor.svelte';
  import ReverbEditor from './ReverbEditor.svelte';
  import HeatEditor from './HeatEditor.svelte';
  import SloptimizerEditor from './SloptimizerEditor.svelte';
  import StereoWidthEditor from './StereoWidthEditor.svelte';

  export let effect: RafEffectSettings;

  function updateDryWet(event: Event) {
    const dryWet = (event.currentTarget as HTMLInputElement).valueAsNumber;
    rafSettings.updateEffect(effect.id, (current) => ({ ...current, dryWet }) as RafEffectSettings);
  }
</script>

<div class="effect-editor">
  <div class="effect-editor-fields">
    {#if effect.type === 'auto-amp'}
      <AutoAmpEditor settings={effect} />
    {:else if effect.type === 'graphic-eq'}
      <GraphicEqEditor settings={effect} />
    {:else if effect.type === 'stereo-width'}
      <StereoWidthEditor settings={effect} />
    {:else if effect.type === 'crystalizer'}
      <CrystalizerEditor settings={effect} />
    {:else if effect.type === 'sloptimizer'}
      <SloptimizerEditor settings={effect} />
    {:else if effect.type === 'pitch'}
      <PitchEditor settings={effect} />
    {:else if effect.type === 'heat'}
      <HeatEditor settings={effect} />
    {:else}
      <ReverbEditor settings={effect} />
    {/if}
  </div>

  <label class="dry-wet-control" aria-label={$t('options.raf.dryWet', { default: 'Dry/wet' })}>
    <span>{$t('options.raf.dryWet', { default: 'Dry/wet' })}</span>
    <input type="range" min="0" max="100" step="1" value={effect.dryWet} on:input={updateDryWet} />
    <output>{effect.dryWet.toFixed(0)}%</output>
  </label>
</div>

<style>
  .effect-editor { min-width: 0; display: flex; flex-direction: column; gap: 12px; }
  .effect-editor-fields { min-width: 0; }
  .dry-wet-control { min-width: 0; padding-top: 10px; display: grid; grid-template-columns: 47px minmax(80px, 1fr) 55px; align-items: center; gap: 7px; border-top: 1px solid var(--border-faint); color: var(--muted); font-size: 10px; }
  .dry-wet-control input[type='range'] { width: 100%; accent-color: var(--accent-strong); }
  .dry-wet-control output { color: var(--text-strong); text-align: right; font-variant-numeric: tabular-nums; }
</style>