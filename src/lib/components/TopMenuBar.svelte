<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { onDestroy } from 'svelte';

  type MenuId = 'file' | 'view';

  const dispatch = createEventDispatcher<{
    openFiles: void;
    openOptions: void;
    exit: void;
  }>();

  let activeMenu: MenuId | null = null;
  let menuBarElement: HTMLElement | null = null;

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

  function runMenuAction(action: 'openFiles' | 'openOptions' | 'exit') {
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

<nav bind:this={menuBarElement} class="menu-bar" aria-label="Application menu">
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
            <span>Open...</span>
          </button>
          <button type="button" role="menuitem" on:click={() => runMenuAction('exit')}>
            <span>Exit</span>
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
            <span>Options...</span>
          </button>
        </div>
      {/if}
    </div>
  </div>

  <div class="menu-brand" aria-label="Application version">
    <strong>izci</strong>
    <span>v0.1</span>
  </div>
</nav>
