<script lang="ts">
  import { afterUpdate, createEventDispatcher } from 'svelte';
  import { onMount } from 'svelte';
  import type { MenuActionItem } from '$lib/types';
  import { portal } from '$lib/components/playlist-panel/actions/portal';
  import { windowDismiss } from '$lib/components/playlist-panel/actions/window-dismiss';

  export let items: MenuActionItem[] = [];
  export let x = 0;
  export let y = 0;
  export let ariaLabel = 'Menu';
  export let nested = false;
  export let enableOverflowSubmenuFallback = false;

  type MenuLevel = {
    label: string;
    items: MenuActionItem[];
  };

  const dispatch = createEventDispatcher<{
    action: string;
    dismiss: void;
  }>();

  let menuElement: HTMLDivElement | null = null;
  let activeSubmenuId: string | null = null;
  let resolvedX = x;
  let resolvedY = y;
  let shouldUseSubmenuDrilldown = false;
  let navigationStack: MenuLevel[] = [];

  $: currentLevel = navigationStack[navigationStack.length - 1] ?? null;
  $: displayedItems = currentLevel?.items ?? items;
  $: resolvedAriaLabel = currentLevel?.label ?? ariaLabel;
  $: canShowHoverSubmenus = nested || !shouldUseSubmenuDrilldown;

  function closeSubmenu() {
    activeSubmenuId = null;
  }

  function openSubmenu(item: MenuActionItem) {
    if (!canShowHoverSubmenus) {
      return;
    }

    activeSubmenuId = item.children?.length ? item.id : null;
  }

  function enterSubmenu(item: MenuActionItem) {
    if (!item.children?.length) {
      return;
    }

    navigationStack = [...navigationStack, { label: item.label, items: item.children }];
    activeSubmenuId = null;
  }

  function goBack() {
    navigationStack = navigationStack.slice(0, -1);
    activeSubmenuId = null;
  }

  function handleItemClick(item: MenuActionItem) {
    if (item.children?.length) {
      if (canShowHoverSubmenus) {
        activeSubmenuId = activeSubmenuId === item.id ? null : item.id;
        return;
      }

      enterSubmenu(item);
      return;
    }

    dispatch('action', item.id);
    dispatch('dismiss');
  }

  function updateRootLayout() {
    if (nested || !menuElement || typeof window === 'undefined') {
      return;
    }

    const padding = 8;
    const maxX = Math.max(padding, window.innerWidth - menuElement.offsetWidth - padding);
    const maxY = Math.max(padding, window.innerHeight - menuElement.offsetHeight - padding);

    resolvedX = Math.max(padding, Math.min(x, maxX));
    resolvedY = Math.max(padding, Math.min(y, maxY));

    if (!enableOverflowSubmenuFallback) {
      shouldUseSubmenuDrilldown = false;
      return;
    }

    const hasChildMenus = items.some((item) => (item.children?.length ?? 0) > 0);
    const minimumSubmenuWidth = 208;
    shouldUseSubmenuDrilldown =
      hasChildMenus && resolvedX + menuElement.offsetWidth + minimumSubmenuWidth + padding > window.innerWidth;
  }

  $: resolvedX = x;
  $: resolvedY = y;
  $: if (!shouldUseSubmenuDrilldown && navigationStack.length > 0) {
    navigationStack = [];
  }

  afterUpdate(() => {
    updateRootLayout();
  });

  onMount(() => {
    if (nested || typeof window === 'undefined') {
      return undefined;
    }

    const handleWindowResize = () => {
      updateRootLayout();
    };

    window.addEventListener('resize', handleWindowResize);

    return () => {
      window.removeEventListener('resize', handleWindowResize);
    };
  });
</script>

