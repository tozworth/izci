<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import { windowControlsOverlayState } from '$lib/services/window-controls-overlay';
  import type { MenuActionItem } from '$lib/types';

  type MenuId = 'app' | 'file' | 'edit' | 'album' | 'tools' | 'help';
  type ActionId =
    | 'addFiles' | 'addFolder' | 'addFromIzci' | 'save' | 'saveAll' | 'close'
    | 'undo' | 'redo' | 'selectAll' | 'remove' | 'reload'
    | 'createAlbum' | 'autoGroup' | 'renumber' | 'dissolveAlbum'
    | 'previewRename' | 'applyRename' | 'options' | 'about';

  export let canSave = false;
  export let canUndo = false;
  export let canRedo = false;
  export let canRemove = false;
  export let canAlbum = false;
  export let canRename = false;
  export let busy = false;
  export let summary = '';

  const dispatch = createEventDispatcher<Record<ActionId, void>>();
  let activeMenu: MenuId | null = null;
  let menuX = 8;
  let menuY = 34;

  $: appItems = [
    { id: 'options', label: $t('troubadour.menu.options', { default: 'Troubadour Options...' }), icon: 'settings', shortcut: 'Ctrl+,' },
    { id: 'about', label: $t('troubadour.menu.about', { default: 'About Troubadour' }), icon: 'info' },
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
    { id: 'options', label: $t('troubadour.menu.options', { default: 'Troubadour Options...' }), icon: 'settings', shortcut: 'Ctrl+,', separatorBefore: true }
  ] satisfies MenuActionItem[];
  $: helpItems = [
    { id: 'about', label: $t('troubadour.menu.about', { default: 'About Troubadour' }), icon: 'info' }
  ] satisfies MenuActionItem[];

  $: overlay = $windowControlsOverlayState;
  $: rect = overlay.titlebarAreaRect;
  $: overlayStyle = overlay.visible
    ? `--window-controls-overlay-x: ${rect.x}px; --window-controls-overlay-y: ${rect.y}px; --window-controls-overlay-width: ${rect.width}px; --window-controls-overlay-height: ${rect.height}px;`
    : '';

  function triggerFor(menu: MenuId): HTMLButtonElement {
    return document.querySelector(`[data-troubadour-menu="${menu}"]`)!;
  }

  function itemsFor(menu: MenuId): MenuActionItem[] {
    if (menu === 'app') return appItems;
    if (menu === 'file') return fileItems;
    if (menu === 'edit') return editItems;
    if (menu === 'album') return albumItems;
    return menu === 'tools' ? toolsItems : helpItems;
  }

  function labelFor(menu: MenuId): string {
    if (menu === 'app') return 'izci';
    if (menu === 'file') return $t('main.menu.file', { default: 'File' });
    if (menu === 'edit') return $t('troubadour.menu.edit', { default: 'Edit' });
    if (menu === 'album') return $t('troubadour.menu.album', { default: 'Album' });
    if (menu === 'tools') return $t('main.menu.tools', { default: 'Tools' });
    return $t('main.menu.help', { default: 'Help' });
  }

  function openMenu(menu: MenuId): void {
    activeMenu = activeMenu === menu ? null : menu;
    if (!activeMenu) return;
    const bounds = triggerFor(activeMenu).getBoundingClientRect();
    menuX = bounds.left;
    menuY = bounds.bottom + 5;
  }

  function hoverMenu(menu: MenuId): void {
    if (!activeMenu || activeMenu === menu) return;
    activeMenu = menu;
    const bounds = triggerFor(menu).getBoundingClientRect();
    menuX = bounds.left;
    menuY = bounds.bottom + 5;
  }

  function run(action: string): void {
    activeMenu = null;
    dispatch(action as ActionId);
  }

  const closeOutside = (event: PointerEvent) => {
    if (activeMenu && (!(event.target instanceof Element) || !event.target.closest('[data-menu-interactive="true"]'))) activeMenu = null;
  };
  window.addEventListener('pointerdown', closeOutside);
  onDestroy(() => window.removeEventListener('pointerdown', closeOutside));
</script>

<nav
  class="menu-bar troubadour-menu-bar"
  class:window-controls-overlay-active={overlay.visible}
  style={overlayStyle}
  aria-label={$t('main.menu.applicationMenu', { default: 'Application menu' })}
>
  <div class="menu-groups">
    {#each ['app', 'file', 'edit', 'album', 'tools', 'help'] as menuName}
      {@const menu = menuName as MenuId}
      <div class="menu-root" role="none" on:pointerenter={() => hoverMenu(menu)}>
        <button
          class="menu-trigger"
          class:app-menu-trigger={menu === 'app'}
          class:active={activeMenu === menu}
          data-menu-interactive="true"
          data-troubadour-menu={menu}
          type="button"
          aria-label={menu === 'app' ? 'izci' : undefined}
          aria-haspopup="menu"
          aria-expanded={activeMenu === menu}
          on:click={() => openMenu(menu)}
        >{#if menu === 'app'}<span class="izci-menu-glyph" aria-hidden="true"></span>{:else}{labelFor(menu)}{/if}</button>
        {#if activeMenu === menu}
          <MenuSurface items={itemsFor(menu)} x={menuX} y={menuY} on:action={(event) => run(event.detail)} on:dismiss={() => activeMenu = null} />
        {/if}
      </div>
    {/each}
  </div>
  <div class="tool-window-title" aria-live="polite">
    <strong>{$t('troubadour.title', { default: 'Troubadour' })}</strong>
    {#if summary}<span>{summary}</span>{/if}
  </div>
</nav>
