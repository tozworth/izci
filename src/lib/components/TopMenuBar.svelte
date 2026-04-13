<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { onDestroy } from 'svelte';
  import { windowControlsOverlayState } from '$lib/services/window-controls-overlay';

  type MenuId = 'file' | 'view';

  const dispatch = createEventDispatcher<{
    openFiles: void;
    openFolder: void;
    openOptions: void;
    exit: void;
  }>();

  let activeMenu: MenuId | null = null;
  let menuBarElement: HTMLElement | null = null;

  $: overlayState = $windowControlsOverlayState;
  $: overlayRect = overlayState.titlebarAreaRect;
  $: overlayInlineStyle = overlayState.visible
    ? `--window-controls-overlay-x: ${overlayRect.x}px; --window-controls-overlay-y: ${overlayRect.y}px; --window-controls-overlay-width: ${overlayRect.width}px; --window-controls-overlay-height: ${overlayRect.height}px;`
    : '';

  function openMenu(menuId: MenuId) {
    activeMenu = menuId;
  }

  function toggleMenu(menuId: MenuId) {
    activeMenu = activeMenu === menuId ? null : menuId;
  }

  function closeMenu() {
    activeMenu = null;
  }

  function handleMenuHover(menuId: MenuId) {
    if (activeMenu !== null && activeMenu !== menuId) {
      activeMenu = menuId;
    }
  }

  function handleWindowPointerDown(event: PointerEvent) {
    if (!menuBarElement) {
      return;
    }

    const target = event.target;

    if (target instanceof Node && !menuBarElement.contains(target)) {
      closeMenu();
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      closeMenu();
    }
  }

  function runMenuAction(action: 'openFiles' | 'openFolder' | 'openOptions' | 'exit') {
    closeMenu();
    dispatch(action);
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
  });
</script>

<nav
  bind:this={menuBarElement}
  class="menu-bar"
  class:window-controls-overlay-active={overlayState.visible}
  style={overlayInlineStyle}
  aria-label="Application menu"
>
  <div class="menu-groups">
    <div class="menu-root" role="none" on:pointerenter={() => handleMenuHover('file')}>
      <button
        class:active={activeMenu === 'file'}
        class="menu-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={activeMenu === 'file'}
        on:click={() => toggleMenu('file')}
      >
        File
      </button>
      {#if activeMenu === 'file'}
        <div class="menu-list" role="menu" aria-label="File">
          <button type="button" role="menuitem" on:click={() => runMenuAction('openFiles')}>
            <span class="material-symbols-outlined menu-item-icon" aria-hidden="true">file_open</span>
            <span class="menu-item-label">Open files...</span>
            <span class="menu-item-shortcut" aria-hidden="true">Ctrl+O</span>
          </button>
          <button type="button" role="menuitem" on:click={() => runMenuAction('openFolder')}>
            <span class="material-symbols-outlined menu-item-icon" aria-hidden="true">folder_open</span>
            <span class="menu-item-label">Open folder...</span>
          </button>
          <button type="button" role="menuitem" on:click={() => runMenuAction('exit')}>
            <span class="material-symbols-outlined menu-item-icon" aria-hidden="true">logout</span>
            <span class="menu-item-label">Exit</span>
            <span class="menu-item-shortcut" aria-hidden="true">Ctrl+Q</span>
          </button>
        </div>
      {/if}
    </div>

    <div class="menu-root" role="none" on:pointerenter={() => handleMenuHover('view')}>
      <button
        class:active={activeMenu === 'view'}
        class="menu-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={activeMenu === 'view'}
        on:click={() => toggleMenu('view')}
      >
        View
      </button>
      {#if activeMenu === 'view'}
        <div class="menu-list" role="menu" aria-label="View">
          <button type="button" role="menuitem" on:click={() => runMenuAction('openOptions')}>
            <span class="material-symbols-outlined menu-item-icon" aria-hidden="true">settings</span>
            <span class="menu-item-label">Options...</span>
            <span class="menu-item-shortcut" aria-hidden="true">Ctrl+P</span>
          </button>
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
</nav>
