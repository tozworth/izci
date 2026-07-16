<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { onDestroy } from 'svelte';
  import { version as appVersion } from '../../../package.json';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import { pwaUpdateCompleted } from '$lib/services/pwa-updates';
  import { windowControlsOverlayState } from '$lib/services/window-controls-overlay';
  import type { MenuActionItem } from '$lib/types';
  import { formatDisplayVersion } from '$lib/utils/version';
  import type { OptionsViewName } from '../../options/views';

  type MenuId = 'file' | 'view' | 'help';
  type MenuActionId =
    | 'openFiles'
    | 'openFolder'
    | 'installApp'
    | 'openOptions'
    | 'forceUpdate'
    | 'openAbout'
    | 'showPlaylist'
    | 'showLibrary'
    | 'showTrackDetails'
    | 'showLyrics'
    | 'toggleMiniMode'
    | 'toggleNowPlayingView'
    | 'exit';

  const MENU_ITEMS_ONLY_PADDING = 28;
  const MENU_ITEMS_WITH_VERSION_PADDING = 40;
  const FALLBACK_MENU_GROUPS_WIDTH = 140;
  const FALLBACK_MENU_BRAND_WIDTH = 88;

  const BASE_FILE_MENU_ITEMS: MenuActionItem[] = [
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
  const HELP_MENU_ITEMS: MenuActionItem[] = [
    {
      id: 'forceUpdate',
      label: 'Force update',
      icon: 'sync'
    },
    {
      id: 'openAbout',
      label: 'About',
      icon: 'info'
    }
  ];

  export let miniModeActive = false;
  export let nowPlayingViewActive = false;
  export let installAvailable = false;
  export let showInstallHint = false;
  const displayVersion = formatDisplayVersion(appVersion);

  const dispatch = createEventDispatcher<{
    openFiles: void;
    openFolder: void;
    installApp: void;
    acknowledgeInstallHint: void;
    openOptions: { view?: OptionsViewName } | undefined;
    forceUpdate: void;
    openAbout: void;
    showPlaylist: void;
    showLibrary: void;
    showTrackDetails: void;
    showLyrics: void;
    toggleMiniMode: void;
    toggleNowPlayingView: void;
    exit: void;
  }>();

  let activeMenu: MenuId | null = null;
  let compactMenuOpen = false;
  let compactMenuX = 8;
  let compactMenuY = 8;
  let menuPopupX = 8;
  let menuPopupY = 8;
  let menuBarElement: HTMLElement | null = null;
  let compactMenuTriggerElement: HTMLButtonElement | null = null;
  let fileMenuTriggerElement: HTMLButtonElement | null = null;
  let viewMenuTriggerElement: HTMLButtonElement | null = null;
  let helpMenuTriggerElement: HTMLButtonElement | null = null;
  let menuBarWidth = Number.POSITIVE_INFINITY;
  let availableTitlebarWidth = Number.POSITIVE_INFINITY;
  let menuGroupsWidth = 0;
  let menuBrandWidth = 0;
  let menubarPressPointerId: number | null = null;
  let suppressNextRootClick = false;
  let installHintPresentedInOpenMenu = false;

  $: fileMenuItems = [
    ...BASE_FILE_MENU_ITEMS.slice(0, 2),
    ...(installAvailable
      ? [{
          id: 'installApp',
          label: 'Install izci...',
          description: showInstallHint || installHintPresentedInOpenMenu
            ? 'Install the PWA to get file associations, a compact title bar, better OS integration and automatic updates.'
            : undefined,
          icon: 'install_desktop',
          separatorBefore: true,
          attention: showInstallHint || installHintPresentedInOpenMenu
        } satisfies MenuActionItem]
      : []),
    BASE_FILE_MENU_ITEMS[2]
  ];

  $: viewMenuItems = [
    {
      id: 'showPlaylist',
      label: 'Playlist',
      icon: 'queue_music'
    },
    {
      id: 'showLibrary',
      label: 'Library',
      icon: 'library_music'
    },
    {
      id: 'showTrackDetails',
      label: 'Track Details',
      icon: 'info'
    },
    {
      id: 'showLyrics',
      label: 'Lyrics',
      icon: 'lyrics'
    },
    {
      id: 'toggleMiniMode',
      label: 'Mini mode',
      icon: miniModeActive ? 'check' : 'picture_in_picture_alt',
      shortcut: 'Ctrl+M',
      separatorBefore: true
    },
    {
      id: 'toggleNowPlayingView',
      label: 'Now Playing',
      icon: nowPlayingViewActive ? 'check' : 'album'
    },
    {
      id: 'openOptions',
      label: 'Options...',
      icon: 'settings',
      shortcut: 'Ctrl+P',
      separatorBefore: true
    }
  ] satisfies MenuActionItem[];
  $: compactMenuItems = [
    {
      id: 'file',
      label: 'File',
      icon: 'folder',
      children: fileMenuItems
    },
    {
      id: 'view',
      label: 'View',
      icon: 'visibility',
      children: viewMenuItems
    },
    {
      id: 'help',
      label: 'Help',
      icon: 'help',
      children: HELP_MENU_ITEMS
    }
  ] satisfies MenuActionItem[];

  $: overlayState = $windowControlsOverlayState;
  $: overlayRect = overlayState.titlebarAreaRect;
  $: overlayInlineStyle = overlayState.visible
    ? `--window-controls-overlay-x: ${overlayRect.x}px; --window-controls-overlay-y: ${overlayRect.y}px; --window-controls-overlay-width: ${overlayRect.width}px; --window-controls-overlay-height: ${overlayRect.height}px;`
    : '';
  $: availableTitlebarWidth = overlayState.visible
    ? Math.max(0, overlayRect.width)
    : menuBarWidth;
  $: resolvedMenuGroupsWidth = menuGroupsWidth || FALLBACK_MENU_GROUPS_WIDTH;
  $: resolvedMenuBrandWidth = menuBrandWidth || FALLBACK_MENU_BRAND_WIDTH;
  $: showVersionIndicator = !overlayState.visible
    || availableTitlebarWidth >= resolvedMenuGroupsWidth + resolvedMenuBrandWidth + MENU_ITEMS_WITH_VERSION_PADDING;
  $: compactMenuThreshold = overlayState.visible
    ? resolvedMenuGroupsWidth + MENU_ITEMS_ONLY_PADDING
    : resolvedMenuGroupsWidth + resolvedMenuBrandWidth + MENU_ITEMS_WITH_VERSION_PADDING;
  $: isCompactMenu = availableTitlebarWidth < compactMenuThreshold;
  $: if (isCompactMenu) {
    activeMenu = null;
  } else {
    compactMenuOpen = false;
  }
  $: if (activeMenu !== null) {
    updateMenuPosition(activeMenu);
  }

  function toggleMenu(menuId: MenuId) {
    compactMenuOpen = false;
    menubarPressPointerId = null;
    const nextMenu = activeMenu === menuId ? null : menuId;
    activeMenu = nextMenu;

    if (nextMenu === 'file' && showInstallHint) {
      installHintPresentedInOpenMenu = true;
      dispatch('acknowledgeInstallHint');
    } else if (nextMenu !== 'file') {
      installHintPresentedInOpenMenu = false;
    }

    if (nextMenu !== null) {
      updateMenuPosition(nextMenu);
    }
  }

  function closeMenus() {
    activeMenu = null;
    compactMenuOpen = false;
    installHintPresentedInOpenMenu = false;
    menubarPressPointerId = null;
    suppressNextRootClick = false;
  }

  function handleMenuHover(menuId: MenuId) {
    if (isCompactMenu) {
      return;
    }

    if (activeMenu !== null && activeMenu !== menuId) {
      activeMenu = menuId;
      updateMenuPosition(menuId);
    }
  }

  function handleRootPointerDown(event: PointerEvent, menuId: MenuId) {
    if (isCompactMenu || event.button !== 0) {
      return;
    }

    event.preventDefault();
    compactMenuOpen = false;
    activeMenu = menuId;
    if (menuId === 'file' && showInstallHint) {
      installHintPresentedInOpenMenu = true;
      dispatch('acknowledgeInstallHint');
    } else if (menuId !== 'file') {
      installHintPresentedInOpenMenu = false;
    }
    menubarPressPointerId = event.pointerId;
    suppressNextRootClick = true;
    updateMenuPosition(menuId);
  }

  function handleRootClick(menuId: MenuId) {
    if (suppressNextRootClick) {
      suppressNextRootClick = false;
      return;
    }

    toggleMenu(menuId);
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

  function handleWindowPointerUp(event: PointerEvent) {
    if (menubarPressPointerId === event.pointerId) {
      menubarPressPointerId = null;
      window.setTimeout(() => {
        suppressNextRootClick = false;
      }, 0);
    }
  }

  function runMenuAction(action: MenuActionId) {
    closeMenus();
    dispatch(action);
  }

  function getMenuTriggerElement(menuId: MenuId) {
    if (menuId === 'file') {
      return fileMenuTriggerElement;
    }

    return menuId === 'view' ? viewMenuTriggerElement : helpMenuTriggerElement;
  }

  function updateMenuPosition(menuId: MenuId) {
    const triggerElement = getMenuTriggerElement(menuId);

    if (!triggerElement) {
      return;
    }

    const rect = triggerElement.getBoundingClientRect();
    menuPopupX = rect.left;
    menuPopupY = rect.bottom + 6;
  }

  function toggleCompactMenu() {
    if (!compactMenuTriggerElement) {
      compactMenuOpen = !compactMenuOpen;
      return;
    }

    const nextOpen = !compactMenuOpen;
    compactMenuOpen = nextOpen;
    activeMenu = null;

    if (nextOpen && showInstallHint) {
      installHintPresentedInOpenMenu = true;
      dispatch('acknowledgeInstallHint');
    } else if (!nextOpen) {
      installHintPresentedInOpenMenu = false;
    }

    if (!nextOpen) {
      return;
    }

    const rect = compactMenuTriggerElement.getBoundingClientRect();
    compactMenuX = rect.left;
    compactMenuY = rect.bottom + 6;
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', handleWindowPointerDown);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('keydown', handleWindowKeydown);
  }

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', handleWindowPointerDown);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('keydown', handleWindowKeydown);
    }

  });
