<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  export let artworkUrl: string | undefined = undefined;

  interface ArtworkClipRect {
    key: string;
    bright: boolean;
    style: string;
    surfaceStyle: string;
  }

  interface ArtworkLayer {
    id: string;
    url: string;
    visible: boolean;
  }

  const ARTWORK_ZONE_SELECTOR = '[data-artwork-zone="true"]';
  const ARTWORK_LAYER_CLEANUP_MS = 360;

  let hostElement: HTMLElement | null = null;
  let shellElement: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let animationFrame: number | null = null;
  let layerRevealFrame: number | null = null;
  let layerCleanupTimer: ReturnType<typeof setTimeout> | null = null;
  let artworkDecodeToken = 0;
  let observedZoneElements = new Set<Element>();
  let clipRects: ArtworkClipRect[] = [];
  let layerStyle = '';
  let artworkLayers: ArtworkLayer[] = [];
  let currentArtworkUrl = '';
  let isActive = false;

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

    return Array.from(shell.querySelectorAll<HTMLElement>(ARTWORK_ZONE_SELECTOR)).filter((element) => {
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

    if (!shell || artworkLayers.length === 0) {
      isActive = false;
      clipRects = [];
      layerStyle = '';
      return;
    }

    const zoneElements = getVisibleZoneElements();
    syncObservedZoneElements(zoneElements);

    if (zoneElements.length === 0) {
      isActive = false;
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

    clipRects = zoneElements.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left - left;
      const y = rect.top - top;
      const bright =
        element.classList.contains('artwork-backdrop-bright') ||
        element.classList.contains('artwork-background-bright');

      return {
        key: `${index}:${Math.round(x)}:${Math.round(y)}:${Math.round(rect.width)}:${Math.round(rect.height)}`,
        bright,
        style: [
          `left: ${x}px`,
          `top: ${y}px`,
          `width: ${rect.width}px`,
          `height: ${rect.height}px`
        ].join('; '),
        surfaceStyle: [
          `left: ${-x}px`,
          `top: ${-y}px`,
          `width: ${width}px`,
          `height: ${height}px`
        ].join('; ')
      };
    });
    layerStyle = [
      `left: ${left - shellRect.left}px`,
      `top: ${top - shellRect.top}px`,
      `width: ${width}px`,
      `height: ${height}px`
    ].join('; ');
    isActive = true;
  }

  function clearLayerCleanupTimer(): void {
    if (layerCleanupTimer === null) {
      return;
    }

    clearTimeout(layerCleanupTimer);
    layerCleanupTimer = null;
  }

  function clearLayerRevealFrame(): void {
    if (typeof window === 'undefined' || layerRevealFrame === null) {
      return;
    }

    window.cancelAnimationFrame(layerRevealFrame);
    layerRevealFrame = null;
  }

  function scheduleLayerCleanup(): void {
    clearLayerCleanupTimer();

    if (!artworkLayers.some((layer) => !layer.visible)) {
      return;
    }

    layerCleanupTimer = setTimeout(() => {
      layerCleanupTimer = null;
      artworkLayers = artworkLayers.filter((layer) => layer.visible);
      scheduleGeometryUpdate();
    }, ARTWORK_LAYER_CLEANUP_MS);
  }

  function revealArtworkLayer(url: string): void {
    if (typeof window === 'undefined') {
      artworkLayers = artworkLayers.map((layer) =>
        layer.url === url ? { ...layer, visible: true } : { ...layer, visible: false }
      );
      scheduleLayerCleanup();
      return;
    }

    clearLayerRevealFrame();
    layerRevealFrame = window.requestAnimationFrame(() => {
      layerRevealFrame = null;
      artworkLayers = artworkLayers.map((layer) =>
        layer.url === url ? { ...layer, visible: true } : { ...layer, visible: false }
      );
      scheduleLayerCleanup();
    });
  }

  async function waitForArtworkDecode(url: string): Promise<void> {
    if (typeof window === 'undefined' || typeof Image === 'undefined') {
      return;
    }

    const image = new Image();
    image.decoding = 'async';
    image.src = url;

    if (typeof image.decode === 'function') {
      await image.decode();
      return;
    }

    if (image.complete) {
      return;
    }

    await new Promise<void>((resolve) => {
      image.onload = () => resolve();
      image.onerror = () => resolve();
    });
  }

  async function revealArtworkLayerAfterDecode(url: string): Promise<void> {
    const decodeToken = ++artworkDecodeToken;

    try {
      await waitForArtworkDecode(url);
    } catch {
      // A failed decode should not strand the backdrop on the previous track.
    }

    if (decodeToken !== artworkDecodeToken || currentArtworkUrl !== url) {
      return;
    }

    revealArtworkLayer(url);
  }

  function toArtworkLayerStyle(url: string): string {
    return `${layerStyle}; --shared-artwork-image: url("${url}")`;
  }

  function syncArtworkLayers(nextArtworkUrl: string | undefined): void {
    const nextUrl = nextArtworkUrl ?? '';

    if (nextUrl === currentArtworkUrl) {
      return;
    }

    currentArtworkUrl = nextUrl;
    artworkDecodeToken += 1;
    clearLayerRevealFrame();

    if (!nextUrl) {
      artworkLayers = artworkLayers.map((layer) => ({ ...layer, visible: false }));
      scheduleLayerCleanup();
      scheduleGeometryUpdate();
      return;
    }

    const existingLayer = artworkLayers.find((layer) => layer.url === nextUrl);
    const preservedLayers = artworkLayers.filter((layer) => layer.url !== nextUrl);

    if (existingLayer) {
      artworkLayers = [...preservedLayers, existingLayer];
      void revealArtworkLayerAfterDecode(nextUrl);
    } else {
      artworkLayers = [...preservedLayers, { id: nextUrl, url: nextUrl, visible: false }];
      void revealArtworkLayerAfterDecode(nextUrl);
    }

    scheduleGeometryUpdate();
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
        attributeFilter: ['class', 'data-artwork-zone', 'hidden', 'style'],
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

  $: syncArtworkLayers(artworkUrl);

  onDestroy(() => {
    if (typeof window !== 'undefined' && animationFrame !== null) {
      window.cancelAnimationFrame(animationFrame);
    }

    clearLayerRevealFrame();
    clearLayerCleanupTimer();
  });
</script>

<div bind:this={hostElement} class="shared-artwork-host" aria-hidden="true">
  {#if isActive}
    {#each artworkLayers as layer (layer.id)}
      <div
        class="shared-artwork-layer"
        class:artwork-layer-visible={layer.visible}
        style={toArtworkLayerStyle(layer.url)}
      >
        {#each clipRects as clipRect (clipRect.key)}
          <div
            class="shared-artwork-zone"
            class:artwork-backdrop-bright={clipRect.bright}
            style={clipRect.style}
          >
            <div class="shared-artwork-zone-image" style={clipRect.surfaceStyle}></div>
            <div class="shared-artwork-zone-overlay"></div>
          </div>
        {/each}
      </div>
    {/each}
  {/if}
</div>
