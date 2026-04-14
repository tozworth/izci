<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { onDestroy } from 'svelte';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import { windowControlsOverlayState } from '$lib/services/window-controls-overlay';
  import type { MenuActionItem } from '$lib/types';

  type MenuId = 'file' | 'view';
  type MenuActionId = 'openFiles' | 'openFolder' | 'openOptions' | 'exit';

  const COMPACT_MENU_MAX_WIDTH = 400;

  const FILE_MENU_ITEMS: MenuActionItem[] = [
    {
      id: 'openFiles',
      label: 'Open files...',
      icon: 'file_open',
      shortcut: 'Ctrl+O'
    },
    {
      id: 'openFolder',
      label: 'Open folder...',
      icon: 'folder_open'
    },
    {
      id: 'exit',
      label: 'Exit',
      icon: 'logout',
      shortcut: 'Ctrl+Q',
      separatorBefore: true
    }
  ];

  const VIEW_MENU_ITEMS: MenuActionItem[] = [
    {
      id: 'openOptions',
      label: 'Options...',
      icon: 'settings',
      shortcut: 'Ctrl+P'
    }
  ];

  const COMPACT_MENU_ITEMS: MenuActionItem[] = [
    {
      id: 'file',
      label: 'File',
      icon: 'folder',
      children: FILE_MENU_ITEMS
    },
    {
      id: 'view',
      label: 'View',
      icon: 'visibility',
      children: VIEW_MENU_ITEMS
    }
  ];

  const dispatch = createEventDispatcher<{
    openFiles: void;
    openFolder: void;
    openOptions: void;
    exit: void;
  }>();

  let activeMenu: MenuId | null = null;
  let compactMenuOpen = false;
  let compactMenuX = 8;
  let compactMenuY = 8;
  let menuBarElement: HTMLElement | null = null;
  let compactMenuTriggerElement: HTMLButtonElement | null = null;
  let menuBarWidth = Number.POSITIVE_INFINITY;
  let availableTitlebarWidth = Number.POSITIVE_INFINITY;
  let resizeObserver: ResizeObserver | null = null;
  let observedMenuBarElement: HTMLElement | null = null;

  $: overlayState = $windowControlsOverlayState;
  $: overlayRect = overlayState.titlebarAreaRect;
  $: overlayInlineStyle = overlayState.visible
    ? `--window-controls-overlay-x: ${overlayRect.x}px; --window-controls-overlay-y: ${overlayRect.y}px; --window-controls-overlay-width: ${overlayRect.width}px; --window-controls-overlay-height: ${overlayRect.height}px;`
    : '';
  $: availableTitlebarWidth = overlayState.visible
    ? Math.max(0, overlayRect.width)
    : menuBarWidth;
  $: isCompactMenu = availableTitlebarWidth < COMPACT_MENU_MAX_WIDTH;
  $: if (isCompactMenu) {
    activeMenu = null;
  } else {
    compactMenuOpen = false;
  }

  function syncMenuBarElement() {
    if (resizeObserver && observedMenuBarElement && observedMenuBarElement !== menuBarElement) {
      resizeObserver.unobserve(observedMenuBarElement);
      observedMenuBarElement = null;
    }

    if (!menuBarElement || typeof ResizeObserver === 'undefined') {
      menuBarWidth = menuBarElement?.clientWidth ?? Number.POSITIVE_INFINITY;
      return;
    }

    resizeObserver ??= new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      menuBarWidth = entry.contentRect.width;
    });

    if (observedMenuBarElement !== menuBarElement) {
      resizeObserver.observe(menuBarElement);
      observedMenuBarElement = menuBarElement;
    }

    menuBarWidth = menuBarElement.clientWidth;
  }

  $: if (menuBarElement) {
    syncMenuBarElement();
  }

  function toggleMenu(menuId: MenuId) {
    compactMenuOpen = false;
    activeMenu = activeMenu === menuId ? null : menuId;
  }

  function closeMenus() {
    activeMenu = null;
    compactMenuOpen = false;
  }

  function handleMenuHover(menuId: MenuId) {
    if (isCompactMenu) {
      return;
    }

    if (activeMenu !== null && activeMenu !== menuId) {
      activeMenu = menuId;
    }
  }

  function handleWindowPointerDown(event: PointerEvent) {
    if (!menuBarElement || (activeMenu === null && !compactMenuOpen)) {
      return;
    }

    const target = event.target;

    if (!(target instanceof Element)) {
      closeMenus();
      return;
    }

    if (target.closest('[data-menu-interactive="true"]')) {
      return;
    }

    closeMenus();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      closeMenus();
    }
  }

  function runMenuAction(action: MenuActionId) {
    closeMenus();
    dispatch(action);
  }

  function toggleCompactMenu() {
    if (!compactMenuTriggerElement) {
      compactMenuOpen = !compactMenuOpen;
      return;
    }

    const nextOpen = !compactMenuOpen;
    compactMenuOpen = nextOpen;
    activeMenu = null;

    if (!nextOpen) {
      return;
    }

    const rect = compactMenuTriggerElement.getBoundingClientRect();
    compactMenuX = rect.left;
    compactMenuY = rect.bottom + 6;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', handleWindowPointerDown);
    window.addEventListener('keydown', handleWindowKeydown);
  }

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', handleWindowPointerDown);
      window.removeEventListener('keydown', handleWindowKeydown);
    }

    resizeObserver?.disconnect();
  });
