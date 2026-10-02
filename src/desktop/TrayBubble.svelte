<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import { createTrayBubblePresenter } from './tray-bubble-presenter';
  import type { TrayBubbleContent } from './tray-bubble-protocol';

  let content: TrayBubbleContent | null = null;
  let visible = false;
  let bubble: HTMLDivElement;

  onMount(() => createTrayBubblePresenter(
    (next, shown) => { content = next; visible = shown; },
    async () => {
      await tick();
      await document.fonts.ready;
      // Measure independently of the previous track's native window width.
      bubble.style.maxWidth = '440px';
      const bounds = bubble.getBoundingClientRect();
      const size = { width: Math.ceil(bounds.width) + 1, height: Math.ceil(bounds.height) };
      bubble.style.removeProperty('max-width');
      return size;
    },
  ));
</script>

<div bind:this={bubble} class="track-bubble" class:visible role="status" aria-live="polite">
  {#if content && 'percent' in content}
    <span class="material-symbols-outlined volume-glyph" aria-hidden="true">{content.percent === 0 ? 'volume_off' : content.percent < 50 ? 'volume_down' : 'volume_up'}</span>
    <strong class="volume-percent" aria-label={$t('desktop.tray.volume', { values: { percent: content.percent } })}>{content.percent}%</strong>
  {:else}
    <span class="izci-glyph" aria-hidden="true"></span>
    <span class="track-info"><strong class="title">{content?.title ?? ''}</strong>{#if content?.artist}<span class="artist">{content.artist}</span>{/if}</span>
  {/if}
</div>
