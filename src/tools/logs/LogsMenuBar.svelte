<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import WindowMenuBar from '$lib/components/WindowMenuBar.svelte';
  import type { LogLevel } from '$lib/logging/api';
  import type { MenuActionItem, WindowMenuGroup } from '$lib/contracts/window-menu';

  export let entryCount = 0;
  export let visibleEntryCount = 0;
  export let autoScroll = true;
  export let captureDebug = false;
  export let mirrorToConsole = false;
  export let enabledLevels: Record<LogLevel, boolean> = {
    error: true, warning: true, info: true, debug: false
  };

  const dispatch = createEventDispatcher<{
    exportLogs: void; copy: void; clear: void; toggleAutoScroll: void;
    toggleLevel: LogLevel; toggleDebugCapture: void; toggleConsoleMirror: void; close: void;
  }>();

  $: fileItems = [
    { id: 'exportLogs', label: $t('logs.exportLogs', { default: 'Export logs...' }), icon: 'download', disabled: entryCount === 0 },
    { id: 'copy', label: $t('logs.copy', { default: 'Copy visible entries' }), icon: 'content_copy', disabled: visibleEntryCount === 0, separatorBefore: true },
    { id: 'clear', label: $t('logs.clear', { default: 'Clear all live logs' }), icon: 'delete_sweep', disabled: entryCount === 0 }
  ] satisfies MenuActionItem[];
  $: viewItems = [
    { id: 'autoScroll', label: $t('logs.autoScroll', { default: 'Auto-scroll' }), icon: 'vertical_align_bottom', checked: autoScroll },
    { id: 'levelError', label: $t('logs.levels.error', { default: 'Error' }), icon: 'error', checked: enabledLevels.error, separatorBefore: true },
    { id: 'levelWarning', label: $t('logs.levels.warning', { default: 'Warning' }), icon: 'warning', checked: enabledLevels.warning },
    { id: 'levelInfo', label: $t('logs.levels.info', { default: 'Info' }), icon: 'info', checked: enabledLevels.info },
    { id: 'levelDebug', label: $t('logs.levels.debug', { default: 'Debug' }), icon: 'bug_report', checked: enabledLevels.debug }
  ] satisfies MenuActionItem[];
  $: loggingItems = [
    { id: 'captureDebug', label: $t('logs.captureDebug', { default: 'Capture debug entries' }), icon: 'bug_report', checked: captureDebug },
    { id: 'mirrorConsole', label: $t('logs.mirrorConsole', { default: 'Mirror entries to console' }), icon: 'terminal', checked: mirrorToConsole }
  ] satisfies MenuActionItem[];
  $: groups = [
    { id: 'app', label: $t('main.menu.applicationMenu', { default: 'Application menu' }), application: true, items: [
      { id: 'close', label: $t('logs.menu.close', { default: 'Close Logs' }), icon: 'close', shortcut: 'Ctrl+W' }
    ] },
    { id: 'file', label: $t('main.menu.file', { default: 'File' }), items: fileItems },
    { id: 'view', label: $t('main.menu.view', { default: 'View' }), items: viewItems },
    { id: 'logging', label: $t('logs.menu.logging', { default: 'Logging' }), items: loggingItems }
  ] satisfies WindowMenuGroup[];

  function run(action: string): void {
    const levels: Partial<Record<string, LogLevel>> = {
      levelError: 'error', levelWarning: 'warning', levelInfo: 'info', levelDebug: 'debug'
    };
    if (levels[action]) dispatch('toggleLevel', levels[action]!);
    else if (action === 'close') dispatch('close');
    else if (action === 'exportLogs') dispatch('exportLogs');
    else if (action === 'copy') dispatch('copy');
    else if (action === 'clear') dispatch('clear');
    else if (action === 'autoScroll') dispatch('toggleAutoScroll');
    else if (action === 'captureDebug') dispatch('toggleDebugCapture');
    else if (action === 'mirrorConsole') dispatch('toggleConsoleMirror');
  }
</script>

<WindowMenuBar
  {groups}
  title={$t('logs.heading', { default: 'Logs' })}
  subtitle={$t('logs.entryCount', { default: '{count} entries', values: { count: entryCount } })}
  ariaLabel={$t('main.menu.applicationMenu', { default: 'Application menu' })}
  on:action={(event) => run(event.detail)}
/>
