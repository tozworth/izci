<script lang="ts">
  import { t } from 'svelte-i18n';
  import MultiplayerMark from '$lib/components/multiplayer/MultiplayerMark.svelte';
  import ServerJoinChoices from '$lib/components/multiplayer/ServerJoinChoices.svelte';
  import ServerSetupPanel from '$lib/components/multiplayer/ServerSetupPanel.svelte';
  import { describeServerEndpoint } from '$lib/services/multiplayer-server-invite';
  import { serverSetup } from '$lib/services/multiplayer-server-setup';
  import OdaModal from './OdaModal.svelte';

  export let connectionOpen = false;
  export let connectionTitle = 'Multiplayer';
  export let connectionNotice = '';
  export let connectionStatus = '';
  export let connectionFailed = false;
  export let connectionActionLabel: string | null = null;
  export let toastTitle: string | null = null;
  export let toastMessage: string | null = null;
  export let onDismissConnection: () => void = () => {};
  export let onConnectionAction: () => void = () => {};
  export let onDismissToast: () => void = () => {};

  $: setup = $serverSetup;
  $: pending = setup.pendingInvitation;
  $: serverOpen = setup.dialogOpen;

  function closeServer(): void {
    serverSetup.closeSetup();
  }

  function cancelInvitation(): void {
    serverSetup.dismissPending();
    serverSetup.closeSetup();
  }

  function endpointLabel(endpoint: string): string {
    try {
      return describeServerEndpoint(endpoint).authorityWithPrefix;
    } catch {
      return endpoint;
    }
  }
</script>

{#if serverOpen}
  <OdaModal
    title={pending
      ? $t('main.multiplayer.server.inviteTitle', { default: 'Server invitation' })
      : $t('main.multiplayer.server.setupTitle', { default: 'Server setup' })}
    subtitle={pending?.title
      || (pending
        ? $t('options.multiplayer.server.guestTitle', { default: 'Join with an invitation' })
        : $t('main.multiplayer.label', { default: 'Multiplayer' }))}
    onDismiss={pending ? cancelInvitation : closeServer}
    wide={!pending}
  >
    <MultiplayerMark
      slot="mark"
      size="1.22rem"
      label={$t('main.multiplayer.markLabel', { default: 'izci multiplayer' })}
    />

    {#if pending}
      <div class="invitation-details">
        <div>
          <span class="detail-label">{$t('options.multiplayer.server.destination', { default: 'Server' })}</span>
          <strong class="mono">{endpointLabel(pending.endpoint)}</strong>
        </div>
        {#if pending.title}
          <div>
            <span class="detail-label">{$t('options.multiplayer.server.unverifiedTitle', { default: 'Unverified party title' })}</span>
            <strong>{pending.title}</strong>
          </div>
        {/if}
      </div>
      <p class="hint">{$t('options.multiplayer.server.pendingHint', { default: 'Confirm the destination, then choose how to join. Server details load only after joining.' })}</p>
      <div class="join-choices-block">
        <ServerJoinChoices />
      </div>
      {#if setup.guestError}
        <p class="error" role="alert">{setup.guestError}</p>
      {/if}

    {:else}
      <ServerSetupPanel mode="full" />
    {/if}

    <svelte:fragment slot="actions">
      {#if pending}
        <button type="button" on:click={cancelInvitation}>
          {$t('options.multiplayer.server.cancel', { default: 'Cancel' })}
        </button>
      {:else}
        <button type="button" data-oda-default on:click={closeServer}>
          {$t('main.multiplayer.server.dismiss', { default: 'Dismiss' })}
        </button>
      {/if}
    </svelte:fragment>
  </OdaModal>
{:else if connectionOpen}
  <OdaModal
    title={connectionTitle}
    subtitle={connectionNotice}
    onDismiss={onDismissConnection}
  >
    <MultiplayerMark
      slot="mark"
      size="1.22rem"
      label={$t('main.multiplayer.markLabel', { default: 'izci multiplayer' })}
    />
    <p class:error={connectionFailed} class="connection-status" role="status" aria-live="polite">
      {connectionStatus}
    </p>
    <svelte:fragment slot="actions">
      <button type="button" data-oda-default={!connectionActionLabel} on:click={onDismissConnection}>
        {$t('main.common.close', { default: 'Close' })}
      </button>
      {#if connectionActionLabel}
        <button type="button" class="primary" data-oda-default on:click={onConnectionAction}>
          {connectionActionLabel}
        </button>
      {/if}
    </svelte:fragment>
  </OdaModal>
{:else if toastMessage}
  <OdaModal
    title={toastTitle ?? $t('main.multiplayer.label', { default: 'Multiplayer' })}
    subtitle={toastMessage}
    onDismiss={onDismissToast}
  >
    <MultiplayerMark
      slot="mark"
      size="1.22rem"
      label={$t('main.multiplayer.markLabel', { default: 'izci multiplayer' })}
    />
  </OdaModal>
{/if}

<style>
  .invitation-details {
    display: grid;
    gap: 0.65rem;
  }

  .invitation-details > div {
    display: grid;
    grid-template-columns: minmax(8.5rem, 0.42fr) minmax(0, 1fr);
    gap: 1rem;
    align-items: baseline;
  }

  .detail-label,
  .hint {
    color: var(--oda-muted, var(--muted));
  }

  .detail-label {
    font-size: 0.78rem;
    font-weight: 650;
  }

  strong {
    overflow-wrap: anywhere;
    color: var(--oda-text, var(--text));
  }

  .mono {
    font-family: "IBM Plex Mono", "SFMono-Regular", Consolas, monospace;
    font-size: 0.86rem;
  }

  .hint,
  .connection-status,
  .error {
    margin: 0.9rem 0 0;
  }

  .join-choices-block {
    margin-top: 0.9rem;
  }

  .error,
  .connection-status.error {
    color: var(--oda-danger, var(--danger));
  }

  @media (max-width: 560px) {
    .invitation-details > div {
      grid-template-columns: 1fr;
      gap: 0.15rem;
    }
  }
</style>
