<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import { windowControlsOverlayState } from '$lib/services/window-controls-overlay';
  import type {
    MenuActionItem,
    WindowMenuGroup,
    WindowMenuSubtitleTone
  } from '$lib/types';

  const MENU_TITLE_RESERVE = 88;
  const MENU_EDGE_RESERVE = 28;

  export let groups: WindowMenuGroup[] = [];
  export let title = '';
  export let mainWorkspace = false;
  export let subtitle = '';
  export let subtitleTone: WindowMenuSubtitleTone = 'muted';
  export let ariaLabel = 'Application menu';
  export let height = 0;

  const dispatch = createEventDispatcher<{
    action: string;
    menuopen: string;
    menuclose: void;
  }>();

  let activeMenuId: string | null = null;
  let compactMenuOpen = false;
  let compactMenuX = 8;
  let compactMenuY = 8;
  let menuPopupX = 8;
  let menuPopupY = 8;
  let menuBarElement: HTMLElement | null = null;
  let compactMenuTriggerElement: HTMLButtonElement | null = null;
  let menuBarWidth = Number.POSITIVE_INFINITY;
  let menuGroupsWidth = 0;
  let menubarPressPointerId: number | null = null;
  let suppressNextRootClick = false;
  const triggerElements = new Map<string, HTMLButtonElement>();

  $: overlayState = $windowControlsOverlayState;
  $: overlayRect = overlayState.titlebarAreaRect;
  $: overlayInlineStyle = overlayState.visible
    ? `--window-controls-overlay-x: ${overlayRect.x}px; --window-controls-overlay-y: ${overlayRect.y}px; --window-controls-overlay-width: ${overlayRect.width}px; --window-controls-overlay-height: ${overlayRect.height}px;`
    : '';
  $: availableTitlebarWidth = overlayState.visible
    ? Math.max(0, overlayRect.width)
    : menuBarWidth;
  $: resolvedMenuGroupsWidth = menuGroupsWidth || 140;
  $: compactMenuThreshold = resolvedMenuGroupsWidth + MENU_TITLE_RESERVE + MENU_EDGE_RESERVE;
  $: isCompactMenu = availableTitlebarWidth < compactMenuThreshold;
  $: applicationGroup = groups.find((group) => group.application) ?? groups[0];
  $: compactMenuItems = createCompactMenuItems(groups, applicationGroup?.id);
  $: activeGroup = groups.find((group) => group.id === activeMenuId) ?? null;
  $: if (activeMenuId !== null && !activeGroup) {
    closeMenus();
  }
  $: if (isCompactMenu && activeMenuId !== null) {
    closeMenus();
  }
  $: if (!isCompactMenu && compactMenuOpen) {
    closeMenus();
  }
  $: if (activeMenuId !== null) {
    updateMenuPosition(activeMenuId);
  }

  function createCompactMenuItems(
    menuGroups: WindowMenuGroup[],
    applicationGroupId: string | undefined
  ): MenuActionItem[] {
    const items: MenuActionItem[] = [];
    let addedMenuGroup = false;

    for (const group of menuGroups) {
      if (group.id === applicationGroupId) {
        items.push(...group.items);
        continue;
      }

      items.push({
        id: `window-menu:${group.id}`,
        label: group.label,
        icon: group.icon,
        children: group.items,
        separatorBefore: !addedMenuGroup && items.length > 0
      });
      addedMenuGroup = true;
    }

    return items;
  }

  function setTriggerElement(element: HTMLButtonElement, groupId: string) {
    triggerElements.set(groupId, element);

    return {
      destroy() {
        if (triggerElements.get(groupId) === element) {
          triggerElements.delete(groupId);
        }
      }
    };
  }

  function announceMenuOpen(groupId: string) {
    dispatch('menuopen', groupId);
  }

  function toggleMenu(groupId: string) {
    compactMenuOpen = false;
    menubarPressPointerId = null;
    if (activeMenuId === groupId) {
      closeMenus();
      return;
    }

    activeMenuId = groupId;
    announceMenuOpen(groupId);
    updateMenuPosition(groupId);
  }

  function closeMenus() {
    const wasOpen = activeMenuId !== null || compactMenuOpen;
    activeMenuId = null;
    compactMenuOpen = false;
    menubarPressPointerId = null;
    suppressNextRootClick = false;
    if (wasOpen) {
      dispatch('menuclose');
    }
  }

  function handleMenuHover(groupId: string) {
    if (isCompactMenu || activeMenuId === null || activeMenuId === groupId) {
      return;
    }

    activeMenuId = groupId;
    announceMenuOpen(groupId);
    updateMenuPosition(groupId);
  }

  function handleRootPointerDown(event: PointerEvent, groupId: string) {
    if (isCompactMenu || event.button !== 0) {
      return;
    }

    event.preventDefault();
    compactMenuOpen = false;
    activeMenuId = groupId;
    announceMenuOpen(groupId);
    menubarPressPointerId = event.pointerId;
    suppressNextRootClick = true;
    updateMenuPosition(groupId);
  }

  function handleRootClick(groupId: string) {
    if (suppressNextRootClick) {
      suppressNextRootClick = false;
      return;
    }

    toggleMenu(groupId);
  }

  function handleWindowPointerDown(event: PointerEvent) {
    if (!menuBarElement || (activeMenuId === null && !compactMenuOpen)) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element) || !target.closest('[data-menu-interactive="true"]')) {
      closeMenus();
    }
  }

  function handleWindowPointerUp(event: PointerEvent) {
    if (menubarPressPointerId !== event.pointerId) {
      return;
    }

    menubarPressPointerId = null;
    window.setTimeout(() => {
      suppressNextRootClick = false;
    }, 0);
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      closeMenus();
    }
  }

  function updateMenuPosition(groupId: string) {
    const triggerElement = triggerElements.get(groupId);
    if (!triggerElement) {
      return;
    }

    const rect = triggerElement.getBoundingClientRect();
    menuPopupX = rect.left;
    menuPopupY = rect.bottom + 6;
  }

  function toggleCompactMenu() {
    const nextOpen = !compactMenuOpen;
    if (!nextOpen) {
      closeMenus();
      return;
    }

    compactMenuOpen = nextOpen;
    activeMenuId = null;

    if (!compactMenuTriggerElement) {
      return;
    }

    if (applicationGroup) {
      announceMenuOpen(applicationGroup.id);
    }
    const rect = compactMenuTriggerElement.getBoundingClientRect();
    compactMenuX = rect.left;
    compactMenuY = rect.bottom + 6;
  }

  function runMenuAction(action: string) {
    closeMenus();
    dispatch('action', action);
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', handleWindowPointerDown);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('keydown', handleWindowKeydown);
  }

  onDestroy(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.removeEventListener('pointerdown', handleWindowPointerDown);
    window.removeEventListener('pointerup', handleWindowPointerUp);
    window.removeEventListener('keydown', handleWindowKeydown);
  });
