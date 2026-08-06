<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import WindowMenuBar from '$lib/components/WindowMenuBar.svelte';
  import { windowManager } from '$lib/services/window-manager';
  import type { MenuActionItem, WindowMenuGroup } from '$lib/types';

  export let entryCount = 0;

  const dispatch = createEventDispatcher<{
    exportLogs: void;
    close: void;
  }>();

  $: appItems = [
    {
      id: 'openOptions',
      label: $t('main.menu.options', { default: 'Options...' }),
      icon: 'settings',
      shortcut: 'Ctrl+P'
    },
    { id: 'openAbout', label: $t('main.menu.about', { default: 'About' }), icon: 'info' },
    {
      id: 'close',
      label: $t('logs.menu.close', { default: 'Close Logs' }),
      icon: 'close',
      shortcut: 'Ctrl+W',
      separatorBefore: true
    }
  ] satisfies MenuActionItem[];

  $: fileItems = [
    {
      id: 'exportLogs',
      label: $t('logs.exportLogs', { default: 'Export logs...' }),
      icon: 'download',
      disabled: entryCount === 0
    }
  ] satisfies MenuActionItem[];

  $: menuGroups = [
    {
      id: 'app',
      label: $t('main.menu.applicationMenu', { default: 'Application menu' }),
      items: appItems,
      application: true
    },
    {
      id: 'file',
      label: $t('main.menu.file', { default: 'File' }),
      icon: 'folder',
      items: fileItems
    }
  ] satisfies WindowMenuGroup[];

  function requestOptions(view?: 'about'): void {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'izci:open-options', view }, window.location.origin);
      return;
    }
    windowManager.openOptions(view);
  }

  function run(action: string): void {
    if (action === 'openOptions') return requestOptions();
    if (action === 'openAbout') return requestOptions('about');
    if (action === 'close') dispatch('close');
    else if (action === 'exportLogs') dispatch('exportLogs');
  }
</script>

<WindowMenuBar
  groups={menuGroups}
  title={$t('logs.heading', { default: 'Logs' })}
  subtitle={$t('logs.entryCount', { default: '{count} entries', values: { count: entryCount } })}
  ariaLabel={$t('main.menu.applicationMenu', { default: 'Application menu' })}
  on:action={(event) => run(event.detail as string)}
/>
