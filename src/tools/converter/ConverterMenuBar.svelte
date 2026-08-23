<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';
  import WindowMenuBar from '$lib/components/WindowMenuBar.svelte';
  import { requestOptionsFromTool, windowManager } from '$lib/services/window-manager';
  import type { MenuActionItem, WindowMenuGroup } from '$lib/types';

  type ActionId = 'addFiles' | 'addFolder' | 'chooseOutput' | 'close' | 'selectAll' | 'selectNone'
    | 'removeSelected' | 'clearFinished' | 'start' | 'stop' | 'openOptions' | 'openAbout';

  export let fileSummary = '';
  export let busy = false;
  export let canStart = false;
  export let canRemove = false;
  export let canSelect = false;
  export let canClearFinished = false;

  const dispatch = createEventDispatcher<{
    addFiles: void;
    addFolder: void;
    chooseOutput: void;
    close: void;
    selectAll: void;
    selectNone: void;
    removeSelected: void;
    clearFinished: void;
    start: void;
    stop: void;
  }>();

  $: appItems = [
    { id: 'openOptions', label: $t('main.menu.options', { default: 'Options...' }), icon: 'settings', shortcut: 'Ctrl+P' },
    { id: 'openAbout', label: $t('main.menu.about', { default: 'About' }), icon: 'info' },
    { id: 'close', label: $t('converter.menu.close', { default: 'Close Converter' }), icon: 'close', shortcut: 'Ctrl+W', separatorBefore: true }
  ] satisfies MenuActionItem[];
  $: fileItems = [
    { id: 'addFiles', label: $t('converter.addFiles', { default: 'Add files...' }), icon: 'note_add', shortcut: 'Ctrl+O', disabled: busy },
    { id: 'addFolder', label: $t('converter.addFolder', { default: 'Add folder...' }), icon: 'create_new_folder', disabled: busy },
    { id: 'chooseOutput', label: $t('converter.chooseOutput', { default: 'Choose output folder...' }), icon: 'drive_file_move', disabled: busy, separatorBefore: true },
    { id: 'close', label: $t('converter.menu.close', { default: 'Close Converter' }), icon: 'close', shortcut: 'Ctrl+W', separatorBefore: true }
  ] satisfies MenuActionItem[];
  $: selectionItems = [
    { id: 'selectAll', label: $t('converter.selectAll', { default: 'Select all' }), icon: 'select_all', shortcut: 'Ctrl+A', disabled: !canSelect },
    { id: 'selectNone', label: $t('converter.menu.selectNone', { default: 'Select none' }), icon: 'deselect', disabled: !canSelect },
    { id: 'removeSelected', label: $t('converter.removeSelected', { default: 'Remove selected' }), icon: 'remove', disabled: !canRemove, separatorBefore: true },
    { id: 'clearFinished', label: $t('converter.clearFinished', { default: 'Clear finished' }), icon: 'filter_alt_off', disabled: !canClearFinished }
  ] satisfies MenuActionItem[];
  $: conversionItems = [
    { id: 'start', label: $t('converter.start', { default: 'Convert selected' }), icon: 'sync_alt', shortcut: 'Ctrl+S', disabled: !canStart },
    { id: 'stop', label: $t('converter.stop', { default: 'Stop' }), icon: 'stop_circle', disabled: !busy, separatorBefore: true }
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
      id: 'selection',
      label: $t('converter.menu.selection', { default: 'Selection' }),
      icon: 'select_all',
      items: selectionItems
    },
    {
      id: 'conversion',
      label: $t('converter.menu.conversion', { default: 'Conversion' }),
      icon: 'sync_alt',
      items: conversionItems
    }
  ] satisfies WindowMenuGroup[];

  function run(action: ActionId): void {
    if (action === 'openOptions') return requestOptionsFromTool();
    if (action === 'openAbout') return requestOptionsFromTool('about');
    dispatch(action);
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (!event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    const target = event.target;
    const editing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
    if (key === 'o' && !busy) run('addFiles');
    else if (key === 's' && canStart) run('start');
    else if (key === 'w') run('close');
    else if (key === 'a' && canSelect && !editing) run('selectAll');
    else return;
    event.preventDefault();
  }

  window.addEventListener('keydown', handleWindowKeydown);
  onDestroy(() => {
    window.removeEventListener('keydown', handleWindowKeydown);
  });
</script>

<WindowMenuBar
  groups={menuGroups}
  title={$t('converter.title', { default: 'Converter' })}
  subtitle={fileSummary}
  ariaLabel={$t('main.menu.applicationMenu', { default: 'Application menu' })}
  on:action={(event) => run(event.detail as ActionId)}
/>
