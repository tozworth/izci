<script lang="ts">
  import { t } from 'svelte-i18n';
  import PlayerVisualizer from '$lib/components/PlayerVisualizer.svelte';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import { VISUALIZER_STYLE_OPTIONS, visualizerSettings } from '$lib/stores/visualizer-settings';
  import type { MenuActionItem, VisualizerStyle } from '$lib/types';

  export let artworkUrl: string | undefined = undefined;
  let contextMenuOpen = false;
  let contextMenuX = 0;
  let contextMenuY = 0;
  let visualizer: PlayerVisualizer | null = null;

  function handlePointerDown(event: PointerEvent) {
    if (event.button === 1 && $visualizerSettings.style === 'milkdrop') event.preventDefault();
  }

  function handleAuxClick(event: MouseEvent) {
    if (event.button !== 1 || $visualizerSettings.style !== 'milkdrop') return;
    event.preventDefault();
    event.stopPropagation();
    visualizer?.randomizePreset();
  }

  function styleLabel(style: VisualizerStyle): string {
    switch (style) {
      case 'wave': return $t('options.visualizer.options.wave', { default: 'Uniform wave' });
      case 'bars': return $t('options.visualizer.options.bars', { default: 'Spectrum bars' });
      case 'mirror': return $t('options.visualizer.options.mirror', { default: 'Mirror bloom' });
      case 'blocks': return $t('options.visualizer.options.blocks', { default: 'Pixel blocks' });
      case 'triangles': return $t('options.visualizer.options.triangles', { default: 'Rhythm triangles' });
      case 'milkdrop': return $t('options.visualizer.options.milkdrop', { default: 'MilkDrop' });
    }
  }

  function openContextMenu(event: MouseEvent) {
    contextMenuX = event.clientX;
    contextMenuY = event.clientY;
    contextMenuOpen = true;
  }

  function selectStyle(id: string) {
    const style = VISUALIZER_STYLE_OPTIONS.find((option) => option.value === id)?.value;
    if (style) visualizerSettings.update({ style });
    contextMenuOpen = false;
  }

  $: menuItems = VISUALIZER_STYLE_OPTIONS.map(({ value }) => ({
    id: value, label: styleLabel(value), checked: $visualizerSettings.style === value
  })) satisfies MenuActionItem[];
</script>

<div
  class="visualizer-viewport"
  role="region"
  aria-label={$t('workspace.tabs.visualizer', { default: 'Visualizer' })}
  on:contextmenu|preventDefault|stopPropagation={openContextMenu}
  on:pointerdown={handlePointerDown}
  on:auxclick={handleAuxClick}
>
  <PlayerVisualizer bind:this={visualizer} {artworkUrl} standalone={true} />
</div>

{#if contextMenuOpen}
  <MenuSurface
    items={menuItems}
    x={contextMenuX}
    y={contextMenuY}
    ariaLabel={$t('workspace.tabs.visualizer', { default: 'Visualizer' })}
    on:action={(event) => selectStyle(event.detail)}
    on:dismiss={() => { contextMenuOpen = false; }}
  />
{/if}

<style>
  .visualizer-viewport {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    isolation: isolate;
    background: #000;
    --visualizer-high: rgba(255, 246, 210, 0.95);
    --visualizer-mid: rgba(120, 205, 255, 0.68);
    --visualizer-low: rgba(255, 121, 198, 0.22);
    --visualizer-glow: rgba(120, 205, 255, 0.42);
    --visualizer-bars: rgba(155, 220, 255, 0.86);
    --visualizer-blocks: rgba(255, 246, 210, 0.72);
    --visualizer-blend-mode: normal;
  }
</style>
