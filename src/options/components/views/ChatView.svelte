<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import { multiplayerSettings } from '$lib/stores/multiplayer-settings';

  function handleMotdChange(event: Event): void {
    multiplayerSettings.update({
      multiplayerMotd: (event.currentTarget as HTMLInputElement).value
    });
  }
</script>

<article class="view">
  <div class="section">
    <h2>{$t('options.multiplayer.chat.category', { default: 'Chat' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.multiplayer.chat.motd.title', { default: 'Message of the day' })}
        hint={$t('options.multiplayer.chat.motd.hint', { default: 'Shown above the chat to guests in sessions hosted by this izci.' })}
      >
        <input
          class="multiplayer-motd-input"
          type="text"
          maxlength="500"
          value={$multiplayerSettings.multiplayerMotd}
          on:change={handleMotdChange}
        />
      </SettingsField>
    </div>
  </div>
</article>

<style>
  :global(html:not([data-izci-mobile='true'])) input.multiplayer-motd-input {
    width: min(24rem, 50vw);
  }
</style>
