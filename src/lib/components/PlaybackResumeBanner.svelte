<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import { formatDuration } from '$lib/utils/files';

  export let currentTime: number;

  const dispatch = createEventDispatcher<{
    startOver: void;
    dismiss: void;
  }>();
</script>

<aside class="resume-banner" role="status">
  <span>
    {$t('main.playbackProgress.resumedAt', {
      default: 'Resumed at {position}',
      values: { position: formatDuration(currentTime) }
    })}
  </span>
  <button class="start-over" type="button" on:click={() => dispatch('startOver')}>
    {$t('main.playbackProgress.startOver', { default: 'Start over' })}
  </button>
  <button
    class="dismiss"
    type="button"
    aria-label={$t('main.playbackProgress.dismiss', { default: 'Dismiss resume message' })}
    on:click={() => dispatch('dismiss')}
  >
    <span class="material-symbols-outlined" aria-hidden="true">close</span>
  </button>
</aside>

<style>
  .resume-banner {
    position: fixed;
    left: 0.5rem;
    bottom: calc(var(--player-bar-measured-reserve, var(--player-bar-reserve)) + 0.18rem);
    z-index: 30;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    max-width: calc(100vw - 1.5rem);
    padding: 0.16rem 0.3rem 0.16rem 0.45rem;
    border: 1px solid var(--border-strong);
    border-radius: 0.3rem;
    background: var(--bg-elevated);
    color: var(--text);
    font-size: 0.7rem;
    box-shadow: 0 0.45rem 1.5rem rgba(0, 0, 0, 0.24);
    white-space: nowrap;
  }

  :global(.app-shell.now-playing-mode) .resume-banner {
    bottom: 0.5rem;
  }

  :global(.player-bar:not(.now-playing-player) > .player-range > .range-control) {
    anchor-name: --player-seek;
  }

  :global(.app-shell:has(> .player-bar.compact-player-bar)) .resume-banner {
    position-anchor: --player-seek;
    left: anchor(left);
    bottom: calc(anchor(top) + 0.18rem);
  }

  button {
    padding: 0;
    background: transparent;
    color: inherit;
    cursor: default;
  }

  .start-over {
    color: var(--accent-strong);
    font-weight: 600;
  }

  .dismiss {
    display: inline-grid;
    place-items: center;
    width: 1.15rem;
    height: 1.15rem;
    margin-left: -0.06rem;
    border-radius: 50%;
    color: var(--muted);
  }

  .dismiss:hover {
    background: var(--bg-soft);
    color: var(--text-strong);
  }

  .dismiss .material-symbols-outlined {
    font-size: 0.85rem;
    line-height: 1;
    transform: translateY(0.05rem);
  }
</style>
