<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import { normalizeTrackRating } from '$lib/services/track-ratings';

  export let rating = 0;
  export let compact = false;
  export let embedded = false;

  const dispatch = createEventDispatcher<{ change: number | undefined }>();
  const stars = [1, 2, 3, 4, 5];
  let previewRating: number | undefined;

  $: normalizedRating = normalizeTrackRating(rating) ?? 0;
  $: displayedRating = previewRating ?? normalizedRating;

  function getStarSymbol(star: number): 'star' | 'star_half' {
    const fill = displayedRating - (star - 1);
    return fill >= 1 ? 'star' : fill >= 0.5 ? 'star_half' : 'star';
  }

  function isStarRated(star: number): boolean {
    return displayedRating - (star - 1) >= 0.5;
  }

  function isStarFilled(star: number): boolean {
    return displayedRating - (star - 1) >= 1;
  }

  function select(value: number) {
    dispatch('change', normalizedRating === value ? undefined : value);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="rating-picker"
  class:compact
  class:embedded
  role="group"
  aria-label={$t('main.player.rateTrack', { default: 'Rate track' })}
  on:mouseleave={() => previewRating = undefined}
>
  {#each stars as star, index}
    <span
      class="material-symbols-outlined rating-star"
      class:rated={isStarRated(star)}
      class:filled={isStarFilled(star)}
      style={`grid-column: ${index * 2 + 1} / span 2; grid-row: 1;`}
      aria-hidden="true"
    >
      {getStarSymbol(star)}
    </span>
    <button
      type="button"
      class="rating-hit rating-hit-left"
      style={`grid-column: ${index * 2 + 1}; grid-row: 1;`}
      aria-label={$t('main.player.setRating', { default: 'Set rating to {rating} stars', values: { rating: star - 0.5 } })}
      aria-pressed={normalizedRating === star - 0.5}
      on:mouseenter={() => previewRating = star - 0.5}
      on:focus={() => previewRating = star - 0.5}
      on:blur={() => previewRating = undefined}
      on:click|stopPropagation={() => select(star - 0.5)}
    ></button>
    <button
      type="button"
      class="rating-hit rating-hit-right"
      style={`grid-column: ${index * 2 + 2}; grid-row: 1;`}
      aria-label={$t('main.player.setRating', { default: 'Set rating to {rating} stars', values: { rating: star } })}
      aria-pressed={normalizedRating === star}
      on:mouseenter={() => previewRating = star}
      on:focus={() => previewRating = star}
      on:blur={() => previewRating = undefined}
      on:click|stopPropagation={() => select(star)}
    ></button>
  {/each}
</div>

<style>
  .rating-picker {
    position: relative;
    display: grid;
    grid-template-columns: repeat(10, 0.55rem);
    align-items: center;
    height: 1.45rem;
    padding: 0 0.28rem;
    color: color-mix(in srgb, var(--text) 38%, transparent);
    background: var(--surface-raised, var(--surface));
    border: 1px solid var(--border-subtle, var(--border));
    border-radius: 4px;
    box-shadow: 0 0.28rem 0.85rem color-mix(in srgb, #000 28%, transparent);
    white-space: nowrap;
  }

  .rating-star {
    width: 1.1rem;
    height: 1.1rem;
    color: color-mix(in srgb, var(--text) 38%, transparent);
    font-size: 1.08rem;
    line-height: 1.1rem;
    font-variation-settings: 'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 20;
  }

  .rating-star.rated {
    color: #e6ae27;
    filter: drop-shadow(0 0 0.2rem color-mix(in srgb, #e6ae27 45%, transparent));
  }

  .rating-star.filled {
    font-variation-settings: 'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 20;
  }

  .rating-hit {
    z-index: 1;
    width: 0.55rem;
    height: 1.25rem;
    padding: 0;
    background: transparent;
    border: 0;
  }

  .rating-hit:focus-visible {
    outline: 1px solid var(--accent-strong);
    outline-offset: -1px;
  }

  .compact {
    transform: scale(0.9);
    transform-origin: bottom center;
  }

  .embedded {
    height: 1.6rem;
    padding: 0 0.18rem;
    background: transparent;
    border: 0;
    box-shadow: none;
  }
</style>
