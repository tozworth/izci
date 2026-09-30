<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { t } from 'svelte-i18n';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import { TRAY_ACTION_EVENT, TRAY_OPEN_EVENT, TRAY_REQUEST_EVENT, TRAY_STATE_EVENT, trayItems, type TrayState } from './tray-protocol';

  let state: TrayState = { playing: false, canControl: false };
  let visible = false;
  $: items = trayItems(state, (key) => $t(key));

  function dismiss(): void { visible = false; void invoke('hide_desktop_tray_menu').catch(() => undefined); }
  function action(value: string): void { void emitTo('main', TRAY_ACTION_EVENT, value); }

  onMount(() => {
    let disposed = false;
    const releases: UnlistenFn[] = [];
    let revision = 0;
    async function open(): Promise<void> {
      const current = ++revision;
      visible = true;
      await emitTo('main', TRAY_REQUEST_EVENT);
      await tick();
      await document.fonts.ready;
      if (disposed || current !== revision || !visible) return;
      const menu = document.querySelector<HTMLElement>('.menu-surface');
      if (!menu) return;
      // Measure unclamped menu content before the native popup is shown.
      await invoke('show_desktop_tray_menu', { width: menu.offsetWidth + 12, height: menu.scrollHeight + 12 });
      menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
    void Promise.all([
      listen<TrayState>(TRAY_STATE_EVENT, ({ payload }) => { state = payload; }),
      listen(TRAY_OPEN_EVENT, () => { void open().catch(console.error); }),
      listen('izci:desktop-tray-dismiss', () => { ++revision; visible = false; })
    ].map((registration) => registration.then((release) => {
      if (disposed) release(); else releases.push(release);
    }))).then(() => invoke('desktop_tray_menu_ready')).catch(console.error);
    return () => { disposed = true; ++revision; releases.forEach((release) => release()); };
  });
</script>

<svelte:window on:contextmenu={(event) => event.preventDefault()} />
{#if visible}
  <MenuSurface {items} x={6} y={6} viewportPadding={0} ariaLabel={$t('desktop.tray.menu')}
    on:action={(event) => action(event.detail)} on:dismiss={dismiss} />
{/if}
