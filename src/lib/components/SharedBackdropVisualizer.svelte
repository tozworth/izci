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
    const width = Math.max(1, shellRect.width);
    const height = Math.max(1, shellRect.height);

    clipRects = zoneRects.map((rect) => ({
      x: rect.left - shellRect.left,
      y: rect.top - shellRect.top,
      width: rect.width,
      height: rect.height
    }));
    layerStyle = [
      'left: 0px',
      'top: 0px',
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
