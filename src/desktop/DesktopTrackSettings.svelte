<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import { desktopSettings } from './settings';
  import { openDesktopDefaultApps } from './system-integration';
</script>

<SettingsField title={$t('desktop.tracks.associations.title')} hint={$t('desktop.tracks.associations.hint')} checkbox>
  <input type="checkbox" checked={$desktopSettings.fileAssociations}
    on:change={(event) => desktopSettings.update({ fileAssociations: event.currentTarget.checked })} />
</SettingsField>
<SettingsField title={$t('desktop.tracks.defaults.title')} hint={$t('desktop.tracks.defaults.hint')}>
  <button class="defaults-button" type="button" disabled={!$desktopSettings.fileAssociations}
    on:click={openDesktopDefaultApps}>{$t('desktop.tracks.defaults.button')}</button>
</SettingsField>

<style>
  .defaults-button {
    padding: 0.25rem 0.5rem; border: 1px solid var(--border-soft); border-radius: 0.2rem;
    background: var(--bg-soft); color: var(--text); cursor: default;
  }
  .defaults-button:hover:not(:disabled) { background: var(--hover-surface); }
  .defaults-button:disabled { opacity: 0.45; }
</style>
