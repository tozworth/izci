<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import { applyManualLoadoutSettings } from '$lib/services/loadouts';
  import { windowControlsOverlayState } from '$lib/services/window-controls-overlay';
  import { windowManager } from '$lib/services/window-manager';
  import { loadouts } from '$lib/stores/loadouts';
  import type { MenuActionItem } from '$lib/types';
  import { getLoadoutColorValue, LOADOUT_TYPE_ICONS } from '$lib/utils/loadout-presentation';

  type MenuId = 'app' | 'file' | 'edit';
  type ActionId = 'open' | 'saveClip' | 'saveTags' | 'close' | 'undo' | 'redo' | 'selectAll'
    | 'openOptions' | 'openLoadouts' | 'openAbout' | `applyLoadout:${string}`;

  export let fileName = '';
  export let canSaveClip = false;
  export let canSaveTags = false;
  export let canUndo = false;
  export let canRedo = false;

  const dispatch = createEventDispatcher<{
    open: void;
    saveClip: void;
    saveTags: void;
    close: void;
    undo: void;
    redo: void;
    selectAll: void;
  }>();

  let activeMenu: MenuId | null = null;
  let menuX = 8;
  let menuY = 36;
  let appTrigger: HTMLButtonElement;
  let fileTrigger: HTMLButtonElement;
  let editTrigger: HTMLButtonElement;

  $: loadoutItems = [
    {
      id: 'openLoadouts',
      label: $t('main.menu.openLoadouts', { default: 'Open loadouts' }),
      icon: 'bookmark_manager'
    },
    ...$loadouts.loadouts.map((loadout, index) => ({
      id: `applyLoadout:${loadout.id}`,
      label: loadout.name,
      icon: LOADOUT_TYPE_ICONS[loadout.target.type],
      iconColor: getLoadoutColorValue(loadout.color),
      separatorBefore: index === 0
    }))
  ] satisfies MenuActionItem[];
  $: appItems = [
    { id: 'openOptions', label: $t('main.menu.options', { default: 'Options...' }), icon: 'settings', shortcut: 'Ctrl+P' },
    { id: 'loadouts', label: $t('main.menu.loadouts', { default: 'Loadouts' }), icon: 'bookmarks', children: loadoutItems },
    { id: 'openAbout', label: $t('main.menu.about', { default: 'About' }), icon: 'info' },
    { id: 'close', label: $t('clipTag.menu.close', { default: 'Close Clip and Tag' }), icon: 'close', shortcut: 'Ctrl+W', separatorBefore: true }
  ] satisfies MenuActionItem[];
  $: fileItems = [
    { id: 'open', label: $t('clipTag.menu.open', { default: 'Open audio...' }), icon: 'file_open', shortcut: 'Ctrl+O' },
    { id: 'saveClip', label: $t('clipTag.menu.saveClip', { default: 'Export clip as WAV...' }), icon: 'save', shortcut: 'Ctrl+S', disabled: !canSaveClip, separatorBefore: true },
    { id: 'saveTags', label: $t('clipTag.menu.saveTags', { default: 'Save tagged copy...' }), icon: 'new_label', disabled: !canSaveTags },
    { id: 'close', label: $t('clipTag.menu.close', { default: 'Close Clip and Tag' }), icon: 'close', shortcut: 'Ctrl+W', separatorBefore: true }
  ] satisfies MenuActionItem[];
  $: editItems = [
    { id: 'undo', label: $t('clipTag.menu.undo', { default: 'Undo' }), icon: 'undo', shortcut: 'Ctrl+Z', disabled: !canUndo },
    { id: 'redo', label: $t('clipTag.menu.redo', { default: 'Redo' }), icon: 'redo', shortcut: 'Ctrl+Y', disabled: !canRedo },
    { id: 'selectAll', label: $t('clipTag.menu.selectAll', { default: 'Select all' }), icon: 'select_all', shortcut: 'Ctrl+A', disabled: !canSaveClip, separatorBefore: true }
  ] satisfies MenuActionItem[];

  $: overlay = $windowControlsOverlayState;
  $: rect = overlay.titlebarAreaRect;
  $: overlayStyle = overlay.visible
    ? `--window-controls-overlay-x: ${rect.x}px; --window-controls-overlay-y: ${rect.y}px; --window-controls-overlay-width: ${rect.width}px; --window-controls-overlay-height: ${rect.height}px;`
    : '';

  function triggerFor(menu: MenuId): HTMLButtonElement {
    return menu === 'app' ? appTrigger : menu === 'file' ? fileTrigger : editTrigger;
  }

  function openMenu(menu: MenuId): void {
    activeMenu = activeMenu === menu ? null : menu;
    if (activeMenu) {
      const bounds = triggerFor(activeMenu).getBoundingClientRect();
      menuX = bounds.left;
      menuY = bounds.bottom + 6;
    }
  }

  function hoverMenu(menu: MenuId): void {
    if (!activeMenu || activeMenu === menu) return;
    activeMenu = menu;
    const bounds = triggerFor(menu).getBoundingClientRect();
    menuX = bounds.left;
    menuY = bounds.bottom + 6;
  }

  function run(action: ActionId): void {
    activeMenu = null;
    if (action === 'openOptions') return requestOptions();
    if (action === 'openLoadouts') return requestOptions('loadouts');
    if (action === 'openAbout') return requestOptions('about');
    if (action.startsWith('applyLoadout:')) {
      const loadout = loadouts.getSnapshot().loadouts.find((candidate) => candidate.id === action.slice(13));
      if (loadout) applyManualLoadoutSettings(loadout.settings);
      return;
    }
    if (action === 'open' || action === 'saveClip' || action === 'saveTags' || action === 'close'
      || action === 'undo' || action === 'redo' || action === 'selectAll') {
      dispatch(action);
    }
  }

  function requestOptions(view?: 'loadouts' | 'about'): void {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'izci:open-options', view }, window.location.origin);
      return;
    }
    windowManager.openOptions(view);
  }

  function handleWindowPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (activeMenu && (!(target instanceof Element) || !target.closest('[data-menu-interactive="true"]'))) activeMenu = null;
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') activeMenu = null;
  }

  window.addEventListener('pointerdown', handleWindowPointerDown);
  window.addEventListener('keydown', handleWindowKeydown);
  onDestroy(() => {
    window.removeEventListener('pointerdown', handleWindowPointerDown);
    window.removeEventListener('keydown', handleWindowKeydown);
  });
