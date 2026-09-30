<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import { desktopSettings } from './settings';
</script>

<SettingsField title={$t('desktop.appearance.tray.title')} hint={$t('desktop.appearance.tray.hint')} checkbox>
  <input type="checkbox" checked={$desktopSettings.trayIcon}
    on:change={(event) => desktopSettings.update({ trayIcon: event.currentTarget.checked })} />
</SettingsField>
