<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import type { MenuActionItem } from '$lib/types';

  type ImageFitMode = 'contain' | 'cover';

  export let element: HTMLImageElement | null = null;
  export let parkingHost: HTMLDivElement | null = null;
  export let fitMode: ImageFitMode = 'contain';

  const dispatch = createEventDispatcher<{
    toggleTheater: void;
    setFit: ImageFitMode;
  }>();

  let host: HTMLDivElement | null = null;
  let attachedElement: HTMLImageElement | null = null;
  let contextMenuOpen = false;
  let contextMenuX = 0;
  let contextMenuY = 0;

  $: contextMenuItems = [
    {
      id: 'contain',
      label: $t('main.image.fit', { default: 'Fit to window' }),
      icon: fitMode === 'contain' ? 'check' : 'fit_screen'
    },
    {
      id: 'cover',
      label: $t('main.image.fill', { default: 'Fill window' }),
      icon: fitMode === 'cover' ? 'check' : 'crop_free'
    }
  ] satisfies MenuActionItem[];

  function openContextMenu(event: MouseEvent): void {
    contextMenuX = event.clientX;
    contextMenuY = event.clientY;
    contextMenuOpen = true;
  }

  function handleContextMenuAction(action: string): void {
    contextMenuOpen = false;
    if (action === 'contain' || action === 'cover') {
      dispatch('setFit', action);
    }
  }

  function attachElement(): void {
    if (attachedElement && attachedElement !== element && attachedElement.parentElement === host) {
      parkingHost?.appendChild(attachedElement);
    }
    if (host && element && element.parentElement !== host) {
      host.appendChild(element);
    }
    attachedElement = element;
  }

  $: {
    host;
    element;
    attachElement();
  }

  onDestroy(() => {
    if (attachedElement?.parentElement === host) {
      parkingHost?.appendChild(attachedElement);
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  bind:this={host}
  class="image-stage"
  class:image-fill={fitMode === 'cover'}
  aria-label={$t('main.image.display', { default: 'Image display' })}
  on:dblclick={() => dispatch('toggleTheater')}
  on:contextmenu|preventDefault|stopPropagation={openContextMenu}
></div>

{#if contextMenuOpen}
  <MenuSurface
    items={contextMenuItems}
    x={contextMenuX}
    y={contextMenuY}
    ariaLabel={$t('main.image.menu', { default: 'Image' })}
    on:action={(event) => handleContextMenuAction(event.detail)}
    on:dismiss={() => (contextMenuOpen = false)}
  />
{/if}

<style>
  .image-stage {
    position: absolute;
    inset: 0;
    z-index: 7;
    display: grid;
    place-items: center;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: #000;
    contain: strict;
  }

  .image-stage :global(img) {
    position: relative;
    z-index: 0;
    display: block;
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    background: #000;
  }

  .image-stage.image-fill :global(img) {
    object-fit: cover;
  }
</style>
