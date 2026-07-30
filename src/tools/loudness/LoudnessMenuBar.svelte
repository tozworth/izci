<script lang="ts">
  import { createEventDispatcher, onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import { windowControlsOverlayState } from '$lib/services/window-controls-overlay';
  import { windowManager } from '$lib/services/window-manager';
  import type { MenuActionItem } from '$lib/types';

  type MenuId = 'app' | 'file' | 'selection' | 'analysis';
  type ActionId = 'addFiles' | 'addFolder' | 'write' | 'close' | 'selectAll' | 'selectNone'
    | 'removeSelected' | 'analyze' | 'stop' | 'openOptions' | 'openAbout';

  export let fileSummary = '';
  export let canAnalyze = false;
  export let canWrite = false;
  export let canRemove = false;
  export let canSelect = false;
  export let analyzing = false;
  export let busy = false;

  const dispatch = createEventDispatcher<{
    addFiles: void;
    addFolder: void;
    write: void;
    close: void;
    selectAll: void;
    selectNone: void;
    removeSelected: void;
    analyze: void;
    stop: void;
  }>();

  let activeMenu: MenuId | null = null;
  let menuX = 8;
  let menuY = 36;
  let appTrigger: HTMLButtonElement;
  let fileTrigger: HTMLButtonElement;
  let selectionTrigger: HTMLButtonElement;
  let analysisTrigger: HTMLButtonElement;

  $: appItems = [
    { id: 'openOptions', label: $t('main.menu.options', { default: 'Options...' }), icon: 'settings', shortcut: 'Ctrl+P' },
    { id: 'openAbout', label: $t('main.menu.about', { default: 'About' }), icon: 'info' },
    { id: 'close', label: $t('loudness.menu.close', { default: 'Close Loudness' }), icon: 'close', shortcut: 'Ctrl+W', separatorBefore: true }
  ] satisfies MenuActionItem[];
  $: fileItems = [
    { id: 'addFiles', label: $t('loudness.addFiles', { default: 'Add files...' }), icon: 'audio_file', shortcut: 'Ctrl+O', disabled: busy },
    { id: 'addFolder', label: $t('loudness.addFolder', { default: 'Add folder...' }), icon: 'create_new_folder', disabled: busy },
    { id: 'write', label: $t('loudness.writeSelected', { default: 'Write tags in-place' }), icon: 'save', shortcut: 'Ctrl+S', disabled: !canWrite, separatorBefore: true },
    { id: 'close', label: $t('loudness.menu.close', { default: 'Close Loudness' }), icon: 'close', shortcut: 'Ctrl+W', separatorBefore: true }
  ] satisfies MenuActionItem[];
  $: selectionItems = [
    { id: 'selectAll', label: $t('loudness.selectAll', { default: 'Select all' }), icon: 'select_all', shortcut: 'Ctrl+A', disabled: !canSelect },
    { id: 'selectNone', label: $t('loudness.menu.selectNone', { default: 'Select none' }), icon: 'deselect', disabled: !canSelect },
    { id: 'removeSelected', label: $t('loudness.removeSelected', { default: 'Remove selected' }), icon: 'remove', disabled: !canRemove, separatorBefore: true }
  ] satisfies MenuActionItem[];
  $: analysisItems = [
    { id: 'analyze', label: $t('loudness.analyzeSelected', { default: 'Analyze selected' }), icon: 'query_stats', disabled: !canAnalyze },
    { id: 'stop', label: $t('loudness.stop', { default: 'Stop' }), icon: 'stop_circle', disabled: !analyzing, separatorBefore: true }
  ] satisfies MenuActionItem[];

  $: overlay = $windowControlsOverlayState;
  $: rect = overlay.titlebarAreaRect;
  $: overlayStyle = overlay.visible
    ? `--window-controls-overlay-x: ${rect.x}px; --window-controls-overlay-y: ${rect.y}px; --window-controls-overlay-width: ${rect.width}px; --window-controls-overlay-height: ${rect.height}px;`
    : '';

  function triggerFor(menu: MenuId): HTMLButtonElement {
    if (menu === 'app') return appTrigger;
    if (menu === 'file') return fileTrigger;
    return menu === 'selection' ? selectionTrigger : analysisTrigger;
  }

  function openMenu(menu: MenuId): void {
    activeMenu = activeMenu === menu ? null : menu;
    if (!activeMenu) return;
    const bounds = triggerFor(activeMenu).getBoundingClientRect();
    menuX = bounds.left;
    menuY = bounds.bottom + 6;
  }

  function hoverMenu(menu: MenuId): void {
    if (!activeMenu || activeMenu === menu) return;
    activeMenu = menu;
    const bounds = triggerFor(menu).getBoundingClientRect();
    menuX = bounds.left;
    menuY = bounds.bottom + 6;
  }

  function requestOptions(view?: 'about'): void {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'izci:open-options', view }, window.location.origin);
      return;
    }
    windowManager.openOptions(view);
  }

  function run(action: ActionId): void {
    activeMenu = null;
    if (action === 'openOptions') return requestOptions();
    if (action === 'openAbout') return requestOptions('about');
    dispatch(action);
  }

  function handleWindowPointerDown(event: PointerEvent): void {
    const target = event.target;
    if (activeMenu && (!(target instanceof Element) || !target.closest('[data-menu-interactive="true"]'))) {
      activeMenu = null;
    }
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      activeMenu = null;
      return;
    }
    if (!event.ctrlKey || event.altKey) return;
    const key = event.key.toLowerCase();
    const target = event.target;
    const editing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
    if (key === 'o' && !event.shiftKey && !busy) run('addFiles');
    else if (key === 's' && canWrite) run('write');
    else if (key === 'w') run('close');
    else if (key === 'a' && canSelect && !editing) run('selectAll');
    else return;
    event.preventDefault();
  }

  window.addEventListener('pointerdown', handleWindowPointerDown);
  window.addEventListener('keydown', handleWindowKeydown);
  onDestroy(() => {
    window.removeEventListener('pointerdown', handleWindowPointerDown);
    window.removeEventListener('keydown', handleWindowKeydown);
  });
