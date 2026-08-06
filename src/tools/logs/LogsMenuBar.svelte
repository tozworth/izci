<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import WindowMenuBar from '$lib/components/WindowMenuBar.svelte';
  import { windowManager } from '$lib/services/window-manager';
  import type { LogLevel } from '$lib/services/logging';
  import type { MenuActionItem, WindowMenuGroup } from '$lib/types';

  export let entryCount = 0;
  export let visibleEntryCount = 0;
  export let autoScroll = true;
  export let enabledLevels: Record<LogLevel, boolean> = {
    error: true,
    warning: true,
    info: true,
    debug: false
  };

  const dispatch = createEventDispatcher<{
    exportLogs: void;
    copy: void;
    clear: void;
    toggleAutoScroll: void;
    toggleLevel: LogLevel;
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
    },
    {
      id: 'copy',
      label: $t('logs.copy', { default: 'Copy' }),
      icon: 'content_copy',
      disabled: visibleEntryCount === 0,
      separatorBefore: true
    },
    {
      id: 'clear',
      label: $t('logs.clear', { default: 'Clear' }),
      icon: 'delete_sweep',
      disabled: entryCount === 0
    }
  ] satisfies MenuActionItem[];

  $: viewItems = [
    {
      id: 'toggleAutoScroll',
      label: $t('logs.autoScroll', { default: 'Auto-scroll' }),
      icon: 'vertical_align_bottom',
      checked: autoScroll
    },
    {
      id: 'toggleError',
      label: $t('logs.levels.error', { default: 'Error' }),
      icon: 'error',
      checked: enabledLevels.error,
      separatorBefore: true
    },
    {
      id: 'toggleWarning',
      label: $t('logs.levels.warning', { default: 'Warning' }),
      icon: 'warning',
      checked: enabledLevels.warning
    },
    {
      id: 'toggleInfo',
      label: $t('logs.levels.info', { default: 'Info' }),
      icon: 'info',
      checked: enabledLevels.info
    },
    {
      id: 'toggleDebug',
      label: $t('logs.levels.debug', { default: 'Debug' }),
      icon: 'bug_report',
      checked: enabledLevels.debug
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
    },
    {
      id: 'view',
      label: $t('main.menu.view', { default: 'View' }),
      icon: 'visibility',
      items: viewItems
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
    else if (action === 'copy') dispatch('copy');
    else if (action === 'clear') dispatch('clear');
    else if (action === 'toggleAutoScroll') dispatch('toggleAutoScroll');
    else if (action === 'toggleError') dispatch('toggleLevel', 'error');
    else if (action === 'toggleWarning') dispatch('toggleLevel', 'warning');
    else if (action === 'toggleInfo') dispatch('toggleLevel', 'info');
    else if (action === 'toggleDebug') dispatch('toggleLevel', 'debug');
  }
</script>

<WindowMenuBar
  groups={menuGroups}
  title={$t('logs.heading', { default: 'Logs' })}
  subtitle={$t('logs.entryCount', { default: '{count} entries', values: { count: entryCount } })}
  ariaLabel={$t('main.menu.applicationMenu', { default: 'Application menu' })}
  on:action={(event) => run(event.detail as string)}
/>
