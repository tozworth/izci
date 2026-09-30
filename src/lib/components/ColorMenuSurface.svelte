<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import HoverTooltip from './HoverTooltip.svelte';
  import type { MenuActionItem } from '$lib/types';
  import { keepMenuInViewport } from '$lib/components/track-list-panel/actions/menu-viewport';

  export let items: NonNullable<MenuActionItem['colorPicker']> = [];
  export let ariaLabel: string;
  export let nested = true;

  const dispatch = createEventDispatcher<{ action: string; dismiss: void }>();

  function select(id: string) {
    dispatch('action', id);
    dispatch('dismiss');
  }
</script>

<div
  class="color-menu-surface"
  class:color-menu-surface-nested={nested}
  use:keepMenuInViewport={nested}
  role="menu"
  aria-label={ariaLabel}
>
  {#each items as item (item.id)}
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={Boolean(item.checked)}
      aria-label={item.label}
      title={item.label}
      style={`--swatch-color: ${item.color};`}
      on:click={() => select(item.id)}
    >
      {#if item.checked}
        <span class="material-symbols-outlined" aria-hidden="true">format_color_reset</span>
      {/if}
      <HoverTooltip align="center" nowrap>{item.label}</HoverTooltip>
    </button>
  {/each}
</div>

<style>
  .color-menu-surface {
    width: max-content;
    padding: 0.36rem;
    display: grid;
    grid-template-columns: repeat(6, 1.35rem);
    gap: 0.3rem;
  }

  .color-menu-surface-nested {
    position: absolute;
    top: -0.22rem;
    left: calc(100% + 0.2rem);
    z-index: 1;
    color: var(--menu-popover-text);
    background: var(--menu-popover-bg);
    border: 1px solid var(--menu-popover-border);
    border-radius: 0;
    box-shadow: var(--menu-popover-shadow);
  }

  .color-menu-surface button {
    width: 1.35rem;
    height: 1.35rem;
    padding: 0;
    display: grid;
    place-items: center;
    border: 2px solid transparent;
    border-radius: 50%;
    background: var(--swatch-color);
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 24%);
  }

  .color-menu-surface button:hover,
  .color-menu-surface button:focus-visible {
    background: var(--swatch-color);
    border-color: #fff;
  }

  .color-menu-surface button .material-symbols-outlined {
    color: color-mix(in srgb, var(--swatch-color) 20%, #111);
    font-size: 0.9rem;
    font-weight: 600;
  }
</style>
