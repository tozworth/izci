<script lang="ts">
  import { t } from 'svelte-i18n';
  import { isDesktop } from '$platform';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import ThemedSelect from '$lib/components/options/ThemedSelect.svelte';
  import { multiplayerSettings } from '$lib/stores/multiplayer-settings';
  export let disabled = false;
  export let config = false;
  $: builtin = isDesktop && $multiplayerSettings.multiplayerSignaling === 'builtin';
</script>

{#if isDesktop}
  <SettingsField title={$t('options.multiplayer.server.signaling')} hint={$t('options.multiplayer.server.signalingHint')}>
    <ThemedSelect
      label={$t('options.multiplayer.server.signaling')}
      value={$multiplayerSettings.multiplayerSignaling}
      options={[
        { value: 'builtin', label: $t('options.multiplayer.server.builtin') },
        { value: 'external', label: $t('options.multiplayer.server.external') }
      ]}
      {disabled}
      on:change={(event) => multiplayerSettings.update({ multiplayerSignaling: event.detail === 'builtin' ? 'builtin' : 'external' })}
    />
  </SettingsField>
{/if}
{#if builtin}
  <SettingsField title={$t('options.multiplayer.server.builtin')} hint={$t('options.multiplayer.server.builtinHint')} useLabel={false} />
  <SettingsField title={$t('options.multiplayer.server.port')} hint={$t('options.multiplayer.server.portHint')}>
    <input type="number" min="1" max="65535" value={$multiplayerSettings.multiplayerBuiltinPort} {disabled}
      on:change={(event) => multiplayerSettings.update({ multiplayerBuiltinPort: event.currentTarget.valueAsNumber })} />
  </SettingsField>
  <SettingsField title={$t('options.multiplayer.server.upnp')} hint={$t('options.multiplayer.server.upnpHint')} checkbox>
    <input type="checkbox" checked={$multiplayerSettings.multiplayerBuiltinUpnp} {disabled}
      on:change={(event) => multiplayerSettings.update({ multiplayerBuiltinUpnp: event.currentTarget.checked })} />
  </SettingsField>
  <SettingsField title={$t('options.multiplayer.server.publicUrl')} hint={$t('options.multiplayer.server.publicUrlHint')}>
    <input type="text" placeholder={$t('options.multiplayer.server.automaticAddress')} spellcheck="false" value={$multiplayerSettings.multiplayerBuiltinPublicUrl} {disabled}
      on:change={(event) => multiplayerSettings.update({ multiplayerBuiltinPublicUrl: event.currentTarget.value })} />
  </SettingsField>
  <SettingsField title={$t('options.multiplayer.server.stun')} hint={$t('options.multiplayer.server.stunHint')} advanced={config}>
    <input type="text" spellcheck="false" value={$multiplayerSettings.multiplayerBuiltinIceUrls} {disabled}
      on:change={(event) => multiplayerSettings.update({ multiplayerBuiltinIceUrls: event.currentTarget.value })} />
  </SettingsField>
  <SettingsField title={$t('options.multiplayer.server.clientOrigins')} hint={$t('options.multiplayer.server.clientOriginsHint')} advanced={config}>
    <input type="text" spellcheck="false" value={$multiplayerSettings.multiplayerBuiltinAllowedOrigins} {disabled}
      on:change={(event) => multiplayerSettings.update({ multiplayerBuiltinAllowedOrigins: event.currentTarget.value })} />
  </SettingsField>
{/if}

<style>
  input[type='number'] { width: 5.5rem; }
  input[type='text'] { width: min(20rem, 100%); min-width: 0; }
  input[type='text'], input[type='number'] {
    padding: 0.28rem 0.45rem;
    border: 1px solid var(--border-soft);
    border-radius: 0.3rem;
    background: var(--bg-input);
    color: inherit;
    font: inherit;
  }
</style>
