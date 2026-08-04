<script lang="ts">
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import MultiplayerMark from './MultiplayerMark.svelte';

  export let title = 'Multiplayer';
  export let notice: string;
  export let statusLine: string;
  export let failed = false;
  export let closeLabel = 'Close';
  export let markLabel = 'izci multiplayer';

  const dispatch = createEventDispatcher<{ dismiss: void }>();
  let dialog: HTMLDialogElement;

  function dismiss(): void {
    dispatch('dismiss');
  }

  function handleCancel(event: Event): void {
    event.preventDefault();
    if (failed) dismiss();
  }

  onMount(() => {
    void tick().then(() => {
      if (!dialog.open) dialog.showModal();
      dialog.focus();
    });
    return () => {
      if (dialog.open) dialog.close();
    };
  });
</script>

<dialog
  bind:this={dialog}
  class:failed
  aria-labelledby="multiplayer-connection-title"
  aria-describedby="multiplayer-connection-status"
  tabindex="-1"
  on:cancel={handleCancel}
>
  <div class="connection-layout">
    <MultiplayerMark size="0.96rem" label={markLabel} />
    <div class="connection-copy">
      <h2 id="multiplayer-connection-title">{title}</h2>
      <p class="connection-notice">{notice}</p>
      <p id="multiplayer-connection-status" class="connection-status" role="status" aria-live="polite">
        {statusLine}
      </p>
    </div>
  </div>
  {#if failed}
    <div class="connection-actions">
      <button type="button" on:click={dismiss}>{closeLabel}</button>
    </div>
  {/if}
</dialog>

<style>
  dialog {
    width: min(25rem, calc(100vw - 2rem));
    max-width: none;
    margin: auto;
    padding: 0.95rem 1rem 0.9rem;
    border: 1px solid var(--border);
    border-radius: 0.55rem;
    background: var(--bg-elevated);
    color: var(--text);
    box-shadow: 0 18px 55px rgba(0, 0, 0, 0.48);
    outline: none;
  }

  dialog::backdrop {
    background: rgba(5, 7, 10, 0.72);
    backdrop-filter: blur(2px);
  }

  .connection-layout {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 0.95rem;
  }

  .connection-copy {
    min-width: 0;
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    color: var(--text-strong);
    font-size: 1.28rem;
    font-weight: 800;
    line-height: 1.05;
  }

  .connection-notice {
    margin-top: 0.32rem;
    overflow: hidden;
    color: var(--text-strong);
    font-size: 0.82rem;
    font-weight: 650;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .connection-status {
    min-height: 1.35em;
    margin-top: 0.18rem;
    color: var(--muted);
    font-size: 0.72rem;
    line-height: 1.35;
  }

  dialog.failed .connection-status {
    color: var(--muted-strong);
  }

  .connection-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.7rem;
    padding-top: 0.55rem;
    border-top: 1px solid var(--border-faint);
  }

  button {
    min-width: 4.5rem;
    min-height: 1.75rem;
    padding: 0.25rem 0.7rem;
    border: 1px solid var(--menu-bar-border);
    border-radius: 0.35rem;
    background: var(--bg-input);
    color: var(--text-strong);
    font: inherit;
  }

  button:hover {
    background: var(--hover-surface);
  }

  @media (max-width: 420px) {
    dialog {
      width: calc(100vw - 1.25rem);
      padding: 0.85rem;
    }

    .connection-layout {
      gap: 0.75rem;
    }

    h2 {
      font-size: 1.12rem;
    }
  }
</style>
