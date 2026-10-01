<script lang="ts">
  import { t } from 'svelte-i18n';
  import { serverSetup } from '$lib/services/multiplayer-server-setup';
  import ThemedSelect from '$lib/components/options/ThemedSelect.svelte';
  $: builtin = $serverSetup.builtin;
  $: options = builtin ? [...new Set([builtin.publicEndpoint, ...builtin.lanEndpoints])].map((value) => ({ value, label: value })) : [];
</script>

{#if builtin && $serverSetup.hosted}
  <div class="builtin-status">
    <p class:unavailable={builtin.mapping === 'unavailable'} role="status">
      {#if builtin.mapping === 'mapped'}
        {$t('options.multiplayer.server.mapping.mapped')}
      {:else if builtin.mapping === 'unavailable'}
        {$t('options.multiplayer.server.mapping.unavailable')}
      {:else}
        {$t('options.multiplayer.server.mapping.off')}
      {/if}
    </p>
    <label>
      <span>{$t('options.multiplayer.server.inviteAddress')}</span>
      <ThemedSelect label={$t('options.multiplayer.server.inviteAddress')}
        value={$serverSetup.hosted.inviteEndpoint ?? builtin.publicEndpoint}
        {options} disabled={$serverSetup.busy !== null}
        on:change={(event) => serverSetup.useBuiltinInviteEndpoint(event.detail)} />
    </label>
    <p>{$t('options.multiplayer.server.inviteAddressHint')}</p>
  </div>
{/if}

<style>
  .builtin-status { display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.4rem; font-size: 0.72rem; }
  p { margin: 0; color: var(--muted); }
  p.unavailable { color: var(--text-strong); }
  label { display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; }
</style>
