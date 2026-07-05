<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  export let artworkUrl: string | undefined = undefined;
  export let geometryKey = '';

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
  let refreshFrame: number | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let layerRevealFrame: number | null = null;
  let layerCleanupTimer: ReturnType<typeof setTimeout> | null = null;
  let artworkDecodeToken = 0;
  let observedZoneElements = new Set<Element>();
  let clipRects: ArtworkClipRect[] = [];
  let layerStyle = '';
  let artworkLayers: ArtworkLayer[] = [];
  let currentArtworkUrl = '';
  let lastGeometryKey = '';
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
    const width = Math.max(1, shellRect.width);
    const height = Math.max(1, shellRect.height);

    clipRects = zoneElements.map((element, index) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left - shellRect.left;
      const y = rect.top - shellRect.top;
      const zoneId = element.dataset.backdropZoneId ?? `${index}`;
      const zoneStyle = window.getComputedStyle(element);
      const artworkBlur = zoneStyle.getPropertyValue('--shared-zone-artwork-blur').trim() || '36px';
      const artworkBrightness =
        zoneStyle.getPropertyValue('--shared-zone-artwork-brightness').trim() || '0.42';
      const bright =
        element.classList.contains('artwork-backdrop-bright') ||
        element.classList.contains('artwork-background-bright');

      return {
        key: `${zoneId}:${Math.round(x)}:${Math.round(y)}:${Math.round(rect.width)}:${Math.round(rect.height)}`,
        bright,
        style: [
          `left: ${x}px`,
          `top: ${y}px`,
          `width: ${rect.width}px`,
          `height: ${rect.height}px`,
          `--shared-artwork-blur: ${artworkBlur}`,
          `--shared-artwork-brightness: ${artworkBrightness}`
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
      'left: 0px',
      'top: 0px',
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
      scheduleGeometryRefresh();
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
      scheduleGeometryRefresh();
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

    scheduleGeometryRefresh();
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
        attributeFilter: ['class', 'data-artwork-zone', 'data-backdrop-zone-id', 'hidden', 'style'],
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

  $: syncArtworkLayers(artworkUrl);
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
