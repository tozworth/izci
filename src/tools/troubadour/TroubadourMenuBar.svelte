<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import WindowMenuBar from '$lib/components/WindowMenuBar.svelte';
  import type { MenuActionItem, WindowMenuGroup } from '$lib/contracts/window-menu';

  type ActionId =
    | 'addFiles' | 'addFolder' | 'addFromIzci' | 'save' | 'saveAll' | 'close'
    | 'undo' | 'redo' | 'selectAll' | 'remove' | 'reload'
    | 'createAlbum' | 'autoGroup' | 'renumber' | 'dissolveAlbum'
    | 'previewRename' | 'applyRename' | 'spectrogram' | 'options';

  export let canSave = false;
  export let canUndo = false;
  export let canRedo = false;
  export let canRemove = false;
  export let canAlbum = false;
  export let canRename = false;
  export let canSpectrogram = false;
  export let busy = false;
  export let summary = '';

  const dispatch = createEventDispatcher<Record<ActionId, void>>();

  $: appItems = [
    { id: 'options', label: $t('troubadour.menu.options', { default: 'Troubadour Options...' }), icon: 'settings', shortcut: 'Ctrl+,' },
    { id: 'close', label: $t('troubadour.menu.close', { default: 'Close Troubadour' }), icon: 'close', shortcut: 'Ctrl+W', separatorBefore: true }
  ] satisfies MenuActionItem[];
  $: fileItems = [
    { id: 'addFiles', label: $t('troubadour.menu.addFiles', { default: 'Add files...' }), icon: 'audio_file', shortcut: 'Ctrl+O', disabled: busy },
    { id: 'addFolder', label: $t('troubadour.menu.addFolder', { default: 'Add folder...' }), icon: 'folder_open', shortcut: 'Ctrl+Shift+O', disabled: busy },
    { id: 'addFromIzci', label: $t('troubadour.menu.addFromIzci', { default: 'Add current izci selection' }), icon: 'playlist_add', disabled: busy },
    { id: 'save', label: $t('troubadour.menu.save', { default: 'Save selected dirty files' }), icon: 'save', shortcut: 'Ctrl+S', separatorBefore: true, disabled: !canSave || busy },
    { id: 'saveAll', label: $t('troubadour.menu.saveAll', { default: 'Save all dirty files' }), icon: 'save_as', shortcut: 'Ctrl+Shift+S', disabled: !canSave || busy },
    { id: 'close', label: $t('troubadour.menu.close', { default: 'Close Troubadour' }), icon: 'close', shortcut: 'Ctrl+W', separatorBefore: true }
  ] satisfies MenuActionItem[];
  $: editItems = [
    { id: 'undo', label: $t('troubadour.menu.undo', { default: 'Undo staged change' }), icon: 'undo', shortcut: 'Ctrl+Z', disabled: !canUndo || busy },
    { id: 'redo', label: $t('troubadour.menu.redo', { default: 'Redo staged change' }), icon: 'redo', shortcut: 'Ctrl+Y', disabled: !canRedo || busy },
    { id: 'selectAll', label: $t('troubadour.menu.selectAll', { default: 'Select all files' }), icon: 'select_all', shortcut: 'Ctrl+A', separatorBefore: true },
    { id: 'remove', label: $t('troubadour.menu.remove', { default: 'Remove from workbench' }), icon: 'remove', shortcut: 'Delete', disabled: !canRemove || busy },
    { id: 'reload', label: $t('troubadour.menu.reload', { default: 'Reload unchanged selected files' }), icon: 'refresh', shortcut: 'F5', disabled: !canRemove || busy }
  ] satisfies MenuActionItem[];
  $: albumItems = [
    { id: 'createAlbum', label: $t('troubadour.menu.createAlbum', { default: 'Create album from selection' }), icon: 'create_new_folder', disabled: !canAlbum || busy },
    { id: 'autoGroup', label: $t('troubadour.menu.autoGroup', { default: 'Auto-group files' }), icon: 'auto_awesome_motion', disabled: busy },
    { id: 'renumber', label: $t('troubadour.menu.renumber', { default: 'Renumber album tracks' }), icon: 'format_list_numbered', separatorBefore: true, disabled: !canAlbum || busy },
    { id: 'dissolveAlbum', label: $t('troubadour.menu.dissolveAlbum', { default: 'Dissolve selected album' }), icon: 'folder_off', disabled: !canAlbum || busy }
  ] satisfies MenuActionItem[];
  $: toolsItems = [
    { id: 'previewRename', label: $t('troubadour.menu.previewRename', { default: 'Preview renames' }), icon: 'preview', disabled: busy },
    { id: 'applyRename', label: $t('troubadour.menu.applyRename', { default: 'Apply valid renames' }), icon: 'drive_file_rename_outline', disabled: !canRename || busy },
    { id: 'spectrogram', label: $t('troubadour.menu.spectrogram', { default: 'Open selected file in Spectrogram' }), icon: 'waterfall_chart', disabled: !canSpectrogram || busy, separatorBefore: true },
    { id: 'options', label: $t('troubadour.menu.options', { default: 'Troubadour Options...' }), icon: 'settings', shortcut: 'Ctrl+,', separatorBefore: true }
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
      id: 'edit',
      label: $t('troubadour.menu.edit', { default: 'Edit' }),
      icon: 'edit',
      items: editItems
    },
    {
      id: 'album',
      label: $t('troubadour.menu.album', { default: 'Album' }),
      icon: 'album',
      items: albumItems
    },
    {
      id: 'tools',
      label: $t('main.menu.tools', { default: 'Tools' }),
      icon: 'construction',
      items: toolsItems
    }
  ] satisfies WindowMenuGroup[];

  function run(action: string): void {
    dispatch(action as ActionId);
  }
</script>

<WindowMenuBar
  groups={menuGroups}
  title={$t('troubadour.title', { default: 'Troubadour' })}
  subtitle={summary}
  ariaLabel={$t('main.menu.applicationMenu', { default: 'Application menu' })}
  on:action={(event) => run(event.detail)}
/>