</script>

<nav
  class="menu-bar loudness-menu-bar"
  class:window-controls-overlay-active={overlay.visible}
  style={overlayStyle}
  aria-label={$t('main.menu.applicationMenu', { default: 'Application menu' })}
>
  <div class="menu-groups">
    <div class="menu-root" role="none" on:pointerenter={() => hoverMenu('app')}>
      <button bind:this={appTrigger} class="menu-trigger app-menu-trigger" class:active={activeMenu === 'app'} data-menu-interactive="true" type="button" aria-label="izci" aria-haspopup="menu" aria-expanded={activeMenu === 'app'} on:click={() => openMenu('app')}><span class="izci-menu-glyph" aria-hidden="true"></span></button>
      {#if activeMenu === 'app'}<MenuSurface items={appItems} x={menuX} y={menuY} on:action={(event) => run(event.detail as ActionId)} on:dismiss={() => activeMenu = null} />{/if}
    </div>
    <div class="menu-root" role="none" on:pointerenter={() => hoverMenu('file')}>
      <button bind:this={fileTrigger} class="menu-trigger" class:active={activeMenu === 'file'} data-menu-interactive="true" type="button" aria-haspopup="menu" aria-expanded={activeMenu === 'file'} on:click={() => openMenu('file')}>{$t('main.menu.file', { default: 'File' })}</button>
      {#if activeMenu === 'file'}<MenuSurface items={fileItems} x={menuX} y={menuY} on:action={(event) => run(event.detail as ActionId)} on:dismiss={() => activeMenu = null} />{/if}
    </div>
    <div class="menu-root" role="none" on:pointerenter={() => hoverMenu('selection')}>
      <button bind:this={selectionTrigger} class="menu-trigger" class:active={activeMenu === 'selection'} data-menu-interactive="true" type="button" aria-haspopup="menu" aria-expanded={activeMenu === 'selection'} on:click={() => openMenu('selection')}>{$t('loudness.menu.selection', { default: 'Selection' })}</button>
      {#if activeMenu === 'selection'}<MenuSurface items={selectionItems} x={menuX} y={menuY} on:action={(event) => run(event.detail as ActionId)} on:dismiss={() => activeMenu = null} />{/if}
    </div>
    <div class="menu-root" role="none" on:pointerenter={() => hoverMenu('analysis')}>
      <button bind:this={analysisTrigger} class="menu-trigger" class:active={activeMenu === 'analysis'} data-menu-interactive="true" type="button" aria-haspopup="menu" aria-expanded={activeMenu === 'analysis'} on:click={() => openMenu('analysis')}>{$t('loudness.menu.analysis', { default: 'Analysis' })}</button>
      {#if activeMenu === 'analysis'}<MenuSurface items={analysisItems} x={menuX} y={menuY} on:action={(event) => run(event.detail as ActionId)} on:dismiss={() => activeMenu = null} />{/if}
    </div>
  </div>
  <div class="loudness-window-title" aria-live="polite">
    <strong>{$t('loudness.title', { default: 'Loudness' })}</strong>
    {#if fileSummary}<span>{fileSummary}</span>{/if}
  </div>
</nav>