</script>

<nav
  class="menu-bar clip-tag-menu-bar"
  class:window-controls-overlay-active={overlay.visible}
  style={overlayStyle}
  aria-label={$t('main.menu.applicationMenu', { default: 'Application menu' })}
>
  <div class="menu-groups">
    <div class="menu-root" role="none" on:pointerenter={() => hoverMenu('app')}>
      <button bind:this={appTrigger} class="menu-trigger app-menu-trigger" class:active={activeMenu === 'app'} data-menu-interactive="true" type="button" aria-label="izci" aria-haspopup="menu" aria-expanded={activeMenu === 'app'} on:click={() => openMenu('app')}>
        <span class="izci-menu-glyph" aria-hidden="true"></span>
      </button>
      {#if activeMenu === 'app'}
        <MenuSurface items={appItems} x={menuX} y={menuY} on:action={(event) => run(event.detail as ActionId)} on:dismiss={() => (activeMenu = null)} />
      {/if}
    </div>
    <div class="menu-root" role="none" on:pointerenter={() => hoverMenu('file')}>
      <button bind:this={fileTrigger} class="menu-trigger" class:active={activeMenu === 'file'} data-menu-interactive="true" type="button" aria-haspopup="menu" aria-expanded={activeMenu === 'file'} on:click={() => openMenu('file')}>{$t('main.menu.file', { default: 'File' })}</button>
      {#if activeMenu === 'file'}
        <MenuSurface items={fileItems} x={menuX} y={menuY} on:action={(event) => run(event.detail as ActionId)} on:dismiss={() => (activeMenu = null)} />
      {/if}
    </div>
    <div class="menu-root" role="none" on:pointerenter={() => hoverMenu('edit')}>
      <button bind:this={editTrigger} class="menu-trigger" class:active={activeMenu === 'edit'} data-menu-interactive="true" type="button" aria-haspopup="menu" aria-expanded={activeMenu === 'edit'} on:click={() => openMenu('edit')}>{$t('clipTag.menu.edit', { default: 'Edit' })}</button>
      {#if activeMenu === 'edit'}
        <MenuSurface items={editItems} x={menuX} y={menuY} on:action={(event) => run(event.detail as ActionId)} on:dismiss={() => (activeMenu = null)} />
      {/if}
    </div>
  </div>
  <div class="clip-tag-window-title" aria-live="polite">
    <strong>{$t('clipTag.title', { default: 'Clip and Tag' })}</strong>
    {#if fileName}<span>{fileName}</span>{/if}
  </div>
</nav>
