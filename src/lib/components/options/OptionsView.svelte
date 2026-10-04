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
  import { createEventDispatcher, onMount } from 'svelte';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import OptionsTree from './OptionsTree.svelte';
  import { windowControlsOverlayState } from '$lib/services/window-controls-overlay';
  import { DesktopWindowControls, desktopTitlebar } from '$platform';

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
  export let embedded = false;

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

  onMount(() => {
    const wasOpenedByHostWindow = window.opener !== null;
    const closeIfHostWindowClosed = () => {
      if (wasOpenedByHostWindow && (!window.opener || window.opener.closed)) {
        window.close();
      }
    };

    window.addEventListener('focus', closeIfHostWindowClosed);
    document.addEventListener('visibilitychange', closeIfHostWindowClosed);
    const openerCheckInterval = window.setInterval(closeIfHostWindowClosed, 1000);

    return () => {
      window.clearInterval(openerCheckInterval);
      window.removeEventListener('focus', closeIfHostWindowClosed);
      document.removeEventListener('visibilitychange', closeIfHostWindowClosed);
    };
  });

  $: allViews = [...groups.flat(), ...auxiliaryViews];
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
  $: nativeTitlebar = !embedded && DesktopWindowControls !== null;
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
    class:desktop-titlebar={nativeTitlebar}
    use:desktopTitlebar={nativeTitlebar}
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
    {#if nativeTitlebar}
      <svelte:component this={DesktopWindowControls} />
    {/if}
  </header>

  <main class="options-main">
    <OptionsTree {groups} {activeView} {categoriesLabel} on:select={(event) => dispatch('select', event.detail)} />

    <section class="content-panel {contentClass}" aria-live="polite">
      <slot></slot>
    </section>
  </main>
</div>
