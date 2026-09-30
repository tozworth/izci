<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import { desktopSettings, type DesktopShowIn } from './settings';
</script>

<SettingsField title={$t('desktop.appearance.showIn.title')} hint={$t('desktop.appearance.showIn.hint')}>
  <select value={$desktopSettings.showIn}
    on:change={(event) => desktopSettings.update({ showIn: event.currentTarget.value as DesktopShowIn })}>
    <option value="taskbar">{$t('desktop.appearance.showIn.taskbar')}</option>
    <option value="tray">{$t('desktop.appearance.showIn.tray')}</option>
    <option value="both">{$t('desktop.appearance.showIn.both')}</option>
  </select>
</SettingsField>
