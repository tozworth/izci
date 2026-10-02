<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import { desktopSettings, type DesktopShowIn, type DesktopTrayIcon } from './settings';
</script>

<SettingsField title={$t('desktop.appearance.showIn.title')} hint={$t('desktop.appearance.showIn.hint')}>
  <select value={$desktopSettings.showIn}
    on:change={(event) => desktopSettings.update({ showIn: event.currentTarget.value as DesktopShowIn })}>
    <option value="taskbar">{$t('desktop.appearance.showIn.taskbar')}</option>
    <option value="tray">{$t('desktop.appearance.showIn.tray')}</option>
    <option value="both">{$t('desktop.appearance.showIn.both')}</option>
  </select>
</SettingsField>

<SettingsField title={$t('desktop.appearance.closeToTray.title')} hint={$t('desktop.appearance.closeToTray.hint')}
  checkbox advanced fieldClass={$desktopSettings.showIn === 'taskbar' ? 'close-to-tray-disabled' : ''}>
  <input type="checkbox" checked={$desktopSettings.closeToTray} disabled={$desktopSettings.showIn === 'taskbar'}
    on:change={(event) => desktopSettings.update({ closeToTray: event.currentTarget.checked })} />
</SettingsField>

<SettingsField title={$t('desktop.appearance.trayIcon.title')} hint={$t('desktop.appearance.trayIcon.hint')}>
  <select value={$desktopSettings.trayIcon} disabled={$desktopSettings.showIn === 'taskbar'}
    on:change={(event) => desktopSettings.update({ trayIcon: event.currentTarget.value as DesktopTrayIcon })}>
    <option value="light">{$t('desktop.appearance.trayIcon.light')}</option>
    <option value="dark">{$t('desktop.appearance.trayIcon.dark')}</option>
  </select>
</SettingsField>

<SettingsField title={$t('desktop.appearance.trackInfoBubble.title', { default: 'Track info bubble' })} hint={$t('desktop.appearance.trackInfoBubble.hint', { default: 'Show the title and artist beside the tray icon for five seconds whenever playback starts, restarts or resumes. Requires a tray icon.' })} checkbox>
  <input type="checkbox" checked={$desktopSettings.trackInfoBubble}
    on:change={(event) => desktopSettings.update({ trackInfoBubble: event.currentTarget.checked })} />
</SettingsField>

<style>
  select:disabled { opacity: 0.5; }
  :global(.close-to-tray-disabled) { opacity: 0.5; }
</style>
