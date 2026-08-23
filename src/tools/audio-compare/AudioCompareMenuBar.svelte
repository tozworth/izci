<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import WindowMenuBar from '$lib/components/WindowMenuBar.svelte';
  import { applyManualLoadoutSettings } from '$lib/services/loadouts';
  import { requestOptionsFromTool, windowManager } from '$lib/services/window-manager';
  import { loadouts } from '$lib/stores/loadouts';
  import type { MenuActionItem, WindowMenuGroup } from '$lib/types';
  import { getLoadoutColorValue, LOADOUT_TYPE_ICONS } from '$lib/utils/loadout-presentation';

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
      id: 'compare',
      label: $t('audioCompare.menu.compare', { default: 'Compare' }),
      icon: 'compare_arrows',
      items: compareItems
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
    if (action === 'openA' || action === 'openB' || action === 'close' || action === 'playPause'
      || action === 'stop' || action === 'auditionA' || action === 'auditionB' || action === 'difference'
      || action === 'toggleLoop' || action === 'toggleGainMatch') {
      dispatch(action);
    }
  }

</script>

<WindowMenuBar
  groups={menuGroups}
  title={$t('audioCompare.title', { default: 'Audio Compare' })}
  subtitle={fileSummary}
  ariaLabel={$t('main.menu.applicationMenu', { default: 'Application menu' })}
  on:action={(event) => run(event.detail as ActionId)}
/>