{#if nested}
  <div bind:this={menuElement} class="menu-list menu-surface menu-surface-nested" role="menu" aria-label={resolvedAriaLabel}>
    {#each displayedItems as item (item.id)}
      {#if item.separatorBefore}
        <div class="menu-separator" role="separator" aria-hidden="true"></div>
      {/if}

      <div class="menu-entry-group" role="none" on:pointerenter={() => openSubmenu(item)}>
        <button
          type="button"
          role="menuitem"
          class:submenu-open={activeSubmenuId === item.id}
          class:menu-item-parent={item.children?.length}
          aria-haspopup={item.children?.length ? 'menu' : undefined}
          aria-expanded={item.children?.length ? activeSubmenuId === item.id : undefined}
          on:click={() => handleItemClick(item)}
        >
          <span class="material-symbols-outlined menu-item-icon" aria-hidden="true">{item.icon ?? 'label'}</span>
          <span class="menu-item-label">{item.label}</span>
          {#if item.children?.length}
            <span class="material-symbols-outlined menu-item-chevron" aria-hidden="true">chevron_right</span>
          {:else}
            <span class="menu-item-shortcut" aria-hidden="true">{item.shortcut ?? ''}</span>
          {/if}
        </button>

        {#if item.children?.length && activeSubmenuId === item.id}
          <svelte:self
            nested
            items={item.children}
            ariaLabel={item.label}
            on:action={(event) => dispatch('action', event.detail)}
            on:dismiss={() => dispatch('dismiss')}
          />
        {/if}
      </div>
    {/each}
  </div>
{:else}
  <div
    bind:this={menuElement}
    class="menu-list menu-surface"
    use:portal
    use:windowDismiss={{ enabled: true, onDismiss: () => dispatch('dismiss') }}
    role="menu"
    aria-label={resolvedAriaLabel}
    style={`left: ${resolvedX}px; top: ${resolvedY}px;`}
  >
    {#if shouldUseSubmenuDrilldown && navigationStack.length > 0}
      <button type="button" role="menuitem" class="menu-back-button" on:click={goBack}>
        <span class="material-symbols-outlined menu-item-icon" aria-hidden="true">arrow_back</span>
        <span class="menu-item-label">Back</span>
        <span class="menu-item-shortcut" aria-hidden="true"></span>
      </button>
      <div class="menu-separator" role="separator" aria-hidden="true"></div>
    {/if}

    {#each displayedItems as item (item.id)}
      {#if item.separatorBefore}
        <div class="menu-separator" role="separator" aria-hidden="true"></div>
      {/if}

      <div class="menu-entry-group" role="none" on:pointerenter={() => openSubmenu(item)}>
        <button
          type="button"
          role="menuitem"
          class:submenu-open={activeSubmenuId === item.id}
          class:menu-item-parent={item.children?.length}
          class:menu-item-drilldown={shouldUseSubmenuDrilldown && item.children?.length}
          aria-haspopup={item.children?.length ? 'menu' : undefined}
          aria-expanded={item.children?.length ? activeSubmenuId === item.id : undefined}
          on:click={() => handleItemClick(item)}
        >
          <span class="material-symbols-outlined menu-item-icon" aria-hidden="true">{item.icon ?? 'label'}</span>
          <span class="menu-item-label">{item.label}</span>
          {#if item.children?.length}
            <span class="material-symbols-outlined menu-item-chevron" aria-hidden="true">
              {shouldUseSubmenuDrilldown ? 'chevron_right' : 'chevron_right'}
            </span>
          {:else}
            <span class="menu-item-shortcut" aria-hidden="true">{item.shortcut ?? ''}</span>
          {/if}
        </button>

        {#if canShowHoverSubmenus && item.children?.length && activeSubmenuId === item.id}
          <svelte:self
            nested
            items={item.children}
            ariaLabel={item.label}
            on:action={(event) => dispatch('action', event.detail)}
            on:dismiss={() => dispatch('dismiss')}
          />
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .menu-surface {
    position: fixed;
    z-index: 60;
  }

  .menu-surface-nested {
    position: absolute;
    top: -0.3rem;
    left: calc(100% + 0.2rem);
    z-index: 1;
  }

  .menu-entry-group {
    position: relative;
  }

  .menu-item-chevron {
    min-width: 1rem;
    color: var(--muted);
    font-size: 1rem;
    text-align: right;
  }

  .menu-item-parent,
  .menu-back-button,
  .menu-item-drilldown {
    cursor: pointer;
  }

  .submenu-open,
  .menu-back-button:hover {
    background: var(--accent-soft);
  }
</style>
