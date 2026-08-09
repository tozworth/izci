<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import RatingPicker from '$lib/components/RatingPicker.svelte';
  import { keepMenuInViewport } from '$lib/components/playlist-panel/actions/menu-viewport';

  export let value = 0;
  export let actionPrefix = 'rate:';
  export let ariaLabel = 'Rate';
  export let nested = true;

  const dispatch = createEventDispatcher<{ action: string; dismiss: void }>();

  function handleChange(rating: number | undefined) {
    dispatch('action', `${actionPrefix}${rating ?? 'clear'}`);
    dispatch('dismiss');
  }
</script>

<div
  class="rating-menu-surface"
  class:rating-menu-surface-nested={nested}
  use:keepMenuInViewport={nested}
  role="menu"
  aria-label={ariaLabel}
>
  <RatingPicker rating={value} embedded on:change={(event) => handleChange(event.detail)} />
</div>

<style>
  .rating-menu-surface {
    padding: 0.12rem;
  }

  .rating-menu-surface-nested {
    position: absolute;
    top: -0.22rem;
    left: calc(100% + 0.2rem);
    z-index: 1;
    color: var(--menu-popover-text);
    background: var(--menu-popover-bg);
    border: 1px solid var(--menu-popover-border);
    border-radius: 0;
    box-shadow: var(--menu-popover-shadow);
  }
</style>
