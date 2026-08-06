<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import WindowMenuBar from '$lib/components/WindowMenuBar.svelte';
  import { RAF_EFFECT_DEFINITIONS } from '$lib/services/raf-effect-registry';
  import { SPEED_EFFECT } from './clip-effects';
  import type { MenuActionItem, RafEffectType, WindowMenuGroup } from '$lib/types';

  type ActionId = 'open' | 'saveClip' | 'close' | 'undo' | 'redo' | 'selectAll'
    | 'cut' | 'copy' | 'paste' | 'delete' | 'trim' | 'toggleTwoChannelView'
    | `effect:${RafEffectType | 'speed'}`;

  export let fileName = '';
  export let canSaveClip = false;
  export let canUndo = false;
  export let canRedo = false;
  export let canCut = false;
  export let canPaste = false;
  export let twoChannelView = false;

  const dispatch = createEventDispatcher<{
    open: void;
    saveClip: void;
    close: void;
    undo: void;
    redo: void;
    selectAll: void;
    cut: void;
    copy: void;
    paste: void;
    delete: void;
    trim: void;
    effect: RafEffectType | 'speed';
    toggleTwoChannelView: void;
  }>();

  $: appItems = [
    { id: 'close', label: $t('editor.menu.close', { default: 'Close Editor' }), icon: 'close', shortcut: 'Ctrl+W' }
  ] satisfies MenuActionItem[];
  $: fileItems = [
    { id: 'open', label: $t('editor.menu.open', { default: 'Open audio...' }), icon: 'file_open', shortcut: 'Ctrl+O' },
    { id: 'saveClip', label: $t('editor.menu.saveClip', { default: 'Export audio...' }), icon: 'save', shortcut: 'Ctrl+S', disabled: !canSaveClip, separatorBefore: true },
    { id: 'close', label: $t('editor.menu.close', { default: 'Close Editor' }), icon: 'close', shortcut: 'Ctrl+W', separatorBefore: true }
  ] satisfies MenuActionItem[];
  $: editItems = [
    { id: 'undo', label: $t('editor.menu.undo', { default: 'Undo' }), icon: 'undo', shortcut: 'Ctrl+Z', disabled: !canUndo },
    { id: 'redo', label: $t('editor.menu.redo', { default: 'Redo' }), icon: 'redo', shortcut: 'Ctrl+Y', disabled: !canRedo },
    { id: 'cut', label: $t('editor.edit.cut', { default: 'Cut' }), icon: 'content_cut', shortcut: 'Ctrl+X', disabled: !canCut, separatorBefore: true },
    { id: 'copy', label: $t('editor.edit.copy', { default: 'Copy' }), icon: 'content_copy', shortcut: 'Ctrl+C', disabled: !canCut },
    { id: 'paste', label: $t('editor.edit.paste', { default: 'Paste' }), icon: 'content_paste', shortcut: 'Ctrl+V', disabled: !canPaste },
    { id: 'delete', label: $t('editor.edit.delete', { default: 'Delete' }), icon: 'delete', shortcut: 'Del', disabled: !canCut },
    { id: 'trim', label: $t('editor.edit.trim', { default: 'Trim to selection' }), icon: 'crop', disabled: !canCut, separatorBefore: true },
    { id: 'selectAll', label: $t('editor.menu.selectAll', { default: 'Select all' }), icon: 'select_all', shortcut: 'Ctrl+A', disabled: !canSaveClip }
  ] satisfies MenuActionItem[];
  $: effectItems = [...RAF_EFFECT_DEFINITIONS, SPEED_EFFECT].map((definition) => ({
    id: `effect:${definition.type}`,
    label: definition.name,
    icon: definition.icon,
    disabled: !canCut
  })) satisfies MenuActionItem[];
  $: viewItems = [
    {
      id: 'toggleTwoChannelView',
      label: $t('editor.view.twoChannelWaveform', { default: 'Two-channel waveform' }),
      icon: twoChannelView ? 'check' : 'graphic_eq',
      checked: twoChannelView
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
      id: 'edit',
      label: $t('editor.menu.edit', { default: 'Edit' }),
      icon: 'edit',
      items: editItems
    },
    {
      id: 'effects',
      label: $t('editor.effects.menu', { default: 'Effects' }),
      icon: 'tune',
      items: effectItems
    },
    {
      id: 'view',
      label: $t('main.menu.view', { default: 'View' }),
      icon: 'visibility',
      items: viewItems
    }
  ] satisfies WindowMenuGroup[];

  function run(action: ActionId): void {
    if (action.startsWith('effect:')) {
      dispatch('effect', action.slice(7) as RafEffectType | 'speed');
      return;
    }
    if (action === 'toggleTwoChannelView') {
      dispatch('toggleTwoChannelView');
      return;
    }
    if (action === 'open' || action === 'saveClip' || action === 'close'
      || action === 'undo' || action === 'redo' || action === 'selectAll' || action === 'cut' || action === 'copy'
      || action === 'paste' || action === 'delete' || action === 'trim') {
      dispatch(action);
    }
  }

</script>

<WindowMenuBar
  groups={menuGroups}
  title={$t('editor.title', { default: 'Editor' })}
  subtitle={fileName}
  ariaLabel={$t('main.menu.applicationMenu', { default: 'Application menu' })}
  on:action={(event) => run(event.detail as ActionId)}
/>
