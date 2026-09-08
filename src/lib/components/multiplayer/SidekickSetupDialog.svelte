<script lang="ts">
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import MultiplayerMark from './MultiplayerMark.svelte';
  import SidekickSetupPanel from './SidekickSetupPanel.svelte';
  import { sidekickSetup } from '$lib/services/multiplayer-sidekick-setup';
  import { multiplayerSettings } from '$lib/stores/multiplayer-settings';

  const dispatch = createEventDispatcher<{ dismiss: void }>();
  let dialog: HTMLDialogElement;

  $: hasPending = $sidekickSetup.pendingInvitation !== null;

  function dismiss(): void {
    sidekickSetup.closeSetup();
    dispatch('dismiss');
  }

  function handleCancel(event: Event): void {
    event.preventDefault();
    dismiss();
  }

  onMount(() => {
    // First-use setup preserves any pending invitation and starts from the
    // configured endpoint without contacting it.
    if (!sidekickSetup.getSnapshot().serverInput) {
      const configured = multiplayerSettings.getSnapshot().multiplayerSidekickEndpoint;
      if (configured) sidekickSetup.setServerInput(configured);
    }
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
  aria-labelledby="sidekick-setup-title"
  tabindex="-1"
  on:cancel={handleCancel}
>
  <div class="setup-head">
    <MultiplayerMark size="0.96rem" label={$t('main.multiplayer.markLabel', { default: 'izci multiplayer' })} />
    <h2 id="sidekick-setup-title">
      {#if hasPending}
        {$t('main.multiplayer.sidekick.inviteTitle', { default: 'Sidekick invitation' })}
      {:else}
        {$t('main.multiplayer.sidekick.setupTitle', { default: 'Sidekick setup' })}
      {/if}
    </h2>
  </div>
  <div class="setup-body">
    <SidekickSetupPanel mode="full" />
  </div>
  <div class="setup-actions">
    <button type="button" on:click={dismiss}>
      {$t('main.multiplayer.sidekick.dismiss', { default: 'Dismiss' })}
    </button>
  </div>
</dialog>

<style>
  dialog {
    width: min(30rem, calc(100vw - 2rem));
    max-width: none;
    max-height: min(42rem, calc(100vh - 3rem));
    overflow-y: auto;
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

  .setup-head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 0.95rem;
  }

  h2 {
    margin: 0;
    color: var(--text-strong);
    font-size: 1.1rem;
    font-weight: 800;
  }

  .setup-body {
    margin-top: 0.6rem;
  }

  .setup-actions {
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
</style>
