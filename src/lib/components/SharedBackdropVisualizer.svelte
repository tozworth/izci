<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import PlayerVisualizer from '$lib/components/PlayerVisualizer.svelte';

  export let artworkUrl: string | undefined = undefined;

  interface VisualizerClipRect {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  const VISUALIZER_ZONE_SELECTOR = '[data-visualizer-zone="true"]';

  let hostElement: HTMLElement | null = null;
  let shellElement: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let animationFrame: number | null = null;
  let observedZoneElements = new Set<Element>();
  let clipRects: VisualizerClipRect[] = [];
  let layerStyle = '';
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
    const left = Math.min(...zoneRects.map((rect) => rect.left));
    const top = Math.min(...zoneRects.map((rect) => rect.top));
    const right = Math.max(...zoneRects.map((rect) => rect.right));
    const bottom = Math.max(...zoneRects.map((rect) => rect.bottom));
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);

    clipRects = zoneRects.map((rect) => ({
      x: rect.left - left,
      y: rect.top - top,
      width: rect.width,
      height: rect.height
    }));
    layerStyle = [
      `left: ${left - shellRect.left}px`,
      `top: ${top - shellRect.top}px`,
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
      resizeObserver = new ResizeObserver(scheduleGeometryUpdate);
      resizeObserver.observe(shellElement);
    }

    if (typeof MutationObserver !== 'undefined') {
      mutationObserver = new MutationObserver(scheduleGeometryUpdate);
      mutationObserver.observe(shellElement, {
        attributes: true,
        attributeFilter: ['class', 'data-visualizer-zone', 'hidden', 'style'],
        childList: true,
        subtree: true
      });
    }

    window.addEventListener('resize', scheduleGeometryUpdate);
    scheduleGeometryUpdate();

    return () => {
      window.removeEventListener('resize', scheduleGeometryUpdate);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();

      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  });

  onDestroy(() => {
    if (typeof window !== 'undefined' && animationFrame !== null) {
      window.cancelAnimationFrame(animationFrame);
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
      <PlayerVisualizer {artworkUrl} {clipRects} />
    </div>
  {/if}
</div>
