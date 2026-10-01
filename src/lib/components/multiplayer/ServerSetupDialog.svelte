<script lang="ts">
  import { createEventDispatcher, onMount, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import MultiplayerMark from './MultiplayerMark.svelte';
  import ServerSetupPanel from './ServerSetupPanel.svelte';
  import { serverSetup } from '$lib/services/multiplayer-server-setup';
  import { multiplayerSettings } from '$lib/stores/multiplayer-settings';

  const dispatch = createEventDispatcher<{ dismiss: void }>();
  let dialog: HTMLDialogElement;

  $: hasPending = $serverSetup.pendingInvitation !== null;

  function dismiss(): void {
    serverSetup.closeSetup();
    dispatch('dismiss');
  }

  function handleCancel(event: Event): void {
    event.preventDefault();
    dismiss();
  }

  onMount(() => {
    // First-use setup preserves any pending invitation and starts from the
    // configured endpoint without contacting it.
    if (!serverSetup.getSnapshot().serverInput) {
      const configured = multiplayerSettings.getSnapshot().multiplayerServerEndpoint;
      if (configured) serverSetup.setServerInput(configured);
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
  aria-labelledby="server-setup-title"
  tabindex="-1"
  on:cancel={handleCancel}
>
  <div class="setup-head">
    <MultiplayerMark size="0.96rem" label={$t('main.multiplayer.markLabel', { default: 'izci multiplayer' })} />
    <h2 id="server-setup-title">
      {#if hasPending}
        {$t('main.multiplayer.server.inviteTitle', { default: 'Server invitation' })}
      {:else if $serverSetup.hosted}
        {$t('main.multiplayer.server.manageParty', { default: 'Manage party and invitation' })}
      {:else}
        {$t('main.multiplayer.server.setupTitle', { default: 'Server setup' })}
      {/if}
    </h2>
  </div>
  <div class="setup-body">
    <ServerSetupPanel mode="full" />
  </div>
  <div class="setup-actions">
    <button type="button" on:click={dismiss}>
      {$t('main.multiplayer.server.dismiss', { default: 'Dismiss' })}
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
