<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import WindowMenuBar from '$lib/components/WindowMenuBar.svelte';
  import type { MenuActionItem, WindowMenuGroup } from '$lib/types';

  type ActionId = 'openA' | 'openB' | 'close' | 'playPause' | 'stop' | 'auditionA' | 'auditionB'
    | 'difference' | 'toggleLoop' | 'toggleGainMatch';

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

  $: appItems = [
    { id: 'close', label: $t('audioCompare.menu.close', { default: 'Close Audio Compare' }), icon: 'close', shortcut: 'Ctrl+W' }
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