</script>

<nav
  bind:this={menuBarElement}
  bind:clientWidth={menuBarWidth}
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
      class:install-hint-visible={showInstallHint}
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
        items={compactMenuItems}
        x={compactMenuX}
        y={compactMenuY}
        ariaLabel="Application menu"
        enableOverflowSubmenuFallback={true}
        on:action={(event) => runMenuAction(event.detail as MenuActionId)}
        on:dismiss={closeMenus}
      />
    {/if}
  {:else}
    <div class="menu-groups" bind:clientWidth={menuGroupsWidth}>
      <div class="menu-root" role="none" on:pointerenter={() => handleMenuHover('file')}>
        <button
          bind:this={fileMenuTriggerElement}
          class:active={activeMenu === 'file'}
          class="menu-trigger"
          class:install-hint-visible={showInstallHint}
          data-menu-interactive="true"
          type="button"
          aria-haspopup="menu"
          aria-expanded={activeMenu === 'file'}
          on:pointerdown={(event) => handleRootPointerDown(event, 'file')}
          on:click={() => handleRootClick('file')}
        >
          File
        </button>
        {#if activeMenu === 'file'}
          <MenuSurface
            items={fileMenuItems}
            x={menuPopupX}
            y={menuPopupY}
            ariaLabel="File"
            activateOnPointerUpPointerId={menubarPressPointerId}
            on:action={(event) => runMenuAction(event.detail as MenuActionId)}
            on:dismiss={closeMenus}
          />
        {/if}
      </div>

      <div class="menu-root" role="none" on:pointerenter={() => handleMenuHover('view')}>
        <button
          bind:this={viewMenuTriggerElement}
          class:active={activeMenu === 'view'}
          class="menu-trigger"
          data-menu-interactive="true"
          type="button"
          aria-haspopup="menu"
          aria-expanded={activeMenu === 'view'}
          on:pointerdown={(event) => handleRootPointerDown(event, 'view')}
          on:click={() => handleRootClick('view')}
        >
          View
        </button>
        {#if activeMenu === 'view'}
          <MenuSurface
            items={viewMenuItems}
            x={menuPopupX}
            y={menuPopupY}
            ariaLabel="View"
            activateOnPointerUpPointerId={menubarPressPointerId}
            on:action={(event) => runMenuAction(event.detail as MenuActionId)}
            on:dismiss={closeMenus}
          />
        {/if}
      </div>

      <div class="menu-root" role="none" on:pointerenter={() => handleMenuHover('help')}>
        <button
          bind:this={helpMenuTriggerElement}
          class:active={activeMenu === 'help'}
          class="menu-trigger"
          data-menu-interactive="true"
          type="button"
          aria-haspopup="menu"
          aria-expanded={activeMenu === 'help'}
          on:pointerdown={(event) => handleRootPointerDown(event, 'help')}
          on:click={() => handleRootClick('help')}
        >
          Help
        </button>
        {#if activeMenu === 'help'}
          <MenuSurface
            items={HELP_MENU_ITEMS}
            x={menuPopupX}
            y={menuPopupY}
            ariaLabel="Help"
            activateOnPointerUpPointerId={menubarPressPointerId}
            on:action={(event) => runMenuAction(event.detail as MenuActionId)}
            on:dismiss={closeMenus}
          />
        {/if}
      </div>
    </div>

    <div
      bind:clientWidth={menuBrandWidth}
      class="menu-brand"
      class:menu-brand-hidden={!showVersionIndicator}
      aria-hidden={!showVersionIndicator}
    >
        <strong>izci</strong>
        <span class="menu-version-indicator">
          {#if $pwaUpdateCompleted}
            <span class="menu-update-completed">updated!</span>
          {:else}
            <span>{displayVersion}</span>
          {/if}
        </span>
    </div>
  {/if}
</nav>

<style>
  .menu-trigger.install-hint-visible::after {
    width: 0.42rem;
    height: 0.42rem;
    margin-left: 0.18rem;
    border-radius: 999px;
    background: #e5a92f;
    box-shadow: 0 0 0 0 rgba(229, 169, 47, 0.42);
    content: '';
    animation: install-hint-pulse 1.4s ease-out 1;
  }

  @keyframes install-hint-pulse {
    0% { box-shadow: 0 0 0 0 rgba(229, 169, 47, 0.42); }
    70% { box-shadow: 0 0 0 0.36rem rgba(229, 169, 47, 0); }
    100% { box-shadow: 0 0 0 0 rgba(229, 169, 47, 0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .menu-trigger.install-hint-visible::after { animation: none; }
  }
</style>
