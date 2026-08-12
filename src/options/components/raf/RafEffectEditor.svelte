<script lang="ts">
  import type { RafEffectSettings } from '$lib/contracts/raf';
  import AutoAmpEditor from './AutoAmpEditor.svelte';
  import CrystalizerEditor from './CrystalizerEditor.svelte';
  import GraphicEqEditor from './GraphicEqEditor.svelte';
  import ReverbEditor from './ReverbEditor.svelte';
  import SloptimizerEditor from './SloptimizerEditor.svelte';
  import StereoWidthEditor from './StereoWidthEditor.svelte';

  export let effect: RafEffectSettings;
</script>

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
{:else}
  <ReverbEditor settings={effect} />
{/if}
