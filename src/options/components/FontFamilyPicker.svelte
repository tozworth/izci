<script lang="ts">
  import { createEventDispatcher, onMount, tick } from 'svelte';

  interface FontFamilyOption {
    value: string;
    label: string;
  }

  export let value: string;
  export let options: FontFamilyOption[] = [];
  export let label: string;

  const dispatch = createEventDispatcher<{ change: string }>();

  let rootElement: HTMLDivElement;
  let triggerElement: HTMLButtonElement;
  let menuElement: HTMLDivElement;
  let open = false;
  let activeIndex = 0;
  let menuStyle = '';
  let typeahead = '';
  let typeaheadTimer: ReturnType<typeof setTimeout> | undefined;

  $: selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  $: selectedLabel = options[selectedIndex]?.label ?? value;

  function updateMenuPosition() {
    if (!triggerElement) return;

    const viewportPadding = 6;
    const gap = 3;
    const preferredHeight = 190;
    const rect = triggerElement.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding - gap;
    const spaceAbove = rect.top - viewportPadding - gap;
    const opensAbove = spaceBelow < 120 && spaceAbove > spaceBelow;
    const availableHeight = Math.max(64, opensAbove ? spaceAbove : spaceBelow);
    const maxHeight = Math.min(preferredHeight, availableHeight);
    const width = Math.min(rect.width, window.innerWidth - viewportPadding * 2);
    const left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - viewportPadding - width));
    const verticalPosition = opensAbove
      ? `bottom: ${window.innerHeight - rect.top + gap}px;`
      : `top: ${rect.bottom + gap}px;`;

    menuStyle = `left: ${left}px; ${verticalPosition} width: ${width}px; max-height: ${maxHeight}px;`;
  }

  async function revealActiveOption() {
    await tick();
    menuElement?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  async function openMenu(initialIndex = selectedIndex) {
    if (open || options.length === 0) return;
    activeIndex = initialIndex;
    updateMenuPosition();
    open = true;
    await revealActiveOption();
  }

  function closeMenu() {
    open = false;
    typeahead = '';
    if (typeaheadTimer) clearTimeout(typeaheadTimer);
  }

  function selectOption(index: number) {
    const option = options[index];
    if (!option) return;
    dispatch('change', option.value);
    closeMenu();
    triggerElement.focus();
  }

  function moveActive(offset: number) {
    if (options.length === 0) return;
    activeIndex = (activeIndex + offset + options.length) % options.length;
    void revealActiveOption();
  }

  function findByTypeahead(character: string) {
    if (typeaheadTimer) clearTimeout(typeaheadTimer);
    typeahead += character.toLocaleLowerCase();
    typeaheadTimer = setTimeout(() => (typeahead = ''), 700);

    const start = open ? activeIndex + 1 : selectedIndex + 1;
    for (let offset = 0; offset < options.length; offset += 1) {
      const index = (start + offset) % options.length;
      if (options[index].label.toLocaleLowerCase().startsWith(typeahead)) {
        if (!open) void openMenu(index);
        else {
          activeIndex = index;
          void revealActiveOption();
        }
        return;
      }
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) void openMenu(event.key === 'ArrowDown' ? selectedIndex : options.length - 1);
      else moveActive(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }

    if (open && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault();
      activeIndex = event.key === 'Home' ? 0 : options.length - 1;
      void revealActiveOption();
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) selectOption(activeIndex);
      else void openMenu();
      return;
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault();
      closeMenu();
      return;
    }

    if (event.key === 'Tab') {
      closeMenu();
      return;
    }

    if (!event.ctrlKey && !event.altKey && !event.metaKey && event.key.length === 1 && event.key.trim()) {
      findByTypeahead(event.key);
    }
  }

  function handleDocumentPointerDown(event: PointerEvent) {
    if (open && !rootElement.contains(event.target as Node)) closeMenu();
  }

  function handleScroll(event: Event) {
    if (open && !menuElement?.contains(event.target as Node)) closeMenu();
  }

  function handleResize() {
    if (open) updateMenuPosition();
  }

  onMount(() => {
    document.addEventListener('pointerdown', handleDocumentPointerDown);
    document.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);

    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
      document.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
      if (typeaheadTimer) clearTimeout(typeaheadTimer);
    };
  });
</script>

<div class="font-picker" bind:this={rootElement}>
  <button
    class="font-picker-trigger"
    type="button"
    role="combobox"
    aria-label={label}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls="font-family-options"
    aria-activedescendant={open ? `font-family-option-${activeIndex}` : undefined}
    bind:this={triggerElement}
    on:click={() => (open ? closeMenu() : void openMenu())}
    on:keydown={handleKeydown}
  >
    <span>{selectedLabel}</span>
    <span class="material-symbols-outlined" aria-hidden="true">{open ? 'expand_less' : 'expand_more'}</span>
  </button>

  {#if open}
    <div
      class="font-picker-menu"
      id="font-family-options"
      role="listbox"
      aria-label={label}
      style={menuStyle}
      bind:this={menuElement}
    >
      {#each options as option, index (option.value)}
        <button
          class="font-picker-option"
          class:active={index === activeIndex}
          class:selected={option.value === value}
          id={`font-family-option-${index}`}
          type="button"
          role="option"
          tabindex="-1"
          aria-selected={option.value === value}
          data-option-index={index}
          on:mouseenter={() => (activeIndex = index)}
          on:pointerdown={(event) => event.preventDefault()}
          on:click={() => selectOption(index)}
        >
          <span class="option-check material-symbols-outlined" aria-hidden="true">check</span>
          <span>{option.label}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .font-picker {
    width: 100%;
  }

  .font-picker-trigger {
    width: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 4px 5px 4px 8px;
    border: 1px solid var(--menu-bar-border);
    border-radius: 6px;
    background: var(--bg-input);
    color: var(--text);
    text-align: left;
  }

  .font-picker-trigger > span:first-child,
  .font-picker-option > span:last-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .font-picker-trigger .material-symbols-outlined {
    flex: 0 0 auto;
    color: var(--muted-strong);
    font-size: 16px;
  }

  .font-picker-trigger:focus-visible {
    outline: 1px solid var(--accent-strong);
    outline-offset: 1px;
  }

  .font-picker-menu {
    position: fixed;
    z-index: 1000;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 3px;
    border: 1px solid var(--menu-bar-border);
    border-radius: 6px;
    background: var(--bg-input);
    color: var(--text);
    box-shadow: 0 5px 14px rgba(0, 0, 0, 0.22);
  }

  .font-picker-option {
    width: 100%;
    min-height: 25px;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 6px 3px 2px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 0.78rem;
    text-align: left;
  }

  .font-picker-option.active {
    background: var(--hover-surface);
    color: var(--text-strong);
  }

  .font-picker-option.selected {
    background: var(--selection-strong);
    color: var(--text-strong);
  }

  .option-check {
    width: 16px;
    flex: 0 0 auto;
    visibility: hidden;
    color: var(--accent-strong);
    font-size: 14px;
  }

  .font-picker-option.selected .option-check {
    visibility: visible;
  }
</style>
