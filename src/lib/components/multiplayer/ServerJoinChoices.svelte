<script lang="ts">
  import { t } from 'svelte-i18n';
  import { serverSetup } from '$lib/services/multiplayer-server-setup';

  $: setup = $serverSetup;
  $: joining = setup.busy !== null || setup.guestStatus === 'connecting';

  async function joinCoop(): Promise<void> {
    await serverSetup.joinPendingAs('coop').catch(() => undefined);
  }

  async function joinFreeplay(): Promise<void> {
    await serverSetup.joinPendingAs('freeplay').catch(() => undefined);
  }
</script>

<div
  class="join-choices"
  role="group"
  aria-label={$t('options.multiplayer.server.guestTitle', { default: 'Join with an invitation' })}
>
  <button type="button" class="join-choice" disabled={joining} on:click={joinCoop}>
    <span class="material-symbols-outlined join-choice-icon" aria-hidden="true">group</span>
    <span class="join-choice-text">
      <span class="join-choice-title">
        {$t('options.multiplayer.server.joinCoop', { default: 'Join co-op' })}
      </span>
      <span class="join-choice-hint">
        {$t('options.multiplayer.server.joinCoopHint', {
          default: "Listen together and share the host's queue and transport."
        })}
      </span>
    </span>
  </button>
  <button type="button" class="join-choice" disabled={joining} on:click={joinFreeplay}>
    <span class="material-symbols-outlined join-choice-icon" aria-hidden="true">explore</span>
    <span class="join-choice-text">
      <span class="join-choice-title">
        {$t('options.multiplayer.server.joinFreeplay', { default: 'Join freeplay' })}
      </span>
      <span class="join-choice-hint">
        {$t('options.multiplayer.server.joinFreeplayHint', {
          default: 'Browse the host library and play your own picks. Needs freeplay on both ends.'
        })}
      </span>
    </span>
  </button>
</div>

<style>
  .join-choices {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .join-choice {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    min-height: 3.25rem;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--menu-bar-border);
    border-radius: 0.4rem;
    background: var(--bg-input);
    color: var(--text-strong);
    font: inherit;
    text-align: start;
  }

  .join-choice:hover:not(:disabled) {
    background: var(--hover-surface);
  }

  .join-choice:disabled {
    opacity: 0.55;
  }

  .join-choice-icon {
    flex: 0 0 auto;
    font-size: 1.35rem;
    line-height: 1.2;
    color: var(--muted-strong);
  }

  .join-choice-text {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .join-choice-title {
    font-weight: 700;
    font-size: 0.76rem;
  }

  .join-choice-hint {
    color: var(--muted);
    font-size: 0.68rem;
    line-height: 1.45;
  }

  @media (max-width: 30rem) {
    .join-choices {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
