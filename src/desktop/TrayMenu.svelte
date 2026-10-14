<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { invoke } from '@tauri-apps/api/core';
  import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { t } from 'svelte-i18n';
  import { windowDismiss } from '$lib/components/track-list-panel/actions/window-dismiss';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import { rafSettings } from '$lib/stores/raf-settings';
  import { rafPresets } from '$lib/stores/raf-presets';
  import { buildRafMenuItems } from '$lib/services/raf-menu';
  import { presentTrayMenu } from './tray-menu-presenter';
  import { TRAY_ACTION_EVENT, TRAY_OPEN_EVENT, TRAY_REQUEST_EVENT, TRAY_STATE_EVENT, trayItems, type TrayState } from './tray-protocol';

  let state: TrayState = { playing: false, canControl: false };
  let visible = false;
  let rafOpen = false;
  let menuElement: HTMLDivElement;
  let labels: Record<string, string>;
  $: labels = {
    'main.player.previousTrack': $t('main.player.previousTrack'),
    'desktop.tray.pause': $t('desktop.tray.pause'),
    'desktop.tray.play': $t('desktop.tray.play'),
    'main.player.nextTrack': $t('main.player.nextTrack'),
    'main.menu.options': $t('main.menu.options'),
    'options.views.raf': $t('options.views.raf'),
    'desktop.tray.oda': $t('desktop.tray.oda'),
    'main.menu.miniPlayer': $t('main.menu.miniPlayer'),
    'desktop.tray.exit': $t('desktop.tray.exit')
  };
  $: rafItems = $rafSettings.enabled
    ? buildRafMenuItems({ translate: $t, rafSettings: $rafSettings, rafPresets: $rafPresets }) : [];
  $: if (!$rafSettings.enabled) rafOpen = false;
  $: items = trayItems(state, (key) => labels[key], rafItems);
  $: transport = items.slice(0, 3);
  $: commands = items.slice(3);

  function dismiss(): void { visible = false; rafOpen = false; void invoke('hide_desktop_tray_menu').catch(() => undefined); }
  function action(value: string): void { void emitTo('main', TRAY_ACTION_EVENT, value); }
  function select(value: string): void { action(value); dismiss(); }

  async function setRafOpen(open: boolean): Promise<void> {
    rafOpen = open;
    await tick();
    menuElement.querySelector<HTMLButtonElement>(open ? '.tray-back' : '[data-tray-raf]')?.focus();
  }

  function navigate(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft' && rafOpen) {
      event.preventDefault();
      void setRafOpen(false);
      return;
    }
    if (event.key === 'ArrowRight' && document.activeElement?.hasAttribute('data-tray-raf')) {
      event.preventDefault();
      void setRafOpen(true);
      return;
    }
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
    function open(): void {
      rafOpen = false;
      visible = true;
      void emitTo('main', TRAY_REQUEST_EVENT).catch(console.error);
    }
    void Promise.all([
      listen<TrayState>(TRAY_STATE_EVENT, ({ payload }) => { state = payload; }),
      listen(TRAY_OPEN_EVENT, open),
      listen('izci:desktop-tray-dismiss', () => { visible = false; rafOpen = false; })
    ].map((registration) => registration.then((release) => {
      if (disposed) release(); else releases.push(release);
    }))).then(() => invoke('desktop_tray_menu_ready')).catch(console.error);
    return () => { disposed = true; releases.forEach((release) => release()); };
  });
</script>

<svelte:window on:contextmenu={(event) => event.preventDefault()} />
{#if visible}
  <div bind:this={menuElement} class="menu-list menu-surface tray-menu" role="menu"
    aria-label={$t('desktop.tray.menu')} tabindex="-1" on:keydown={navigate}
    data-window-dismiss-ignore-scroll
    use:presentTrayMenu
    use:windowDismiss={{ enabled: true, dismissOnResize: false, onDismiss: dismiss }}>
    {#if rafOpen}
      <button type="button" role="menuitem" class="tray-back" on:click={() => setRafOpen(false)}>
        <span class="material-symbols-outlined menu-item-icon" aria-hidden="true">arrow_back</span>
        <span class="menu-item-label">{$t('main.menu.back')}</span>
      </button>
      <div class="menu-separator" role="separator"></div>
      <MenuSurface nested items={rafItems} ariaLabel={$t('options.views.raf')}
        on:action={(event) => select(event.detail)} on:dismiss={dismiss} />
    {:else}
      <div class="tray-transport" role="none">
        {#each transport as item (item.id)}
          <button type="button" role="menuitem" disabled={item.disabled} aria-label={item.label}
            title={item.label} on:click={() => action(item.id)}>
            <span class="material-symbols-outlined" aria-hidden="true">{item.icon}</span>
          </button>
        {/each}
      </div>
      {#each commands as item (item.id)}
        {#if item.separatorBefore}<div class="menu-separator" role="separator"></div>{/if}
        <button type="button" role="menuitem" data-tray-raf={item.children ? '' : undefined}
          aria-haspopup={item.children ? 'menu' : undefined}
          aria-expanded={item.children ? false : undefined}
          on:click={() => item.children ? setRafOpen(true) : select(item.id)}>
          <span class="material-symbols-outlined menu-item-icon" aria-hidden="true">{item.icon}</span>
          <span class="menu-item-label">{item.label}</span>
          {#if item.children}<span class="material-symbols-outlined menu-item-chevron" aria-hidden="true">chevron_right</span>{/if}
        </button>
      {/each}
    {/if}
  </div>
{/if}
