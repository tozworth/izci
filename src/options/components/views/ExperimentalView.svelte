<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import { experimentalSettings } from '$lib/stores/experimental-settings';

  function handleMultiplayerToggle(event: Event) {
    experimentalSettings.update({
      multiplayer: (event.currentTarget as HTMLInputElement).checked
    });
  }
</script>

<article class="view">
  <div class="section">
    <h2>{$t('options.experimental.heading', { default: 'Experiments' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.experimental.multiplayer.title', { default: 'izci Multiplayer' })}
        hint={$t('options.experimental.multiplayer.hint', { default: 'Lets this izci host or remotely control another izci on the same local network. Sessions exchange playlist, library and transport state, never media.' })}
        checkbox
      >
        <input
          type="checkbox"
          checked={$experimentalSettings.multiplayer}
          on:change={handleMultiplayerToggle}
        />
      </SettingsField>
    </div>
  </div>
</article>
