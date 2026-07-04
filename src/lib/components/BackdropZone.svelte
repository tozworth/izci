<script lang="ts">
  import { hasArtworkBackdrop, hasVisualizerBackdrop } from '$lib/stores/appearance-settings';
  import type { LoadedStreamArtwork } from '$lib/services/stream-artwork';
  import type { BackdropZoneEffect } from '$lib/types';

  export let effect: BackdropZoneEffect = 'none';
  export let artwork: LoadedStreamArtwork | null = null;
  export let artworkBright = false;
  export let fillParent = false;
  export let className = '';

  $: artworkActive = hasArtworkBackdrop(effect) && Boolean(artwork);
  $: visualizerActive = hasVisualizerBackdrop(effect);
</script>

<div
  class={`backdrop-zone ${className}`}
  class:fill-parent={fillParent}
  class:artwork-backdrop-active={artworkActive}
  class:artwork-backdrop-bright={artworkActive && artworkBright}
  class:visualizer-backdrop-active={visualizerActive}
  data-artwork-zone={artworkActive ? 'true' : null}
  data-visualizer-zone={visualizerActive ? 'true' : null}
>
  <div class="backdrop-zone-content">
    <slot />
  </div>
</div>
