<script lang="ts" context="module">
  let instanceCounter = 0;
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { createMilkDropVisualizer, type MilkDropStatus } from '$lib/services/milkdrop-visualizer';
  import { visualizerSettings } from '$lib/stores/visualizer-settings';

  export let standalone = false;
  export let clipRects: Array<{ x: number; y: number; width: number; height: number }> = [];

  const clipId = `milkdrop-clip-${++instanceCounter}`;
  let canvas: HTMLCanvasElement;
  let status: MilkDropStatus = 'loading';
  let controller: ReturnType<typeof createMilkDropVisualizer> | null = null;

  export function randomizePreset() {
    controller?.randomizePreset();
  }

  onMount(() => {
    controller = createMilkDropVisualizer(canvas, (next) => { status = next; });
    return () => {
      controller?.destroy();
      controller = null;
    };
  });
</script>

{#if clipRects.length > 0}
  <svg width="0" height="0" aria-hidden="true" class="clip-definitions">
    <defs>
      <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
        {#each clipRects as rect}
          <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} />
        {/each}
      </clipPath>
    </defs>
  </svg>
{/if}
<canvas
  bind:this={canvas}
  class="player-visualizer milkdrop-visualizer"
  aria-hidden="true"
  style:opacity={standalone ? 1 : $visualizerSettings.transparency}
  style:visibility={status === 'ready' ? 'visible' : 'hidden'}
  style:clip-path={clipRects.length ? `url(#${clipId})` : null}
></canvas>
{#if standalone && status !== 'ready'}
  <span class="milkdrop-status" role="status">
    {#if status === 'loading'}
      {$t('main.visualizer.loading', { default: 'Loading MilkDrop…' })}
    {:else if status === 'webgl-unavailable'}
      {$t('main.visualizer.webglUnavailable', { default: 'MilkDrop needs WebGL 2, but a graphics context could not be created. Choose another visualizer from the context menu.' })}
    {:else if status === 'context-lost'}
      {$t('main.visualizer.contextLost', { default: 'MilkDrop lost its graphics context. Switch visualizers to retry.' })}
    {:else}
      {$t('main.visualizer.error', { default: 'MilkDrop could not load or render. See Tools > Logs for details, or choose another visualizer from the context menu.' })}
    {/if}
  </span>
{/if}

<style>
  .clip-definitions { position: absolute; }
  .milkdrop-visualizer { mix-blend-mode: normal; }
  .milkdrop-status {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    color: #ccc;
    text-align: center;
    font-size: 12px;
    pointer-events: none;
  }
</style>
