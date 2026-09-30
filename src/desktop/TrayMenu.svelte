<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { t } from 'svelte-i18n';
  import { windowDismiss } from '$lib/components/track-list-panel/actions/window-dismiss';
  import { TRAY_ACTION_EVENT, TRAY_OPEN_EVENT, TRAY_REQUEST_EVENT, TRAY_STATE_EVENT, trayItems, type TrayState } from './tray-protocol';

  let state: TrayState = { playing: false, canControl: false };
  let visible = false;
  let menuElement: HTMLDivElement;
  $: items = trayItems(state, (key) => $t(key));
  $: transport = items.slice(0, 3);
  $: commands = items.slice(3);

  function dismiss(): void { visible = false; void invoke('hide_desktop_tray_menu').catch(() => undefined); }
  function action(value: string): void { void emitTo('main', TRAY_ACTION_EVENT, value); }
  function select(value: string): void { action(value); dismiss(); }

  function navigate(event: KeyboardEvent): void {
    if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...menuElement.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    if (!buttons.length) return;
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const backwards = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : current < 0 ? (backwards ? buttons.length - 1 : 0)
      : (current + (backwards ? -1 : 1) + buttons.length) % buttons.length;
    buttons[index].focus();
  }

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
      if (disposed || current !== revision || !visible) return;
      // Give the popup keyboard focus without selecting a command on open.
      menu.focus({ preventScroll: true });
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
  <div bind:this={menuElement} class="menu-list menu-surface tray-menu" role="menu"
    aria-label={$t('desktop.tray.menu')} tabindex="-1" on:keydown={navigate}
    use:windowDismiss={{ enabled: true, dismissOnResize: false, onDismiss: dismiss }}>
    <div class="tray-transport" role="none">
      {#each transport as item (item.id)}
        <button type="button" role="menuitem" disabled={item.disabled} aria-label={item.label}
          title={item.label} on:click={() => select(item.id)}>
          <span class="material-symbols-outlined" aria-hidden="true">{item.icon}</span>
        </button>
      {/each}
    </div>
    {#each commands as item (item.id)}
      {#if item.separatorBefore}<div class="menu-separator" role="separator"></div>{/if}
      <button type="button" role="menuitem" on:click={() => select(item.id)}>
        <span class="material-symbols-outlined menu-item-icon" aria-hidden="true">{item.icon}</span>
        <span class="menu-item-label">{item.label}</span>
      </button>
    {/each}
  </div>
{/if}
