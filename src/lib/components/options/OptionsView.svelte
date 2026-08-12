<script context="module" lang="ts">
  export interface SharedOptionsViewDefinition {
    id: string;
    label: string;
    icon: string;
    parentId?: string | null;
    hasHints: boolean;
    hasAdvancedTweaks?: boolean;
    resettable: boolean;
    hidden?: boolean;
  }
</script>

<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import { windowControlsOverlayState } from '$lib/services/window-controls-overlay';

  export let windowTitle: string;
  export let pageToolsLabel = 'Page tools';
  export let categoriesLabel = 'Options categories';
  export let groups: SharedOptionsViewDefinition[][];
  export let auxiliaryViews: SharedOptionsViewDefinition[] = [];
  export let activeView: string;
  export let fieldHintsExpanded = false;
  export let showAdvancedTweaks = false;
  export let advancedTweaksModified = false;
  export let expandHintsLabel = 'Expand field hints';
  export let collapseHintsLabel = 'Collapse field hints';
  export let showAdvancedTweaksLabel = 'Show advanced tweaks';
  export let showModifiedAdvancedTweaksLabel = 'Show advanced tweaks — some differ from defaults';
  export let hideAdvancedTweaksLabel = 'Hide advanced tweaks';
  export let resetPageLabel = 'Reset current page to defaults';
  export let contentClass = '';

  const dispatch = createEventDispatcher<{
    select: { view: string };
    reset: { view: string };
    advancedvisibilitychange: { visible: boolean };
  }>();

  function handleWindowContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  function toggleAdvancedTweaks(): void {
    showAdvancedTweaks = !showAdvancedTweaks;
    dispatch('advancedvisibilitychange', { visible: showAdvancedTweaks });
  }

  function handleTreeKeydown(event: KeyboardEvent): void {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

    const tree = event.currentTarget as HTMLElement;
    const items = Array.from(tree.querySelectorAll<HTMLButtonElement>('.tree-item:not(:disabled)'));
    if (items.length === 0) return;

    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = currentIndex;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    else nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;

    event.preventDefault();
    items[nextIndex]?.focus();
  }

  $: allViews = [...groups.flat(), ...auxiliaryViews];
  $: visibleTreeViews = groups.flat().filter((view) => !view.hidden);
  $: treeFocusViewId = visibleTreeViews.some((view) => view.id === activeView)
    ? activeView
    : visibleTreeViews[0]?.id;
  $: activeViewDefinition = allViews.find((view) => view.id === activeView) ?? allViews[0];
  $: activeParentView = activeViewDefinition?.parentId
    ? allViews.find((view) => view.id === activeViewDefinition.parentId) ?? null
    : null;
  $: canResetCurrentView = activeViewDefinition?.resettable === true;
  $: canToggleHints = activeViewDefinition?.hasHints === true;
  $: canToggleAdvancedTweaks = activeViewDefinition?.hasAdvancedTweaks === true;
  $: hintToggleLabel = fieldHintsExpanded ? collapseHintsLabel : expandHintsLabel;
  $: advancedTweaksToggleLabel = showAdvancedTweaks
    ? hideAdvancedTweaksLabel
    : advancedTweaksModified
      ? showModifiedAdvancedTweaksLabel
      : showAdvancedTweaksLabel;
  $: overlayState = $windowControlsOverlayState;
  $: overlayRect = overlayState.titlebarAreaRect;
  $: overlayInlineStyle = overlayState.visible
    ? `--window-controls-overlay-x: ${overlayRect.x}px; --window-controls-overlay-y: ${overlayRect.y}px; --window-controls-overlay-width: ${overlayRect.width}px; --window-controls-overlay-height: ${overlayRect.height}px;`
    : '';
</script>

<svelte:head>
  <title>{windowTitle}</title>
</svelte:head>

<svelte:window on:contextmenu={handleWindowContextMenu} />

<div
  class="options-shell"
  class:hints-expanded={fieldHintsExpanded}
  class:advanced-tweaks-visible={showAdvancedTweaks}
  class:window-controls-overlay-active={overlayState.visible}
>
  <header
    class="window-topbar"
    class:window-controls-overlay-active={overlayState.visible}
    style={overlayInlineStyle}
  >
    <div class="window-topbar-title" aria-live="polite">
      <span class="window-topbar-prefix">{windowTitle}</span>
      <span class="material-symbols-outlined window-topbar-separator window-topbar-prefix-separator" aria-hidden="true">
        chevron_right
      </span>
      <span class="window-topbar-breadcrumbs">
        {#if activeParentView}
          <span class="window-topbar-crumb window-topbar-parent">{activeParentView.label}</span>
          <span class="material-symbols-outlined window-topbar-separator window-topbar-parent-separator" aria-hidden="true">
            chevron_right
          </span>
        {/if}
        <span class="window-topbar-crumb is-current">{activeViewDefinition?.label ?? ''}</span>
      </span>
    </div>

    <div class="window-topbar-tools" aria-label={pageToolsLabel}>
      <button
        class="tool-button hover-tooltip-anchor"
        class:is-active={showAdvancedTweaks || advancedTweaksModified}
        type="button"
        aria-label={advancedTweaksToggleLabel}
        aria-pressed={showAdvancedTweaks}
        disabled={!canToggleAdvancedTweaks}
        on:click={toggleAdvancedTweaks}
      >
        <span class="material-symbols-outlined" aria-hidden="true">tune</span>
        <HoverTooltip>{advancedTweaksToggleLabel}</HoverTooltip>
      </button>

      <button
        class="tool-button hover-tooltip-anchor"
        type="button"
        aria-label={hintToggleLabel}
        disabled={!canToggleHints}
        on:click={() => (fieldHintsExpanded = !fieldHintsExpanded)}
      >
        <span class="material-symbols-outlined" aria-hidden="true">
          {fieldHintsExpanded ? 'unfold_less' : 'unfold_more'}
        </span>
        <HoverTooltip>{hintToggleLabel}</HoverTooltip>
      </button>

      <button
        class="tool-button hover-tooltip-anchor"
        type="button"
        aria-label={resetPageLabel}
        disabled={!canResetCurrentView}
        on:click={() => dispatch('reset', { view: activeView })}
      >
        <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>
        <HoverTooltip>{resetPageLabel}</HoverTooltip>
      </button>
    </div>
  </header>

  <main class="options-main">
    <aside class="tree-panel" aria-label={categoriesLabel}>
      <div class="tree" role="tree" aria-label={categoriesLabel} tabindex="-1" on:keydown={handleTreeKeydown}>
        {#each groups as group}
          <div class="tree-group" role="none">
            {#each group as view}
              {#if !view.hidden}
                <button
                  class="tree-item"
                  class:child={view.parentId != null}
                  type="button"
                  role="treeitem"
                  aria-selected={activeView === view.id}
                  tabindex={treeFocusViewId === view.id ? 0 : -1}
                  on:click={() => dispatch('select', { view: view.id })}
                >
                  <span class="material-symbols-outlined" aria-hidden="true">{view.icon}</span>
                  <span class="tree-label">{view.label}</span>
                </button>
              {/if}
            {/each}
          </div>
        {/each}
      </div>
    </aside>

    <section class="content-panel {contentClass}" aria-live="polite">
      <slot></slot>
    </section>
  </main>
</div>
