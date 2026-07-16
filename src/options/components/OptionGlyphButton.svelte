<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let icon: string;
  export let label: string;
  export let disabled = false;
  export let pressed: boolean | undefined = undefined;
  export let danger = false;
  export let placement: 'above' | 'below' = 'below';

  const dispatch = createEventDispatcher<{ click: MouseEvent }>();
</script>

<button
  class="glyph-button"
  class:is-active={pressed === true}
  class:is-danger={danger}
  class:is-above={placement === 'above'}
  type="button"
  {disabled}
  aria-label={label}
  aria-pressed={pressed}
  on:click={(event) => dispatch('click', event)}
>
  <span class="material-symbols-outlined" aria-hidden="true">{icon}</span>
  <span class="glyph-tooltip" role="tooltip">{label}</span>
</button>

<style>
  .glyph-button {
    position: relative;
    display: inline-grid;
    place-items: center;
    width: 26px;
    height: 26px;
    padding: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--muted-strong);
  }

  .glyph-button:hover:not(:disabled),
  .glyph-button:focus-visible {
    background: var(--hover-surface);
    color: var(--text-strong);
  }

  .glyph-button.is-active {
    color: var(--accent-strong);
  }

  .glyph-button.is-danger:hover:not(:disabled),
  .glyph-button.is-danger:focus-visible {
    color: #e27c74;
  }

  .glyph-button:disabled {
    opacity: 0.38;
  }

  .glyph-tooltip {
    position: absolute;
    z-index: 80;
    top: calc(100% + 4px);
    right: 0;
    width: max-content;
    max-width: min(240px, 70vw);
    padding: 4px 7px;
    border: 1px solid var(--menu-bar-border);
    border-radius: 5px;
    background: var(--bg-elevated);
    color: var(--text-strong);
    box-shadow: 0 5px 14px rgba(0, 0, 0, 0.28);
    font-size: 0.68rem;
    font-weight: 400;
    line-height: 1.25;
    opacity: 0;
    pointer-events: none;
    transform: translateY(-2px) scale(0.98);
    transform-origin: top right;
    transition: opacity 55ms ease-out, transform 55ms ease-out;
    white-space: normal;
  }

  .glyph-button:hover .glyph-tooltip,
  .glyph-button:focus-visible .glyph-tooltip {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  .glyph-button.is-above .glyph-tooltip {
    top: auto;
    bottom: calc(100% + 4px);
    transform: translateY(2px) scale(0.98);
    transform-origin: bottom right;
  }

  .glyph-button.is-above:hover .glyph-tooltip,
  .glyph-button.is-above:focus-visible .glyph-tooltip {
    transform: translateY(0) scale(1);
  }
</style>
