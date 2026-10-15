<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import ThemedSelect from '$lib/components/options/ThemedSelect.svelte';
  import { desktopSettings, type DesktopShowIn, type DesktopTrayIcon } from './settings';

  export let launchOnBootSupported = true;
  export let trackInfoBubbleSupported = true;
  export let showInHint = '';
</script>

<SettingsField title={$t('desktop.appearance.showIn.title')} hint={showInHint || $t('desktop.appearance.showIn.hint')} useLabel={false}>
  <ThemedSelect value={$desktopSettings.showIn} label={$t('desktop.appearance.showIn.title')}
    options={[
      { value: 'taskbar', label: $t('desktop.appearance.showIn.taskbar') },
      { value: 'tray', label: $t('desktop.appearance.showIn.tray') },
      { value: 'both', label: $t('desktop.appearance.showIn.both') }
    ]}
    on:change={(event) => desktopSettings.update({ showIn: event.detail as DesktopShowIn })} />
</SettingsField>

{#if launchOnBootSupported}
<SettingsField title={$t('desktop.appearance.launchOnBoot.title')} hint={$t('desktop.appearance.launchOnBoot.hint')} checkbox>
  <input type="checkbox" checked={$desktopSettings.launchOnBoot}
    on:change={(event) => desktopSettings.update({ launchOnBoot: event.currentTarget.checked })} />
</SettingsField>
{/if}

<SettingsField title={$t('desktop.appearance.closeToTray.title')} hint={$t('desktop.appearance.closeToTray.hint')}
  checkbox advanced fieldClass={$desktopSettings.showIn === 'taskbar' ? 'close-to-tray-disabled' : ''}>
  <input type="checkbox" checked={$desktopSettings.closeToTray} disabled={$desktopSettings.showIn === 'taskbar'}
    on:change={(event) => desktopSettings.update({ closeToTray: event.currentTarget.checked })} />
</SettingsField>

<SettingsField title={$t('desktop.appearance.trayIcon.title')} hint={$t('desktop.appearance.trayIcon.hint')} useLabel={false}>
  <ThemedSelect value={$desktopSettings.trayIcon} label={$t('desktop.appearance.trayIcon.title')}
    disabled={$desktopSettings.showIn === 'taskbar'}
    options={[
      { value: 'light', label: $t('desktop.appearance.trayIcon.light') },
      { value: 'dark', label: $t('desktop.appearance.trayIcon.dark') }
    ]}
    on:change={(event) => desktopSettings.update({ trayIcon: event.detail as DesktopTrayIcon })} />
</SettingsField>

{#if trackInfoBubbleSupported}
<SettingsField title={$t('desktop.appearance.trackInfoBubble.title', { default: 'Track info bubble' })} hint={$t('desktop.appearance.trackInfoBubble.hint', { default: 'Show the title and artist beside the tray icon for five seconds whenever playback starts, restarts or resumes. Requires a tray icon.' })} checkbox>
  <input type="checkbox" checked={$desktopSettings.trackInfoBubble}
    on:change={(event) => desktopSettings.update({ trackInfoBubble: event.currentTarget.checked })} />
</SettingsField>
{/if}

<style>
  :global(.close-to-tray-disabled) { opacity: 0.5; }
</style>
