<script lang="ts">
  import { afterUpdate, createEventDispatcher } from 'svelte';
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { MenuActionItem } from '$lib/types';
  import { portal } from '$lib/components/track-list-panel/actions/portal';
  import { windowDismiss } from '$lib/components/track-list-panel/actions/window-dismiss';
  import { WINDOW_DISMISS_IGNORE_SCROLL_ATTRIBUTE } from '$lib/components/track-list-panel/actions/window-dismiss';
  import { SCROLLBAR_VISIBILITY_IGNORE_SCROLL_ATTRIBUTE } from '$lib/services/scrollbar-visibility';
  import { keepMenuInViewport } from '$lib/components/track-list-panel/actions/menu-viewport';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import RatingMenuSurface from '$lib/components/RatingMenuSurface.svelte';

  export let items: MenuActionItem[] = [];
  export let x = 0;
  export let y = 0;
  export let ariaLabel: string | undefined = undefined;
  export let nested = false;
  export let enableOverflowSubmenuFallback = false;
  export let activateOnPointerUpPointerId: number | null = null;
  export let viewportPadding = 8;
  export let maxVisibleItems: number | null = null;

  type MenuLevel = {
    sourceItemId: string;
    label: string;
    items: MenuActionItem[];
    ratingPicker?: MenuActionItem['ratingPicker'];
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
  let observedItems = items;
  let suppressNextClickItemId: string | null = null;

  $: currentLevel = navigationStack[navigationStack.length - 1] ?? null;
  $: displayedItems = currentLevel?.items ?? items;
  $: displayedRatingPicker = currentLevel?.ratingPicker;
  $: showsSessionStats = displayedItems.some((item) => item.id === 'multiplayerStatProtocol');
  $: resolvedAriaLabel = currentLevel?.label
    ?? ariaLabel
    ?? $t('main.menu.genericMenu', { default: 'Menu' });
  $: canShowHoverSubmenus = nested || !shouldUseSubmenuDrilldown;

  function hasSubmenu(item: MenuActionItem): boolean {
    return Boolean(item.children?.length || item.ratingPicker);
  }

  function closeSubmenu() {
    activeSubmenuId = null;
  }

  function openSubmenu(item: MenuActionItem) {
    if (!canShowHoverSubmenus) {
      return;
    }

    if (item.disabled) {
      // Disabled items are inert: don't open their own submenu and don't
      // leave a previously hovered sibling's submenu hanging open.
      activeSubmenuId = null;
      return;
    }

    activeSubmenuId = hasSubmenu(item) ? item.id : null;
  }

  function enterSubmenu(item: MenuActionItem) {
    if (item.disabled || !hasSubmenu(item)) {
      return;
    }

    navigationStack = [...navigationStack, {
      sourceItemId: item.id,
      label: item.label,
      items: item.children ?? [],
      ratingPicker: item.ratingPicker
    }];
    activeSubmenuId = null;
  }

  function goBack() {
    navigationStack = navigationStack.slice(0, -1);
    activeSubmenuId = null;
  }

  function handleItemSelect(item: MenuActionItem) {
    if (item.disabled) {
      return;
    }

    if (hasSubmenu(item)) {
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

  function handleRemove(event: MouseEvent, item: MenuActionItem) {
    event.preventDefault();
    event.stopPropagation();
    if (item.removeActionId) dispatch('action', item.removeActionId);
  }

  function handleEdit(event: MouseEvent, item: MenuActionItem) {
    event.preventDefault();
    event.stopPropagation();
    if (item.editActionId) dispatch('action', item.editActionId);
  }

  function handleItemClick(item: MenuActionItem) {
    if (suppressNextClickItemId === item.id) {
      suppressNextClickItemId = null;
      return;
    }

    handleItemSelect(item);
  }

  function handleItemPointerUp(event: PointerEvent, item: MenuActionItem) {
    if (activateOnPointerUpPointerId === null || event.pointerId !== activateOnPointerUpPointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    suppressNextClickItemId = item.id;
    handleItemSelect(item);
  }

  function updateRootLayout() {
    if (nested || !menuElement || typeof window === 'undefined') {
      return;
    }

    const padding = Math.max(0, viewportPadding);
    const maxX = Math.max(padding, window.innerWidth - menuElement.offsetWidth - padding);
    const maxY = Math.max(padding, window.innerHeight - menuElement.offsetHeight - padding);

    resolvedX = Math.max(padding, Math.min(x, maxX));
    resolvedY = Math.max(padding, Math.min(y, maxY));

    if (!enableOverflowSubmenuFallback) {
      shouldUseSubmenuDrilldown = false;
      return;
    }

    const hasChildMenus = items.some(hasSubmenu);
    const minimumSubmenuWidth = 208;
    shouldUseSubmenuDrilldown =
      hasChildMenus && resolvedX + menuElement.offsetWidth + minimumSubmenuWidth + padding > window.innerWidth;
  }

  function refreshNavigationStack(): void {
    let sourceItems = items;
    const refreshed: MenuLevel[] = [];

    for (const level of navigationStack) {
      const sourceItem = sourceItems.find(({ id }) => id === level.sourceItemId);
      if (!sourceItem || !hasSubmenu(sourceItem)) break;
      const childItems = sourceItem.children ?? [];
      refreshed.push({
        sourceItemId: sourceItem.id,
        label: sourceItem.label,
        items: childItems,
        ratingPicker: sourceItem.ratingPicker
      });
      sourceItems = childItems;
    }

    navigationStack = refreshed;
  }

  $: resolvedX = x;
  $: resolvedY = y;
  $: if (items !== observedItems) {
    observedItems = items;
    refreshNavigationStack();
  }
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
  <div
    bind:this={menuElement}
    class="menu-list menu-surface menu-surface-nested"
    class:menu-surface-session-stats={showsSessionStats}
    class:menu-surface-clamped={Boolean(maxVisibleItems)}
    style={maxVisibleItems ? `--menu-visible-count: ${maxVisibleItems};` : undefined}
    data-window-dismiss-ignore-scroll
    data-scrollbar-visibility-ignore-scroll
    use:keepMenuInViewport
    role="menu"
    aria-label={resolvedAriaLabel}
  >
    {#each displayedItems as item (item.id)}
      {#if item.separatorBefore}
        <div class="menu-separator" role="separator" aria-hidden="true"></div>
      {/if}

      <div class="menu-entry-group" role="none" on:pointerenter={() => openSubmenu(item)}>
        <button
          type="button"
          role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={item.checked}
          disabled={item.disabled}
          class:submenu-open={activeSubmenuId === item.id}
          class:menu-item-parent={hasSubmenu(item)}
          class:menu-item-attention={item.attention}
          aria-haspopup={hasSubmenu(item) ? 'menu' : undefined}
          aria-expanded={hasSubmenu(item) ? activeSubmenuId === item.id : undefined}
          on:pointerup={(event) => handleItemPointerUp(event, item)}
          on:click={() => handleItemClick(item)}
        >
          <span
            class="material-symbols-outlined menu-item-icon"
            class:favorite-filled={item.icon === 'heart_minus'}
            style:color={item.iconColor}
            aria-hidden="true"
          >{item.icon ?? 'label'}</span>
          <span class="menu-item-copy">
            <span class="menu-item-label">{item.label}</span>
            {#if item.description}<span class="menu-item-description">{item.description}</span>{/if}
          </span>
          {#if hasSubmenu(item)}
            <span class="material-symbols-outlined menu-item-chevron" aria-hidden="true">chevron_right</span>
          {:else if item.checked === true}
            <span class="material-symbols-outlined menu-item-check" aria-hidden="true">check</span>
          {:else if item.shortcut}
            <span class="menu-item-shortcut" aria-hidden="true">{item.shortcut}</span>
          {/if}
        </button>
        {#if item.editActionId}
          <button
            type="button"
            class="menu-item-edit hover-tooltip-anchor"
            aria-label={item.editLabel ?? $t('main.menu.edit', { default: 'Edit' })}
            on:click={(event) => handleEdit(event, item)}
          ><span class="material-symbols-outlined" aria-hidden="true">edit</span><HoverTooltip placement="above" nowrap>{item.editLabel ?? $t('main.menu.edit', { default: 'Edit' })}</HoverTooltip></button>
        {/if}
        {#if item.removeActionId}
          <button
            type="button"
            class="menu-item-remove hover-tooltip-anchor"
            aria-label={item.removeLabel ?? $t('main.menu.delete', { default: 'Delete' })}
            on:click={(event) => handleRemove(event, item)}
          ><span class="material-symbols-outlined" aria-hidden="true">{item.removeIcon ?? 'close'}</span><HoverTooltip placement="above" nowrap>{item.removeLabel ?? $t('main.menu.delete', { default: 'Delete' })}</HoverTooltip></button>
        {/if}

        {#if item.children?.length && activeSubmenuId === item.id}
          <svelte:self
            nested
            items={item.children}
            ariaLabel={item.label}
            activateOnPointerUpPointerId={activateOnPointerUpPointerId}
            on:action={(event) => dispatch('action', event.detail)}
            on:dismiss={() => dispatch('dismiss')}
          />
        {:else if item.ratingPicker && activeSubmenuId === item.id}
          <RatingMenuSurface
            value={item.ratingPicker.value}
            actionPrefix={item.ratingPicker.actionPrefix}
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
    class:menu-surface-session-stats={showsSessionStats}
    class:menu-surface-clamped={Boolean(maxVisibleItems)}
    data-menu-interactive="true"
    data-window-dismiss-ignore-scroll
    data-scrollbar-visibility-ignore-scroll
    use:portal
    use:windowDismiss={{ enabled: true, onDismiss: () => dispatch('dismiss') }}
    role="menu"
    aria-label={resolvedAriaLabel}
    style={`left: ${resolvedX}px; top: ${resolvedY}px;${maxVisibleItems ? ` --menu-visible-count: ${maxVisibleItems};` : ''}`}
  >
    {#if shouldUseSubmenuDrilldown && navigationStack.length > 0}
      <button type="button" role="menuitem" class="menu-back-button" on:click={goBack}>
        <span class="material-symbols-outlined menu-item-icon" aria-hidden="true">arrow_back</span>
        <span class="menu-item-label">{$t('main.menu.back', { default: 'Back' })}</span>
      </button>
      <div class="menu-separator" role="separator" aria-hidden="true"></div>
    {/if}

    {#if displayedRatingPicker}
      <RatingMenuSurface
        nested={false}
        value={displayedRatingPicker.value}
        actionPrefix={displayedRatingPicker.actionPrefix}
        ariaLabel={resolvedAriaLabel}
        on:action={(event) => dispatch('action', event.detail)}
        on:dismiss={() => dispatch('dismiss')}
      />
    {/if}

    {#each displayedItems as item (item.id)}
      {#if item.separatorBefore}
        <div class="menu-separator" role="separator" aria-hidden="true"></div>
      {/if}

      <div class="menu-entry-group" role="none" on:pointerenter={() => openSubmenu(item)}>
        <button
          type="button"
          role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={item.checked}
          disabled={item.disabled}
          class:submenu-open={activeSubmenuId === item.id}
          class:menu-item-parent={hasSubmenu(item)}
          class:menu-item-drilldown={shouldUseSubmenuDrilldown && hasSubmenu(item)}
          class:menu-item-attention={item.attention}
          aria-haspopup={hasSubmenu(item) ? 'menu' : undefined}
          aria-expanded={hasSubmenu(item) ? activeSubmenuId === item.id : undefined}
          on:pointerup={(event) => handleItemPointerUp(event, item)}
          on:click={() => handleItemClick(item)}
        >
          <span
            class="material-symbols-outlined menu-item-icon"
            class:favorite-filled={item.icon === 'heart_minus'}
            style:color={item.iconColor}
            aria-hidden="true"
          >{item.icon ?? 'label'}</span>
          <span class="menu-item-copy">
            <span class="menu-item-label">{item.label}</span>
            {#if item.description}<span class="menu-item-description">{item.description}</span>{/if}
          </span>
          {#if hasSubmenu(item)}
            <span class="material-symbols-outlined menu-item-chevron" aria-hidden="true">
              {shouldUseSubmenuDrilldown ? 'chevron_right' : 'chevron_right'}
            </span>
          {:else if item.checked === true}
            <span class="material-symbols-outlined menu-item-check" aria-hidden="true">check</span>
          {:else if item.shortcut}
            <span class="menu-item-shortcut" aria-hidden="true">{item.shortcut}</span>
          {/if}
        </button>
        {#if item.editActionId}
          <button
            type="button"
            class="menu-item-edit hover-tooltip-anchor"
            aria-label={item.editLabel ?? $t('main.menu.edit', { default: 'Edit' })}
            on:click={(event) => handleEdit(event, item)}
          ><span class="material-symbols-outlined" aria-hidden="true">edit</span><HoverTooltip placement="above" nowrap>{item.editLabel ?? $t('main.menu.edit', { default: 'Edit' })}</HoverTooltip></button>
        {/if}
        {#if item.removeActionId}
          <button
            type="button"
            class="menu-item-remove hover-tooltip-anchor"
            aria-label={item.removeLabel ?? $t('main.menu.delete', { default: 'Delete' })}
            on:click={(event) => handleRemove(event, item)}
          ><span class="material-symbols-outlined" aria-hidden="true">{item.removeIcon ?? 'close'}</span><HoverTooltip placement="above" nowrap>{item.removeLabel ?? $t('main.menu.delete', { default: 'Delete' })}</HoverTooltip></button>
        {/if}

        {#if canShowHoverSubmenus && item.children?.length && activeSubmenuId === item.id}
          <svelte:self
            nested
            items={item.children}
            ariaLabel={item.label}
            activateOnPointerUpPointerId={activateOnPointerUpPointerId}
            on:action={(event) => dispatch('action', event.detail)}
            on:dismiss={() => dispatch('dismiss')}
          />
        {:else if canShowHoverSubmenus && item.ratingPicker && activeSubmenuId === item.id}
          <RatingMenuSurface
            value={item.ratingPicker.value}
            actionPrefix={item.ratingPicker.actionPrefix}
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

  .menu-surface:not(.menu-surface-nested):has(> .menu-entry-group > button .menu-item-description) {
    width: min(22rem, calc(100vw - 1rem));
  }

  .menu-surface:not(.menu-surface-nested).menu-surface-session-stats:has(> .menu-entry-group > button .menu-item-description) {
    width: min(19.5rem, calc(100vw - 1rem));
  }

  .menu-surface-session-stats .menu-item-shortcut {
    min-width: 0;
    font-variant-numeric: tabular-nums;
  }

  .menu-surface-nested {
    position: absolute;
    top: -0.22rem;
    left: calc(100% + 0.2rem);
    z-index: 1;
  }

  .menu-surface-nested:has(> .menu-entry-group > button .menu-item-description) {
    width: min(13rem, calc(100vw - 1rem));
  }

  .menu-surface-nested .menu-item-description {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .menu-entry-group {
    position: relative;
  }

  button.menu-item-edit,
  button.menu-item-remove {
    position: absolute;
    top: 50%;
    display: grid;
    width: 1.3rem;
    min-width: 0;
    height: 1.3rem;
    padding: 0;
    place-items: center;
    opacity: 0;
    transform: translateY(-50%);
  }

  button.menu-item-edit {
    right: 1.52rem;
  }

  .menu-entry-group:not(:has(.menu-item-remove)) > button.menu-item-edit {
    right: 0.22rem;
  }

  button.menu-item-remove {
    right: 0.22rem;
  }

  button.menu-item-edit .material-symbols-outlined,
  button.menu-item-remove .material-symbols-outlined {
    font-size: 0.9rem;
  }

  .menu-entry-group > button:first-of-type:has(~ .menu-item-edit):has(~ .menu-item-remove) {
    padding-right: 3rem;
  }

  .menu-entry-group > button:first-of-type:has(~ .menu-item-edit):not(:has(~ .menu-item-remove)),
  .menu-entry-group > button:first-of-type:has(~ .menu-item-remove):not(:has(~ .menu-item-edit)) {
    padding-right: 1.8rem;
  }

  .menu-entry-group:has(.menu-item-remove) .menu-item-check {
    position: absolute;
    top: 50%;
    right: 0.35rem;
    transform: translateY(-50%);
  }

  .menu-entry-group:hover > .menu-item-edit,
  .menu-entry-group:focus-within > .menu-item-edit,
  .menu-entry-group:hover > .menu-item-remove,
  .menu-entry-group:focus-within > .menu-item-remove {
    opacity: 1;
  }

  .menu-entry-group:hover > button:first-of-type .menu-item-check,
  .menu-entry-group:focus-within > button:first-of-type .menu-item-check {
    visibility: hidden;
  }

  button.menu-item-edit:hover {
    background: var(--menu-popover-hover);
    color: var(--menu-popover-text);
  }

  button.menu-item-remove:hover {
    background: color-mix(in srgb, var(--danger) 18%, transparent);
    color: var(--danger);
  }

  .menu-item-chevron {
    min-width: 0.9rem;
    color: var(--menu-popover-muted);
    font-size: 0.85rem;
    text-align: right;
  }

  .menu-item-copy {
    display: flex;
    flex: 1;
    min-width: 0;
    flex-direction: column;
    gap: 0.08rem;
  }

  .menu-item-description {
    color: var(--menu-popover-muted);
    font-size: 0.68rem;
    line-height: 1.25;
    white-space: normal;
  }

  button:has(.menu-item-description) .menu-item-shortcut {
    min-width: 0;
  }

  button.menu-item-attention {
    background: color-mix(in srgb, #e5a92f 16%, transparent);
    color: #ffd77b;
  }

  button.menu-item-attention .menu-item-icon,
  button.menu-item-attention .menu-item-description {
    color: #e9b84e;
  }

  button.menu-item-attention:hover {
    background: color-mix(in srgb, #e5a92f 24%, transparent);
  }

  .submenu-open,
  .menu-back-button:hover {
    background: var(--menu-popover-hover);
  }

  .menu-surface-clamped {
    --izci-scrollbar-visibility: 1;
    max-height: calc(0.24rem + var(--menu-visible-count, 8) * 1.72rem);
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-gutter: stable;
    scrollbar-color: color-mix(in srgb, var(--accent) 58%, var(--bg-soft)) transparent;
  }

  .menu-surface-clamped::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  .menu-surface-clamped::-webkit-scrollbar-track {
    background: transparent;
  }

  .menu-surface-clamped::-webkit-scrollbar-thumb {
    min-width: 28px;
    min-height: 28px;
    border: solid transparent;
    border-width: 2px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent) 58%, var(--bg-soft));
    background-clip: padding-box;
  }

  .menu-surface-clamped::-webkit-scrollbar-thumb:hover {
    background: color-mix(in srgb, var(--accent-strong) 72%, var(--bg-soft));
  }

  .menu-surface-clamped::-webkit-scrollbar-thumb:active {
    background: var(--accent-strong);
  }

  :global(html.izci-overlay-vertical-scrollbars) .menu-surface-clamped::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
</style>
