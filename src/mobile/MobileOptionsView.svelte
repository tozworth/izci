<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import type { SharedOptionsViewDefinition } from '$lib/components/options/OptionsView.svelte';

  export let windowTitle: string;
  export let groups: SharedOptionsViewDefinition[][];
  export let auxiliaryViews: SharedOptionsViewDefinition[] = [];
  export let activeView: string;
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

  let categoriesOpen = false;
  let fieldHintsExpanded = false;

  $: allViews = [...groups.flat(), ...auxiliaryViews];
  $: activeDefinition = allViews.find((view) => view.id === activeView) ?? allViews[0];
  $: activeParent = activeDefinition?.parentId
    ? allViews.find((view) => view.id === activeDefinition.parentId) ?? null
    : null;
  $: canReset = activeDefinition?.resettable === true;
  $: canToggleHints = activeDefinition?.hasHints === true;
  $: canToggleAdvanced = activeDefinition?.hasAdvancedTweaks === true;
  $: hintLabel = fieldHintsExpanded ? collapseHintsLabel : expandHintsLabel;
  $: advancedLabel = showAdvancedTweaks
    ? hideAdvancedTweaksLabel
    : advancedTweaksModified
      ? showModifiedAdvancedTweaksLabel
      : showAdvancedTweaksLabel;
  $: mobileTweaksLabel = showAdvancedTweaks
    ? $t('mobile.options.hideTweaks', { default: 'Hide tweaks' })
    : $t('mobile.options.showTweaks', { default: 'Show tweaks' });
  $: mobileHintsLabel = fieldHintsExpanded
    ? $t('mobile.options.collapseHints', { default: 'Collapse hints' })
    : $t('mobile.options.expandHints', { default: 'Expand hints' });

  function select(view: string): void {
    dispatch('select', { view });
    categoriesOpen = false;
  }

  function goBack(): void {
    if (window.history.length > 1 && document.referrer.startsWith(window.location.origin)) {
      window.history.back();
      return;
    }
    window.location.assign('/');
  }

  function toggleAdvanced(): void {
    showAdvancedTweaks = !showAdvancedTweaks;
    dispatch('advancedvisibilitychange', { visible: showAdvancedTweaks });
  }
</script>

<svelte:head><title>{windowTitle}</title></svelte:head>

<div
  class="mobile-options-shell"
  class:hints-expanded={fieldHintsExpanded}
  class:advanced-tweaks-visible={showAdvancedTweaks}
>
  <header class="mobile-options-header">
    <button type="button" aria-label={$t('mobile.options.back', { default: 'Back to player' })} on:click={goBack}>
      <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
    </button>
    <button class="mobile-options-title" type="button" aria-haspopup="dialog" aria-expanded={categoriesOpen} on:click={() => (categoriesOpen = true)}>
      <span>{activeDefinition?.label ?? windowTitle}</span>
      <small>{activeParent?.label ?? $t('mobile.options.title', { default: 'Options' })}</small>
      <span class="material-symbols-outlined" aria-hidden="true">expand_more</span>
    </button>
    <button type="button" aria-label={$t('mobile.options.categories', { default: 'Choose category' })} on:click={() => (categoriesOpen = true)}>
      <span class="material-symbols-outlined" aria-hidden="true">apps</span>
    </button>
  </header>

  <div class="mobile-options-tools" aria-label={$t('options.tools.label', { default: 'Page tools' })}>
    <button class:active={showAdvancedTweaks || advancedTweaksModified} type="button" aria-label={advancedLabel} disabled={!canToggleAdvanced} on:click={toggleAdvanced}>
      <span class="material-symbols-outlined" aria-hidden="true">tune</span>
      <span>{mobileTweaksLabel}</span>
    </button>
    <button type="button" aria-label={hintLabel} disabled={!canToggleHints} on:click={() => (fieldHintsExpanded = !fieldHintsExpanded)}>
      <span class="material-symbols-outlined" aria-hidden="true">{fieldHintsExpanded ? 'unfold_less' : 'unfold_more'}</span>
      <span>{mobileHintsLabel}</span>
    </button>
    <button type="button" aria-label={resetPageLabel} disabled={!canReset} on:click={() => dispatch('reset', { view: activeView })}>
      <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>
      <span>{$t('mobile.options.resetPage', { default: 'Reset page' })}</span>
    </button>
  </div>

  <main class="mobile-options-content {contentClass}"><slot></slot></main>
</div>

{#if categoriesOpen}
  <button class="mobile-options-sheet-scrim" type="button" aria-label={$t('mobile.menu.close', { default: 'Close menu' })} on:click={() => (categoriesOpen = false)}></button>
  <div class="mobile-options-sheet" role="dialog" aria-modal="true" aria-label={$t('mobile.options.categories', { default: 'Choose category' })}>
    <div class="mobile-options-sheet-handle" aria-hidden="true"></div>
    <header>
      <h2>{$t('mobile.options.title', { default: 'Options' })}</h2>
      <button type="button" aria-label={$t('mobile.menu.close', { default: 'Close menu' })} on:click={() => (categoriesOpen = false)}>
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>
    <div class="mobile-options-category-grid">
      {#each groups.flat() as view}
        {#if !view.hidden}
          <button class:active={activeView === view.id} class:child={view.parentId != null} type="button" on:click={() => select(view.id)}>
            <span class="material-symbols-outlined" aria-hidden="true">{view.icon}</span>
            <span>{view.label}</span>
          </button>
        {/if}
      {/each}
    </div>
  </div>
{/if}
