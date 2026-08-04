<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let title: string;
  export let message: string;
  export let dismissLabel = 'Dismiss';

  const dispatch = createEventDispatcher<{ dismiss: void }>();
</script>

<aside class="status-toast" role="alert" aria-live="assertive">
  <span class="material-symbols-outlined status-toast-icon" aria-hidden="true">signal_disconnected</span>
  <div class="status-toast-copy">
    <strong>{title}</strong>
    <span>{message}</span>
  </div>
  <button type="button" aria-label={dismissLabel} on:click={() => dispatch('dismiss')}>
    <span class="material-symbols-outlined" aria-hidden="true">close</span>
  </button>
</aside>

<style>
  .status-toast {
    position: fixed;
    z-index: 220;
    right: 0.75rem;
    bottom: calc(var(--player-bar-measured-reserve, 4.25rem) + 0.65rem);
    width: min(30rem, calc(100vw - 1.5rem));
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: start;
    gap: 0.55rem;
    padding: 0.65rem 0.65rem 0.65rem 0.75rem;
    border: 1px solid color-mix(in srgb, var(--danger) 48%, var(--border));
    border-radius: 0.45rem;
    background: var(--bg-elevated);
    color: var(--text);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
  }

  .status-toast-icon {
    margin-top: 0.08rem;
    color: var(--danger);
    font-size: 1.1rem;
  }

  .status-toast-copy {
    min-width: 0;
    display: grid;
    gap: 0.18rem;
    font-size: 0.76rem;
    line-height: 1.35;
  }

  .status-toast-copy strong {
    color: var(--text-strong);
    font-size: 0.78rem;
  }

  .status-toast-copy span {
    overflow-wrap: anywhere;
  }

  button {
    width: 1.6rem;
    height: 1.6rem;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 0.3rem;
    background: transparent;
    color: var(--muted);
  }

  button:hover {
    background: var(--hover-subtle);
    color: var(--text-strong);
  }

  @media (max-width: 700px) {
    .status-toast {
      right: 0.5rem;
      bottom: calc(var(--mobile-bottom-nav-height, 4.35rem) + 0.5rem);
      width: calc(100vw - 1rem);
    }
  }
</style>
