<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { expandedOptionsCategories, toggleOptionsCategory } from '$lib/stores/options-tree-state';
  import type { SharedOptionsViewDefinition } from './OptionsView.svelte';

  export let groups: SharedOptionsViewDefinition[][];
  export let activeView: string;
  export let categoriesLabel: string;

  const dispatch = createEventDispatcher<{ select: { view: string } }>();
  let focusedViewId: string | null = null;

  $: expandedCategories = new Set($expandedOptionsCategories);
  $: availableViews = groups.flat().filter((view) => !view.hidden);
  $: categoryIds = new Set(availableViews.flatMap((view) => view.parentId ? [view.parentId] : []));
  $: visibleGroups = groups.map((group) => group.filter((view) =>
    !view.hidden && (!view.parentId || expandedCategories.has(view.parentId))
  ));
  $: visibleViews = visibleGroups.flat();
  $: activeDefinition = availableViews.find((view) => view.id === activeView);
  $: tabStopId = visibleViews.find((view) => view.id === focusedViewId)?.id
    ?? visibleViews.find((view) => view.id === activeView)?.id
    ?? visibleViews.find((view) => view.id === activeDefinition?.parentId)?.id
    ?? visibleViews[0]?.id;

  function toggleCategory(id: string): void {
    toggleOptionsCategory(id);
  }

  function handleRowClick(event: MouseEvent, view: SharedOptionsViewDefinition): void {
    (event.currentTarget as HTMLButtonElement).focus();
    if (categoryIds.has(view.id) && (activeView === view.id || !expandedCategories.has(view.id))) {
      toggleCategory(view.id);
    }
    dispatch('select', { view: view.id });
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;

    const tree = event.currentTarget as HTMLElement;
    const items = Array.from(tree.querySelectorAll<HTMLButtonElement>('.tree-item'));
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const currentView = visibleViews[currentIndex];
    if (items.length === 0) return;
    event.preventDefault();

    if (event.key === 'ArrowRight') {
      if (!currentView || !categoryIds.has(currentView.id)) return;
      if (!expandedCategories.has(currentView.id)) toggleCategory(currentView.id);
      else items[visibleViews.findIndex((view) => view.parentId === currentView.id)]?.focus();
      return;
    }
    if (event.key === 'ArrowLeft') {
      if (!currentView) return;
      if (expandedCategories.has(currentView.id)) toggleCategory(currentView.id);
      else if (currentView.parentId) items[visibleViews.findIndex((view) => view.id === currentView.parentId)]?.focus();
      return;
    }

    let nextIndex: number;
    if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    else nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    items[nextIndex]?.focus();
  }
</script>

<aside class="tree-panel" aria-label={categoriesLabel}>
  <!-- Keep every label in intrinsic sizing, including collapsed and disabled categories. -->
  <div class="tree-sizing" aria-hidden="true">
    {#each groups.flat() as view (view.id)}
      <span class="tree-item" class:child={view.parentId != null}>
        <span class="tree-chevron"></span>
        <span class="tree-icon"></span>
        <span class="tree-label">{view.label}</span>
      </span>
    {/each}
  </div>
  <div class="tree" role="tree" aria-label={categoriesLabel} tabindex="-1" on:keydown={handleKeydown}>
    {#each visibleGroups as group}
      <div class="tree-group" role="none">
        {#each group as view (view.id)}
          <button
            class="tree-item"
            class:child={view.parentId != null}
            type="button"
            role="treeitem"
            aria-level={view.parentId ? 2 : 1}
            aria-selected={activeView === view.id}
            aria-expanded={categoryIds.has(view.id) ? expandedCategories.has(view.id) : undefined}
            tabindex={tabStopId === view.id ? 0 : -1}
            on:focus={() => (focusedViewId = view.id)}
            on:click={(event) => handleRowClick(event, view)}
          >
            <span class="tree-chevron" aria-hidden="true">
              {#if categoryIds.has(view.id)}
                <span class="material-symbols-outlined">{expandedCategories.has(view.id) ? 'expand_more' : 'chevron_right'}</span>
              {/if}
            </span>
            <span class="material-symbols-outlined tree-icon" aria-hidden="true">{view.icon}</span>
            <span class="tree-label">{view.label}</span>
          </button>
        {/each}
      </div>
    {/each}
  </div>
</aside>
