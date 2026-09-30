<script lang="ts" context="module">
  let instanceCounter = 0;
  const VIEWPORT_PADDING = 6;

  export interface ThemedSelectOption {
    value: string;
    label: string;
    disabled?: boolean;
  }
</script>

<script lang="ts">
  import { createEventDispatcher, onMount, tick } from 'svelte';

  export let value: string;
  export let options: readonly ThemedSelectOption[] = [];
  export let label: string;
  export let disabled = false;
  export let id = `themed-select-${(instanceCounter += 1)}`;

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

  let triggerMinWidth = 0;

  // Size like a native select: fit the longest option so the trigger never
  // stretches the row and never shifts when the selection changes.
  $: {
    void options;
    void triggerElement;
    fitToLongestOption();
  }

  function fitToLongestOption() {
    if (!triggerElement || typeof document === 'undefined' || options.length === 0) return;
    const style = getComputedStyle(triggerElement);
    let textWidth = 0;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (context) {
      context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      for (const option of options) textWidth = Math.max(textWidth, context.measureText(option.label).width);
    } else {
      for (const option of options) textWidth = Math.max(textWidth, option.label.length * 8);
    }
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(style.paddingRight) || 0;
    const gap = Number.parseFloat(style.columnGap || style.gap) || 0;
    const iconWidth = triggerElement.querySelector('.material-symbols-outlined')?.getBoundingClientRect().width ?? 16;
    triggerMinWidth = Math.ceil(textWidth + paddingLeft + paddingRight + gap + iconWidth + 2);
  }

  function isSelectable(index: number): boolean {
    return index >= 0 && index < options.length && !options[index].disabled;
  }

  function updateMenuPosition() {
    if (!triggerElement) return;

    const viewportPadding = VIEWPORT_PADDING;
    const gap = 3;
    const preferredHeight = 190;
    const rect = triggerElement.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding - gap;
    const spaceAbove = rect.top - viewportPadding - gap;
    const opensAbove = spaceBelow < 120 && spaceAbove > spaceBelow;
    const availableHeight = Math.max(64, opensAbove ? spaceAbove : spaceBelow);
    const maxHeight = Math.min(preferredHeight, availableHeight);
    const triggerWidth = Math.min(rect.width, window.innerWidth - viewportPadding * 2);
    const maxWidth = window.innerWidth - viewportPadding * 2;
    const left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - viewportPadding - triggerWidth));

    menuStyle = `left: ${left}px; ${opensAbove
      ? `bottom: ${window.innerHeight - rect.top + gap}px;`
      : `top: ${rect.bottom + gap}px;`} min-width: ${triggerWidth}px; max-width: ${maxWidth}px; max-height: ${maxHeight}px;`;
  }

  async function revealActiveOption() {
    await tick();
    menuElement?.querySelector<HTMLElement>(`[data-option-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' });
    correctMenuOverflow();
  }

  /** Keep a content-sized menu inside the viewport after it paints. */
  function correctMenuOverflow() {
    if (!menuElement) return;
    const overhang = menuElement.getBoundingClientRect().right - (window.innerWidth - VIEWPORT_PADDING);
    if (overhang > 0) {
      const currentLeft = Number.parseFloat(menuElement.style.left) || 0;
      menuElement.style.left = `${Math.max(VIEWPORT_PADDING, currentLeft - overhang)}px`;
    }
  }

  async function openMenu(initialIndex = selectedIndex) {
    if (open || disabled || options.length === 0) return;
    activeIndex = isSelectable(initialIndex) ? initialIndex : options.findIndex((option) => !option.disabled);
    if (activeIndex < 0) activeIndex = selectedIndex;
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
    if (!isSelectable(index)) return;
    const option = options[index];
    if (!option) return;
    dispatch('change', option.value);
    closeMenu();
    triggerElement.focus();
  }

  function moveActive(offset: number) {
    if (options.length === 0) return;
    let index = activeIndex;
    for (let step = 0; step < options.length; step += 1) {
      index = (index + offset + options.length) % options.length;
      if (!options[index].disabled) break;
    }
    if (!options[index].disabled) {
      activeIndex = index;
      void revealActiveOption();
    }
  }

  function findByTypeahead(character: string) {
    if (typeaheadTimer) clearTimeout(typeaheadTimer);
    typeahead += character.toLocaleLowerCase();
    typeaheadTimer = setTimeout(() => (typeahead = ''), 700);

    const start = open ? activeIndex + 1 : selectedIndex + 1;
    for (let offset = 0; offset < options.length; offset += 1) {
      const index = (start + offset) % options.length;
      if (options[index].disabled) continue;
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
      const edge = event.key === 'Home' ? 0 : options.length - 1;
      if (!options[edge].disabled) {
        activeIndex = edge;
        void revealActiveOption();
      } else {
        moveActive(event.key === 'Home' ? 1 : -1);
      }
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

<div class="themed-select" bind:this={rootElement}>
  <button
    class="themed-select-trigger"
    type="button"
    role="combobox"
    aria-label={label}
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-controls={id}
    aria-activedescendant={open ? `${id}-option-${activeIndex}` : undefined}
    disabled={disabled}
    style:min-width={triggerMinWidth ? `${triggerMinWidth}px` : undefined}
    bind:this={triggerElement}
    on:click={() => (open ? closeMenu() : void openMenu())}
    on:keydown={handleKeydown}
  >
    <span>{selectedLabel}</span>
    <span class="material-symbols-outlined" aria-hidden="true">{open ? 'expand_less' : 'expand_more'}</span>
  </button>

  {#if open}
    <div
      class="themed-select-menu"
      id={id}
      role="listbox"
      aria-label={label}
      style={menuStyle}
      bind:this={menuElement}
    >
      {#each options as option, index (option.value)}
        <button
          class="themed-select-option"
          class:active={index === activeIndex}
          class:selected={option.value === value}
          class:option-disabled={option.disabled}
          id={`${id}-option-${index}`}
          type="button"
          role="option"
          tabindex="-1"
          aria-selected={option.value === value}
          aria-disabled={option.disabled}
          data-option-index={index}
          on:mouseenter={() => {
            if (!option.disabled) activeIndex = index;
          }}
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
  .themed-select {
    width: 100%;
  }

  .themed-select-trigger {
    width: fit-content;
    max-width: 100%;
    min-width: 0;
    margin-left: auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 4px 5px 4px 8px;
    border: 1px solid var(--menu-bar-border);
    border-radius: 6px;
    background: var(--bg-input);
    color: var(--text);
    font: inherit;
    text-align: left;
  }

  .themed-select-trigger:disabled {
    opacity: 0.55;
  }

  .themed-select-trigger > span:first-child,
  .themed-select-option > span:last-child {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .themed-select-trigger .material-symbols-outlined {
    width: 16px;
    flex: 0 0 16px;
    color: var(--muted-strong);
    font-size: 16px;
  }

  .themed-select-trigger:focus-visible {
    outline: 1px solid var(--accent-strong);
    outline-offset: 1px;
  }

  .themed-select-menu {
    position: fixed;
    z-index: 1000;
    width: max-content;
    overflow-x: hidden;
    overflow-y: auto;
    padding: 3px;
    border: 1px solid var(--menu-bar-border);
    border-radius: 6px;
    background: var(--bg-input);
    color: var(--text);
    box-shadow: 0 5px 14px rgba(0, 0, 0, 0.22);
  }

  .themed-select-option {
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

  .themed-select-option.active {
    background: var(--hover-surface);
    color: var(--text-strong);
  }

  .themed-select-option.selected {
    background: var(--selection-strong);
    color: var(--text-strong);
  }

  .themed-select-option.option-disabled {
    opacity: 0.45;
  }

  .option-check {
    width: 16px;
    flex: 0 0 auto;
    visibility: hidden;
    color: var(--accent-strong);
    font-size: 14px;
  }

  .themed-select-option.selected .option-check {
    visibility: visible;
  }
</style>
