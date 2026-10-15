<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import MobileOptionsCategories from './MobileOptionsCategories.svelte';
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
  export let embedded = false;
  export let categoryPageOpen = false;

  const dispatch = createEventDispatcher<{
    select: { view: string };
    reset: { view: string };
    advancedvisibilitychange: { visible: boolean };
    back: void;
  }>();

  let categoriesElement: HTMLElement;
  let titleElement: HTMLHeadingElement;
  let lastSelectedView: string | null = null;
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

  async function select(view: string): Promise<void> {
    lastSelectedView = view;
    dispatch('select', { view });
    categoryPageOpen = true;
    await tick();
    titleElement.focus();
  }

  async function goBack(): Promise<void> {
    if (categoryPageOpen) {
      categoryPageOpen = false;
      await tick();
      const selectedButton = Array.from(categoriesElement.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.dataset.view === (lastSelectedView ?? activeView));
      selectedButton?.focus({ preventScroll: true });
      return;
    }
    if (embedded) {
      dispatch('back');
      return;
    }

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

  function handleKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    void goBack();
  }
</script>

<svelte:head><title>{windowTitle}</title></svelte:head>
<svelte:window on:keydown={handleKeydown} />

<div
  class="mobile-options-shell"
  class:category-page-open={categoryPageOpen}
  class:hints-expanded={fieldHintsExpanded}
  class:advanced-tweaks-visible={showAdvancedTweaks}
>
  <header class="mobile-options-header">
    <button type="button" aria-label={categoryPageOpen
      ? $t('mobile.options.backToCategories', { default: 'Back to categories' })
      : $t('mobile.options.back', { default: 'Back to player' })} on:click={goBack}>
      <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>
    </button>
    <h1 class="mobile-options-title" tabindex="-1" bind:this={titleElement}>
      <span>{categoryPageOpen ? activeDefinition?.label ?? windowTitle : $t('mobile.options.title', { default: 'Options' })}</span>
      {#if categoryPageOpen}
        <small>{activeParent?.label ?? $t('mobile.options.title', { default: 'Options' })}</small>
      {/if}
    </h1>
  </header>

  <nav class="mobile-options-categories" hidden={categoryPageOpen} bind:this={categoriesElement} aria-label={$t('mobile.options.categories', { default: 'Choose category' })}>
    <MobileOptionsCategories {groups} {auxiliaryViews} on:select={(event) => select(event.detail.view)} />
  </nav>

  {#if categoryPageOpen}
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
  {/if}
</div>
