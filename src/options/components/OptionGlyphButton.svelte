<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';

  export let icon: string;
  export let label: string;
  export let disabled = false;
  export let pressed: boolean | undefined = undefined;
  export let danger = false;
  export let placement: 'above' | 'below' = 'below';

  const dispatch = createEventDispatcher<{ click: MouseEvent }>();
</script>

<button
  class="glyph-button hover-tooltip-anchor"
  class:is-active={pressed === true}
  class:is-danger={danger}
  type="button"
  {disabled}
  aria-label={label}
  aria-pressed={pressed}
  on:click={(event) => dispatch('click', event)}
>
  <span class="material-symbols-outlined" aria-hidden="true">{icon}</span>
  <HoverTooltip {placement}>{label}</HoverTooltip>
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

</style>
