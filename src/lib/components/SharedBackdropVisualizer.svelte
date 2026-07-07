<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import PlayerVisualizer from '$lib/components/PlayerVisualizer.svelte';

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
  let shellElement: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let animationFrame: number | null = null;
  let refreshFrame: number | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let observedZoneElements = new Set<Element>();
  let clipRects: VisualizerClipRect[] = [];
  let layerStyle = '';
  let lastGeometryKey = '';
  let isActive = false;
  let usesBrightVisualizerPalette = false;

  function scheduleGeometryUpdate(): void {
    if (typeof window === 'undefined' || animationFrame !== null) {
      return;
    }

    animationFrame = window.requestAnimationFrame(() => {
      animationFrame = null;
      updateGeometry();
    });
  }

  function scheduleGeometryRefresh(): void {
    if (typeof window === 'undefined') {
      return;
    }

    scheduleGeometryUpdate();

    if (refreshFrame === null) {
      refreshFrame = window.requestAnimationFrame(() => {
        refreshFrame = window.requestAnimationFrame(() => {
          refreshFrame = null;
          scheduleGeometryUpdate();
        });
      });
    }

    if (refreshTimer !== null) {
      clearTimeout(refreshTimer);
    }

    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      scheduleGeometryUpdate();
    }, 120);
  }

  function getVisibleZoneElements(): HTMLElement[] {
    const shell = shellElement;

    if (!shell) {
      return [];
    }

    return Array.from(shell.querySelectorAll<HTMLElement>(VISUALIZER_ZONE_SELECTOR)).filter((element) => {
      const rect = element.getBoundingClientRect();

      return rect.width > 0 && rect.height > 0;
    });
  }

  function syncObservedZoneElements(zoneElements: HTMLElement[]): void {
    if (!resizeObserver) {
      return;
    }

    const nextElements = new Set<Element>(zoneElements);

    for (const element of observedZoneElements) {
      if (!nextElements.has(element) && element !== shellElement) {
        resizeObserver.unobserve(element);
      }
    }

    for (const element of nextElements) {
      if (!observedZoneElements.has(element)) {
        resizeObserver.observe(element);
      }
    }

    observedZoneElements = nextElements;
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

  function updateGeometry(): void {
    const shell = shellElement;

    if (!shell) {
      isActive = false;
      usesBrightVisualizerPalette = false;
      clipRects = [];
      layerStyle = '';
      return;
    }

    const zoneElements = getVisibleZoneElements();
    syncObservedZoneElements(zoneElements);

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
    shellElement = hostElement?.closest('.app-shell') as HTMLElement | null;

    if (!shellElement || typeof window === 'undefined') {
      return;
    }

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(scheduleGeometryRefresh);
      resizeObserver.observe(shellElement);
    }

    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(scheduleGeometryRefresh);
      mutationObserver.observe(shellElement, {
        attributes: true,
        attributeFilter: ['class', 'data-visualizer-zone', 'data-backdrop-zone-id', 'hidden', 'style'],
        childList: true,
        subtree: true
      });
    }

    window.addEventListener('resize', scheduleGeometryRefresh);
    scheduleGeometryRefresh();

    return () => {
      window.removeEventListener('resize', scheduleGeometryRefresh);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();

      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  });

  $: if (geometryKey !== lastGeometryKey) {
    lastGeometryKey = geometryKey;
    scheduleGeometryRefresh();
  }

  onDestroy(() => {
    if (typeof window !== 'undefined' && animationFrame !== null) {
      window.cancelAnimationFrame(animationFrame);
    }

    if (typeof window !== 'undefined' && refreshFrame !== null) {
      window.cancelAnimationFrame(refreshFrame);
    }

    if (refreshTimer !== null) {
      clearTimeout(refreshTimer);
    }
  });
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
