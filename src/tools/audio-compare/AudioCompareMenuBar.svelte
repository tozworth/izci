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

  type MenuId = 'app' | 'file' | 'compare';
  type ActionId = 'openA' | 'openB' | 'close' | 'playPause' | 'stop' | 'auditionA' | 'auditionB'
    | 'difference' | 'toggleLoop' | 'toggleGainMatch' | 'openOptions' | 'openLoadouts' | 'openAbout'
    | `applyLoadout:${string}`;

  export let fileSummary = '';
  export let canPlay = false;
  export let canCompare = false;
  export let hasA = false;
  export let hasB = false;
  export let playing = false;
  export let loopEnabled = false;
  export let gainMatchEnabled = true;

  const dispatch = createEventDispatcher<{
    openA: void;
    openB: void;
    close: void;
    playPause: void;
    stop: void;
    auditionA: void;
    auditionB: void;
    difference: void;
    toggleLoop: void;
    toggleGainMatch: void;
  }>();

  let activeMenu: MenuId | null = null;
  let menuX = 8;
  let menuY = 36;
  let appTrigger: HTMLButtonElement;
  let fileTrigger: HTMLButtonElement;
  let compareTrigger: HTMLButtonElement;

  $: loadoutItems = [
    { id: 'openLoadouts', label: $t('main.menu.openLoadouts', { default: 'Open loadouts' }), icon: 'bookmark_manager' },
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
    { id: 'close', label: $t('audioCompare.menu.close', { default: 'Close Audio Compare' }), icon: 'close', shortcut: 'Ctrl+W', separatorBefore: true }
  ] satisfies MenuActionItem[];
  $: fileItems = [
    { id: 'openA', label: $t('audioCompare.openA', { default: 'Open source A...' }), icon: 'looks_one', shortcut: 'Ctrl+1' },
    { id: 'openB', label: $t('audioCompare.openB', { default: 'Open source B...' }), icon: 'looks_two', shortcut: 'Ctrl+2' },
    { id: 'close', label: $t('audioCompare.menu.close', { default: 'Close Audio Compare' }), icon: 'close', shortcut: 'Ctrl+W', separatorBefore: true }
  ] satisfies MenuActionItem[];
  $: compareItems = [
    { id: 'playPause', label: playing ? $t('audioCompare.pause', { default: 'Pause' }) : $t('audioCompare.play', { default: 'Play' }), icon: playing ? 'pause' : 'play_arrow', shortcut: 'Space', disabled: !canPlay },
    { id: 'stop', label: $t('audioCompare.stop', { default: 'Stop' }), icon: 'stop', disabled: !canPlay },
    { id: 'auditionA', label: $t('audioCompare.auditionA', { default: 'Listen to A' }), icon: 'looks_one', shortcut: '1', disabled: !hasA, separatorBefore: true },
    { id: 'auditionB', label: $t('audioCompare.auditionB', { default: 'Listen to B' }), icon: 'looks_two', shortcut: '2', disabled: !hasB },
    { id: 'difference', label: $t('audioCompare.difference', { default: 'Difference (A − B)' }), icon: 'difference', shortcut: '3', disabled: !canCompare },
    { id: 'toggleLoop', label: $t('audioCompare.loopSelection', { default: 'Loop selection' }), icon: loopEnabled ? 'repeat_on' : 'repeat', checked: loopEnabled, separatorBefore: true },
    { id: 'toggleGainMatch', label: $t('audioCompare.loudnessMatch', { default: 'Loudness match' }), icon: 'balance', checked: gainMatchEnabled, disabled: !canCompare }
  ] satisfies MenuActionItem[];

  $: overlay = $windowControlsOverlayState;
  $: rect = overlay.titlebarAreaRect;
  $: overlayStyle = overlay.visible
    ? `--window-controls-overlay-x: ${rect.x}px; --window-controls-overlay-y: ${rect.y}px; --window-controls-overlay-width: ${rect.width}px; --window-controls-overlay-height: ${rect.height}px;`
    : '';

  function triggerFor(menu: MenuId): HTMLButtonElement {
    return menu === 'app' ? appTrigger : menu === 'file' ? fileTrigger : compareTrigger;
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

  function requestOptions(view?: 'loadouts' | 'about'): void {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'izci:open-options', view }, window.location.origin);
      return;
    }
    windowManager.openOptions(view);
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
    if (action === 'openA' || action === 'openB' || action === 'close' || action === 'playPause'
      || action === 'stop' || action === 'auditionA' || action === 'auditionB' || action === 'difference'
      || action === 'toggleLoop' || action === 'toggleGainMatch') {
      dispatch(action);
    }
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
  class="menu-bar audio-compare-menu-bar"
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
    <div class="menu-root" role="none" on:pointerenter={() => hoverMenu('compare')}>
      <button bind:this={compareTrigger} class="menu-trigger" class:active={activeMenu === 'compare'} data-menu-interactive="true" type="button" aria-haspopup="menu" aria-expanded={activeMenu === 'compare'} on:click={() => openMenu('compare')}>{$t('audioCompare.menu.compare', { default: 'Compare' })}</button>
      {#if activeMenu === 'compare'}<MenuSurface items={compareItems} x={menuX} y={menuY} on:action={(event) => run(event.detail as ActionId)} on:dismiss={() => activeMenu = null} />{/if}
    </div>
  </div>
  <div class="audio-compare-window-title" aria-live="polite">
    <strong>{$t('audioCompare.title', { default: 'Audio Compare' })}</strong>
    {#if fileSummary}<span>{fileSummary}</span>{/if}
  </div>
</nav>
