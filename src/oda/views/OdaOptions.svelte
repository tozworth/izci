<script lang="ts">
  import { tick } from 'svelte';
  import type { SharedOptionsViewDefinition } from '$lib/components/options/OptionsView.svelte';
  import { resetOptionsView } from '../../options/options-reset';
  import type { OptionsViewName } from '../../options/views';
  import type { OdaTranslate } from '../oda-translate';

  export let groups: SharedOptionsViewDefinition[][] = [];
  export let auxiliaryViews: SharedOptionsViewDefinition[] = [];
  export let activeView: OptionsViewName;
  export let focusId: string | null = null;
  export let contentActive = false;
  export let translate: OdaTranslate;
  export let advancedTweaksModified = false;
  export let onFocus: (focusId: string) => void = () => {};
  export let onSelectView: (view: OptionsViewName) => void = () => {};
  export let onExitOda: () => void = () => {};

  function categoryFocusId(viewId: string): string {
    return `option:${viewId}`;
  }

  const EXIT_ODA_FOCUS_ID = 'option:exit-oda';

  let showAdvancedTweaks = false;
  let hintsExpanded = false;
  let contentHost: HTMLElement | null = null;

  $: allViews = [...groups.flat(), ...auxiliaryViews].filter((view) => !view.hidden);
  $: activeDefinition = allViews.find((view) => view.id === activeView) ?? allViews[0] ?? null;
  $: activeParent = activeDefinition?.parentId
    ? allViews.find((view) => view.id === activeDefinition?.parentId) ?? null
    : null;

  // Entering the content pane moves DOM focus to the first control so native
  // sliders/selects/toggles own the arrow keys immediately.
  $: if (contentActive && contentHost) {
    void activeView;
    void focusFirstControl();
  }

  // Leaving the content pane must release DOM focus, or the previously
  // focused native control would keep swallowing Oda's arrow navigation.
  $: if (!contentActive && contentHost) {
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    if (active instanceof HTMLElement && contentHost.contains(active)) active.blur();
  }

  async function focusFirstControl(): Promise<void> {
    await tick();
    if (!contentHost) return;
    const pane = contentHost.querySelector<HTMLElement>('.view') ?? contentHost;
    const target = pane.querySelector<HTMLElement>(
      'input:not([type="hidden"]), select, textarea, button, [tabindex]:not([tabindex="-1"])'
    );
    target?.focus();
  }

  function handleReset(): void {
    if (activeDefinition?.resettable !== true) return;
    resetOptionsView(activeView);
  }
</script>

<div class="oda-options">
  <nav class="oda-options-categories" aria-label={translate('oda.options.categories', 'Options categories')}>
    <button
      type="button"
      class="oda-options-category"
      class:is-focused={focusId === EXIT_ODA_FOCUS_ID}
      on:click={() => { onFocus(EXIT_ODA_FOCUS_ID); onExitOda(); }}
    >
      <span class="material-symbols-outlined" aria-hidden="true">logout</span>
      <span>{translate('oda.options.exitOda', 'Exit Oda')}</span>
    </button>

    {#each groups as group}
      {#each group as view}
        {#if !view.hidden}
          {@const viewFocusId = categoryFocusId(view.id)}
          <button
            type="button"
            class="oda-options-category"
            class:is-focused={focusId === viewFocusId}
            class:is-active={activeView === view.id}
            on:click={() => { onFocus(viewFocusId); onSelectView(view.id as OptionsViewName); }}
          >
            <span class="material-symbols-outlined" aria-hidden="true">{view.icon}</span>
            <span>{view.label}</span>
          </button>
        {/if}
      {/each}
    {/each}
  </nav>

  <section
    bind:this={contentHost}
    class="oda-options-content options-shell"
    class:advanced-tweaks-visible={showAdvancedTweaks}
    class:hints-expanded={hintsExpanded}
  >
    <div class="oda-options-toolbar">
      <p class="oda-options-breadcrumb">
        {#if activeParent}
          <span>{activeParent.label}</span>
          <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>
        {/if}
        <strong>{activeDefinition?.label ?? ''}</strong>
      </p>
      <button
        type="button"
        class:is-active={showAdvancedTweaks || advancedTweaksModified}
        on:click={() => (showAdvancedTweaks = !showAdvancedTweaks)}
      >{translate('oda.options.advanced', 'Advanced tweaks')}</button>
      <button
        type="button"
        class:is-active={hintsExpanded}
        on:click={() => (hintsExpanded = !hintsExpanded)}
      >{translate('oda.options.hints', 'Field hints')}</button>
      <button
        type="button"
        disabled={activeDefinition?.resettable !== true}
        on:click={handleReset}
      >{translate('oda.options.reset', 'Reset page')}</button>
    </div>

    {#await import('../../options/OptionsContent.svelte') then optionsModule}
      <svelte:component this={optionsModule.default} {activeView} onSelectView={onSelectView} />
    {/await}
  </section>
</div>
