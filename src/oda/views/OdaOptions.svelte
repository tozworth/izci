<script lang="ts">
  import { tick } from 'svelte';
  import type { SharedOptionsViewDefinition } from '$lib/components/options/OptionsView.svelte';
  import { resetOptionsView } from '../../options/options-reset';
  import type { OptionsViewName } from '../../options/views';
  import type { OdaTranslate } from '../oda-translate';
  import { handleOdaOptionsKeydown } from '../oda-options-keyboard';

  export let groups: SharedOptionsViewDefinition[][] = [];
  export let auxiliaryViews: SharedOptionsViewDefinition[] = [];
  export let activeView: OptionsViewName;
  export let focusId: string | null = null;
  export let contentActive = false;
  export let translate: OdaTranslate;
  export let advancedTweaksModified = false;
  export let onFocus: (focusId: string) => void = () => {};
  export let onSelectView: (view: OptionsViewName) => void = () => {};

  function categoryFocusId(viewId: string): string {
    return `option:${viewId}`;
  }

  let showAdvancedTweaks = false;
  let hintsExpanded = false;
  let contentHost: HTMLElement | null = null;
  let categoriesNav: HTMLElement | null = null;

  $: allViews = [...groups.flat(), ...auxiliaryViews].filter((view) => !view.hidden);
  $: activeDefinition = allViews.find((view) => view.id === activeView) ?? allViews[0] ?? null;
  $: activeParent = activeDefinition?.parentId
    ? allViews.find((view) => view.id === activeDefinition?.parentId) ?? null
    : null;

  // Entering the content pane moves DOM focus to the first control. Up/Down
  // moves between fields; an explicitly opened select owns option navigation.
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

  // Remote navigation moves logical focus without touching DOM focus, so keep
  // the focused category scrolled into view while the category list owns input.
  $: {
    void contentActive;
    void focusId;
    void categoriesNav;
    if (!contentActive && focusId && categoriesNav) {
      const current = focusId;
      const nav = categoriesNav;
      void tick().then(() => {
        nav
          .querySelector(`[data-category-focus-id="${current}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      });
    }
  }

  async function focusFirstControl(): Promise<void> {
    await tick();
    if (!contentActive || !contentHost) return;
    const pane = contentHost.querySelector<HTMLElement>('.view');
    const target = pane?.querySelector<HTMLElement>(
      'input:not([type="hidden"]), select, textarea, button, [tabindex]:not([tabindex="-1"])'
    );
    target?.focus();
    target?.scrollIntoView({ block: 'nearest' });
  }

  function focusableControls(): HTMLElement[] {
    if (!contentHost) return [];
    return Array.from(contentHost.querySelectorAll<HTMLElement>(
      'input:not([type="hidden"]):not([tabindex="-1"]), select, textarea, button:not(:disabled):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => element.offsetParent !== null && !element.hasAttribute('disabled'));
  }

  function moveControlFocus(target: EventTarget | null, delta: -1 | 1): void {
    const controls = focusableControls();
    const current = target instanceof HTMLElement ? controls.indexOf(target) : -1;
    const next = controls[Math.min(Math.max(current + delta, 0), controls.length - 1)];
    next?.focus();
    next?.scrollIntoView({ block: 'nearest' });
  }

  function handleContentKeydown(event: KeyboardEvent): void {
    if (!contentActive) return;
    handleOdaOptionsKeydown(event, moveControlFocus);
  }

  function contentKeyboardNavigation(node: HTMLElement) {
    node.addEventListener('keydown', handleContentKeydown, true);
    return { destroy: () => node.removeEventListener('keydown', handleContentKeydown, true) };
  }

  function handleReset(): void {
    if (activeDefinition?.resettable !== true) return;
    resetOptionsView(activeView);
  }
</script>

<div class="oda-options">
  <nav
    bind:this={categoriesNav}
    class="oda-options-categories"
    aria-label={translate('oda.options.categories', 'Options categories')}
  >
    {#each groups as group}
      {#each group as view}
        {#if !view.hidden}
          {@const viewFocusId = categoryFocusId(view.id)}
          <button
            type="button"
            class="oda-options-category"
            class:is-focused={focusId === viewFocusId}
            class:is-active={activeView === view.id}
            class:is-child={view.parentId != null}
            data-category-focus-id={viewFocusId}
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
    use:contentKeyboardNavigation
    bind:this={contentHost}
    class="oda-options-content options-shell"
    class:about-content-panel={activeView === 'about'}
    class:advanced-tweaks-visible={showAdvancedTweaks}
    class:hints-expanded={hintsExpanded}
    aria-label={activeDefinition?.label ?? translate('oda.options.categories', 'Options')}
  >
    <div class="oda-options-toolbar">
      <p class="oda-options-breadcrumb">
        {#if activeParent}
          <span>{activeParent.label}</span>
          <span class="material-symbols-outlined" aria-hidden="true">chevron_right</span>
        {/if}
        <strong>{activeDefinition?.label ?? ''}</strong>
      </p>
      <span class="oda-options-nav-hint">{translate('oda.options.navigationHint', 'Up/Down moves · Left/Right adjusts · Back returns')}</span>
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
      <svelte:component
        this={optionsModule.default}
        {activeView}
        {onSelectView}
        on:ready={() => { if (contentActive) void focusFirstControl(); }}
      />
    {/await}
  </section>
</div>