</script>

<nav
  bind:this={menuBarElement}
  bind:clientWidth={menuBarWidth}
  bind:clientHeight={height}
  class="menu-bar"
  class:main-workspace-menu-bar={mainWorkspace}
  class:window-controls-overlay-active={overlayState.visible}
  class:menu-bar-compact={isCompactMenu}
  style={overlayInlineStyle}
  aria-label={ariaLabel}
>
  {#if isCompactMenu}
    <button
      bind:this={compactMenuTriggerElement}
      class="menu-trigger compact-menu-trigger"
      class:menu-attention={applicationGroup?.attention}
      data-menu-interactive="true"
      type="button"
      aria-label={ariaLabel}
      aria-haspopup="menu"
      aria-expanded={compactMenuOpen}
      on:click={toggleCompactMenu}
    >
      <span class="izci-menu-glyph" aria-hidden="true"></span>
      <span class="material-symbols-outlined compact-menu-chevron" aria-hidden="true">
        {compactMenuOpen ? 'expand_less' : 'expand_more'}
      </span>
    </button>

    {#if compactMenuOpen}
      <MenuSurface
        items={compactMenuItems}
        x={compactMenuX}
        y={compactMenuY}
        ariaLabel={ariaLabel}
        enableOverflowSubmenuFallback={true}
        on:action={(event) => runMenuAction(event.detail)}
        on:dismiss={closeMenus}
      />
    {/if}
  {:else}
    <div class="menu-groups" bind:clientWidth={menuGroupsWidth}>
      {#each groups as group (group.id)}
        <div class="menu-root" role="none" on:pointerenter={() => handleMenuHover(group.id)}>
          <button
            use:setTriggerElement={group.id}
            class="menu-trigger"
            class:app-menu-trigger={group.application}
            class:active={activeMenuId === group.id}
            class:menu-attention={group.attention}
            data-menu-interactive="true"
            type="button"
            aria-label={group.application ? ariaLabel : group.label}
            aria-haspopup="menu"
            aria-expanded={activeMenuId === group.id}
            on:pointerdown={(event) => handleRootPointerDown(event, group.id)}
            on:click={() => handleRootClick(group.id)}
          >
            {#if group.application}
              <span class="izci-menu-glyph" aria-hidden="true"></span>
            {:else}
              {group.label}
            {/if}
          </button>

          {#if activeMenuId === group.id}
            <MenuSurface
              items={group.items}
              x={menuPopupX}
              y={menuPopupY}
              ariaLabel={group.label}
              activateOnPointerUpPointerId={menubarPressPointerId}
              on:action={(event) => runMenuAction(event.detail)}
              on:dismiss={closeMenus}
            />
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <div class="menu-brand" aria-live="polite">
    <strong>{title}</strong>
    {#if subtitle}
      <span
        class:menu-update-completed={subtitleTone === 'success'}
        class:menu-update-current={subtitleTone === 'current'}
        class:menu-update-failed={subtitleTone === 'warning'}
      >{subtitle}</span>
    {/if}
  </div>
</nav>