</script>

<nav
  bind:this={menuBarElement}
  class="menu-bar"
  class:window-controls-overlay-active={overlayState.visible}
  class:menu-bar-compact={isCompactMenu}
  style={overlayInlineStyle}
  aria-label="Application menu"
>
  {#if isCompactMenu}
    <button
      bind:this={compactMenuTriggerElement}
      class="menu-trigger compact-menu-trigger"
      data-menu-interactive="true"
      type="button"
      aria-haspopup="menu"
      aria-expanded={compactMenuOpen}
      on:click={toggleCompactMenu}
    >
      <strong>izci</strong>
      <span class="material-symbols-outlined compact-menu-chevron" aria-hidden="true">
        {compactMenuOpen ? 'expand_less' : 'expand_more'}
      </span>
    </button>

    {#if compactMenuOpen}
      <MenuSurface
        items={COMPACT_MENU_ITEMS}
        x={compactMenuX}
        y={compactMenuY}
        ariaLabel="Application menu"
        enableOverflowSubmenuFallback={true}
        on:action={(event) => runMenuAction(event.detail as MenuActionId)}
        on:dismiss={closeMenus}
      />
    {/if}
  {:else}
    <div class="menu-groups">
      <div class="menu-root" role="none" on:pointerenter={() => handleMenuHover('file')}>
        <button
          class:active={activeMenu === 'file'}
          class="menu-trigger"
          data-menu-interactive="true"
          type="button"
          aria-haspopup="menu"
          aria-expanded={activeMenu === 'file'}
          on:click={() => toggleMenu('file')}
        >
          File
        </button>
        {#if activeMenu === 'file'}
          <div class="menu-list" data-menu-interactive="true" role="menu" aria-label="File">
            {#each FILE_MENU_ITEMS as item}
              {#if item.separatorBefore}
                <div class="menu-separator" role="separator" aria-hidden="true"></div>
              {/if}
              <button type="button" role="menuitem" on:click={() => runMenuAction(item.id as MenuActionId)}>
                <span class="material-symbols-outlined menu-item-icon" aria-hidden="true">{item.icon ?? 'label'}</span>
                <span class="menu-item-label">{item.label}</span>
                <span class="menu-item-shortcut" aria-hidden="true">{item.shortcut ?? ''}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="menu-root" role="none" on:pointerenter={() => handleMenuHover('view')}>
        <button
          class:active={activeMenu === 'view'}
          class="menu-trigger"
          data-menu-interactive="true"
          type="button"
          aria-haspopup="menu"
          aria-expanded={activeMenu === 'view'}
          on:click={() => toggleMenu('view')}
        >
          View
        </button>
        {#if activeMenu === 'view'}
          <div class="menu-list" data-menu-interactive="true" role="menu" aria-label="View">
            {#each VIEW_MENU_ITEMS as item}
              {#if item.separatorBefore}
                <div class="menu-separator" role="separator" aria-hidden="true"></div>
              {/if}
              <button type="button" role="menuitem" on:click={() => runMenuAction(item.id as MenuActionId)}>
                <span class="material-symbols-outlined menu-item-icon" aria-hidden="true">{item.icon ?? 'label'}</span>
                <span class="menu-item-label">{item.label}</span>
                <span class="menu-item-shortcut" aria-hidden="true">{item.shortcut ?? ''}</span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    {#if !overlayState.visible}
      <div class="menu-brand" aria-label="Application version">
        <strong>izci</strong>
        <span>260322</span>
      </div>
    {/if}
  {/if}
</nav>
