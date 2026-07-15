<script lang="ts">
  import { onMount } from 'svelte';
  import PlayerVisualizer from '$lib/components/PlayerVisualizer.svelte';
  import {
    observeBackdropZones,
    type BackdropZoneObserver
  } from './workspace/backdrop-zone-observer';

  export let artworkUrl: string | undefined = undefined;
  export let geometryKey = '';

  interface VisualizerClipRect {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  interface VisualizerBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
  }

  const VISUALIZER_ZONE_SELECTOR = '[data-visualizer-zone="true"]';
  const TRIANGLE_SIZE_REFERENCE_SELECTOR = '.player-bar';

  let hostElement: HTMLElement | null = null;
  let zoneObserver: BackdropZoneObserver | null = null;
  let clipRects: VisualizerClipRect[] = [];
  let layerStyle = '';
  let lastGeometryKey = '';
  let isActive = false;
  let usesBrightVisualizerPalette = false;

  function scheduleGeometryRefresh(): void {
    zoneObserver?.refresh();
  }

  function getZoneBounds(zoneRects: DOMRect[]): VisualizerBounds {
    return zoneRects.reduce<VisualizerBounds>(
      (bounds, rect) => ({
        left: Math.min(bounds.left, rect.left),
        top: Math.min(bounds.top, rect.top),
        right: Math.max(bounds.right, rect.right),
        bottom: Math.max(bounds.bottom, rect.bottom)
      }),
      {
        left: zoneRects[0].left,
        top: zoneRects[0].top,
        right: zoneRects[0].right,
        bottom: zoneRects[0].bottom
      }
    );
  }

  function updateGeometry(shell: HTMLElement, zoneElements: HTMLElement[]): void {
    if (zoneElements.length === 0) {
      isActive = false;
      usesBrightVisualizerPalette = false;
      clipRects = [];
      layerStyle = '';
      return;
    }

    const shellRect = shell.getBoundingClientRect();
    const zoneRects = zoneElements.map((element) => element.getBoundingClientRect());
    const zoneBounds = getZoneBounds(zoneRects);
    const layerLeft = zoneBounds.left - shellRect.left;
    const layerTop = zoneBounds.top - shellRect.top;
    const width = Math.max(1, zoneBounds.right - zoneBounds.left);
    const height = Math.max(1, zoneBounds.bottom - zoneBounds.top);

    clipRects = zoneRects.map((rect) => ({
      x: rect.left - zoneBounds.left,
      y: rect.top - zoneBounds.top,
      width: rect.width,
      height: rect.height
    }));
    layerStyle = [
      `left: ${layerLeft}px`,
      `top: ${layerTop}px`,
      `width: ${width}px`,
      `height: ${height}px`
    ].join('; ');
    usesBrightVisualizerPalette = zoneElements.some(
      (element) =>
        element.classList.contains('artwork-backdrop-bright') ||
        element.classList.contains('artwork-background-bright')
    );
    isActive = true;
  }

  onMount(() => {
    if (hostElement) {
      zoneObserver = observeBackdropZones(
        hostElement,
        VISUALIZER_ZONE_SELECTOR,
        'data-visualizer-zone',
        updateGeometry
      );
    }
    return () => zoneObserver?.destroy();
  });

  $: if (geometryKey !== lastGeometryKey) {
    lastGeometryKey = geometryKey;
    scheduleGeometryRefresh();
  }

</script>

<div bind:this={hostElement} class="shared-visualizer-host" aria-hidden="true">
  {#if isActive}
    <div
      class="shared-visualizer-layer"
      class:artwork-backdrop-bright={usesBrightVisualizerPalette}
      style={layerStyle}
    >
      <PlayerVisualizer
        {artworkUrl}
        {clipRects}
        triangleSizeReferenceSelector={TRIANGLE_SIZE_REFERENCE_SELECTOR}
      />
    </div>
  {/if}
</div>
