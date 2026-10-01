<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import WindowMenuBar from '$lib/components/WindowMenuBar.svelte';
  import { applyManualLoadoutSettings } from '$lib/services/loadouts';
  import { RAF_EFFECT_DEFINITIONS } from '$lib/services/raf-effect-registry';
  import { SPEED_EFFECT } from './clip-effects';
  import { requestOptionsFromTool, windowManager } from '$lib/services/window-manager';
  import { loadouts } from '$lib/stores/loadouts';
  import type { MenuActionItem, RafEffectType, WindowMenuGroup } from '$lib/types';
  import { getLoadoutColorValue, getLoadoutIcon } from '$lib/utils/loadout-presentation';

  type ActionId = 'open' | 'saveClip' | 'close' | 'undo' | 'redo' | 'selectAll'
    | 'cut' | 'copy' | 'paste' | 'delete' | 'trim' | 'toggleTwoChannelView'
    | 'play' | 'playFromCursor' | 'openOptions' | 'openLoadouts' | 'openAbout' | `applyLoadout:${string}` | `effect:${RafEffectType | 'speed'}`;

  export let fileName = '';
  export let canSaveClip = false;
  export let canUndo = false;
  export let canRedo = false;
  export let canCut = false;
  export let canPaste = false;
  export let twoChannelView = false;
  export let previewPlaying = false;

  const dispatch = createEventDispatcher<{
    play: void;
    playFromCursor: void;
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

  $: loadoutItems = [
    {
      id: 'openLoadouts',
      label: $t('main.menu.openLoadouts', { default: 'Open loadouts' }),
      icon: 'bookmark_manager'
    },
    ...$loadouts.loadouts.map((loadout, index) => ({
      id: `applyLoadout:${loadout.id}`,
      label: loadout.name,
      icon: getLoadoutIcon(loadout),
      iconColor: getLoadoutColorValue(loadout.color),
      separatorBefore: index === 0
    }))
  ] satisfies MenuActionItem[];
  $: appItems = [
    { id: 'openOptions', label: $t('main.menu.options', { default: 'Options...' }), icon: 'settings', shortcut: 'Ctrl+P' },
    { id: 'loadouts', label: $t('main.menu.loadouts', { default: 'Loadouts' }), icon: 'bookmarks', children: loadoutItems },
    { id: 'openAbout', label: $t('main.menu.about', { default: 'About' }), icon: 'info' },
    { id: 'close', label: $t('editor.menu.close', { default: 'Close Editor' }), icon: 'close', shortcut: 'Ctrl+W', separatorBefore: true }
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
    { id: 'selectAll', label: $t('editor.menu.selectAll', { default: 'Select all' }), icon: 'select_all', shortcut: 'Ctrl+A', disabled: !canSaveClip },
    { id: 'play', label: previewPlaying ? $t('audioCompare.stop', { default: 'Stop' }) : $t('editor.edit.play', { default: 'Play' }), icon: previewPlaying ? 'stop' : 'play_arrow', shortcut: 'Space', disabled: !canSaveClip, separatorBefore: true },
    { id: 'playFromCursor', label: $t('editor.edit.playFromCursor', { default: 'Play from cursor' }), icon: 'play_arrow', shortcut: 'Shift+Space', disabled: !canSaveClip }
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
    if (action === 'openOptions') return requestOptionsFromTool();
    if (action === 'openLoadouts') return requestOptionsFromTool('loadouts');
    if (action === 'openAbout') return requestOptionsFromTool('about');
    if (action.startsWith('applyLoadout:')) {
      const loadout = loadouts.getSnapshot().loadouts.find((candidate) => candidate.id === action.slice(13));
      if (loadout) applyManualLoadoutSettings(loadout.settings);
      return;
    }
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
      || action === 'paste' || action === 'delete' || action === 'trim' || action === 'play' || action === 'playFromCursor') {
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
