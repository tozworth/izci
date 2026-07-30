<script lang="ts">
  export let ariaLabel: string;
  export let className = '';
  export let element: HTMLDivElement | null = null;
  export let flushStart = false;
  export let tabIndex: number | undefined = undefined;
</script>

<div
  class={`tab-strip ${className}`.trim()}
  class:is-flush-start={flushStart}
  bind:this={element}
  role="tablist"
  aria-label={ariaLabel}
  tabindex={tabIndex}
  on:dragover
  on:drop
  on:dragleave
>
  <slot />
</div>

<style>
  .tab-strip {
    position: relative;
    display: flex;
    align-items: flex-end;
    gap: var(--tab-strip-gap, 0);
    min-width: 0;
    color: var(--tab-strip-text, var(--text));
    background: var(--tab-strip-background, transparent);
    isolation: isolate;
  }

  .tab-strip::after {
    content: "";
    position: absolute;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 0;
    height: 1px;
    background: var(--tab-strip-border, var(--border-soft));
    pointer-events: none;
  }

  .tab-strip :global(.tab-strip-tab) {
    position: relative;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--tab-strip-tab-gap, 0.3rem);
    min-width: 0;
    min-height: var(--tab-strip-tab-min-height, 1.65rem);
    padding: var(--tab-strip-tab-padding, 0.22rem 0.4rem 0.32rem);
    color: var(--tab-strip-muted, var(--muted));
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--tab-strip-radius, 0.36rem) var(--tab-strip-radius, 0.36rem) 0 0;
    line-height: 1;
    transition:
      color 150ms ease,
      background-color 150ms ease,
      border-color 150ms ease;
  }

  .tab-strip :global(.tab-strip-tab:hover) {
    color: var(--tab-strip-hover-color, var(--text-strong));
    background: var(--tab-strip-hover-background, var(--accent-strong-soft));
  }

  .tab-strip :global(.tab-strip-tab.active),
  .tab-strip :global(.tab-strip-tab[aria-selected='true']) {
    z-index: 2;
    color: var(--tab-strip-active-color, var(--text-strong));
    background: var(--tab-strip-active-background, color-mix(in srgb, var(--bg-elevated) 84%, var(--accent-strong-soft)));
    border-color: var(--tab-strip-border, var(--border-soft));
    border-bottom-color: var(--tab-strip-active-background, color-mix(in srgb, var(--bg-elevated) 84%, var(--accent-strong-soft)));
  }

  .tab-strip :global(.tab-strip-tab > .material-symbols-outlined) {
    transition: color 150ms ease;
  }

  .tab-strip :global(.tab-strip-tab:hover > .material-symbols-outlined),
  .tab-strip :global(.tab-strip-tab.active > .material-symbols-outlined),
  .tab-strip :global(.tab-strip-tab[aria-selected='true'] > .material-symbols-outlined) {
    color: var(--tab-strip-active-icon-color, var(--accent-strong));
  }

  :global(.tab-strip.is-flush-start > :first-child > .tab-strip-tab),
  :global(.tab-strip.is-flush-start > .tab-strip-tab:first-child) {
    border-top-left-radius: 0;
  }
</style>
