<script lang="ts">
  import { t } from 'svelte-i18n';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import { libraryViewSettings } from '$lib/stores/library-view-settings';
  import type { LibraryBrowserLayout, LibraryViewId, MenuActionItem } from '$lib/types';

  export let view: LibraryViewId;
  export let layout: LibraryBrowserLayout = 'list';
  let menu: { x: number; y: number } | null = null;
  $: tileSize = $libraryViewSettings.views[view].tileSize;
  $: icon = layout === 'grid' ? 'grid_view' : layout === 'gallery' ? 'view_quilt' : 'view_list';
  $: items = [
    { id: 'list', label: $t('library.layout.list', { default: 'List' }), icon: 'view_list', checked: layout === 'list' },
    { id: 'grid', label: $t('library.layout.grid', { default: 'Artwork grid' }), icon: 'grid_view', checked: layout === 'grid' },
    ...(view === 'images' || view === 'videos'
      ? [{ id: 'gallery', label: $t('library.layout.gallery', { default: 'Gallery' }), icon: 'view_quilt', checked: layout === 'gallery' }]
      : []),
    ...(layout !== 'list' ? [
      { id: 'smaller', label: $t('library.layout.smaller', { default: 'Smaller thumbnails' }), icon: 'zoom_out', disabled: tileSize <= 80, separatorBefore: true },
      { id: 'larger', label: $t('library.layout.larger', { default: 'Larger thumbnails' }), icon: 'zoom_in', disabled: tileSize >= 256 }
    ] : [])
  ] satisfies MenuActionItem[];

  function toggleMenu(event: MouseEvent) {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    menu = menu ? null : { x: rect.left, y: rect.bottom };
  }

  function select(id: string) {
    if (id === 'smaller' || id === 'larger') libraryViewSettings.adjustTileSize(id === 'smaller' ? -24 : 24, view);
    else if (id === 'list' || id === 'grid' || id === 'gallery') libraryViewSettings.setLayout(id, view);
  }
</script>

<button
  type="button"
  class="library-layout-button hover-tooltip-anchor"
  aria-label={$t('library.layout.label', { default: 'Library layout' })}
  aria-haspopup="menu"
  aria-expanded={Boolean(menu)}
  on:click={toggleMenu}
>
  <span class="material-symbols-outlined" aria-hidden="true">{icon}</span>
  <HoverTooltip>{$t('library.layout.label', { default: 'Library layout' })}</HoverTooltip>
</button>

{#if menu}
  <MenuSurface {items} x={menu.x} y={menu.y}
    ariaLabel={$t('library.layout.label', { default: 'Library layout' })}
    on:action={(event) => select(event.detail)} on:dismiss={() => menu = null} />
{/if}

<style>
  .library-layout-button {
    position: relative;
    display: grid;
    place-items: center;
    flex-shrink: 0;
    width: 1.4rem;
    height: 1.65rem;
    padding: 0;
    border: 1px solid transparent;
    border-radius: 0.3rem;
    background: transparent;
    color: var(--muted);
    cursor: default;
  }
  .library-layout-button:hover, .library-layout-button[aria-expanded='true'] {
    background: var(--accent-strong-soft);
    color: var(--accent-strong);
  }
  .material-symbols-outlined { font-size: 1rem; }
  @container (max-width: 13rem) { .library-layout-button { width: 1.3rem; } }
</style>
