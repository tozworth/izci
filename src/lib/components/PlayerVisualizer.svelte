<script lang="ts">
  import { visualizerSettings } from '$lib/stores/visualizer-settings';
  import StandardVisualizer from './visualizers/StandardVisualizer.svelte';
  import MilkDropVisualizer from './visualizers/MilkDropVisualizer.svelte';

  export let artworkUrl: string | undefined = undefined;
  export let triangleSizeReferenceSelector: string | null = null;
  export let clipRects: Array<{ x: number; y: number; width: number; height: number }> = [];
  export let standalone = false;
  let milkDropVisualizer: MilkDropVisualizer | null = null;

  export function randomizePreset() {
    milkDropVisualizer?.randomizePreset();
  }
</script>

{#if $visualizerSettings.style === 'milkdrop'}
  <MilkDropVisualizer bind:this={milkDropVisualizer} {clipRects} {standalone} />
{:else}
  <StandardVisualizer {artworkUrl} {triangleSizeReferenceSelector} {clipRects} {standalone} />
{/if}
