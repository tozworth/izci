<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import { fitDesktopTitlebar } from './titlebar-overflow';
  import {
    desktopWindowState, minimizeDesktopWindow, toggleDesktopMaximize, closeDesktopWindow
  } from './window-titlebar';

  export let miniPlayerSupported = false;
  export let miniPlayerActive = false;
  const dispatch = createEventDispatcher<{ miniplayer: void }>();
  $: maximizeLabel = $desktopWindowState.maximized
    ? $t('main.windowControls.restore') : $t('main.windowControls.maximize');
</script>

<div class="desktop-window-controls" data-menu-interactive="true" use:fitDesktopTitlebar>
  {#if miniPlayerSupported}
    <button class="mini-player-control" title={$t('main.menu.miniPlayer')} aria-label={$t('main.menu.miniPlayer')}
      aria-pressed={miniPlayerActive} on:click={() => dispatch('miniplayer')}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3.5" width="11" height="9" /><path d="M8 8h4v3H8z" fill="currentColor" stroke="none" /></svg>
    </button>
  {/if}
  <button title={$t('main.windowControls.minimize')} aria-label={$t('main.windowControls.minimize')} on:click={minimizeDesktopWindow}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5h10" /></svg>
  </button>
  <button title={maximizeLabel} aria-label={maximizeLabel} on:click={toggleDesktopMaximize}>
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {#if $desktopWindowState.maximized}
        <path d="M5.5 5.5v-2h7v7h-2" /><rect x="3.5" y="5.5" width="7" height="7" />
      {:else}
        <rect x="3.5" y="3.5" width="9" height="9" />
      {/if}
    </svg>
  </button>
  <button class="close-control" title={$t('main.windowControls.close')} aria-label={$t('main.windowControls.close')} on:click={closeDesktopWindow}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 3.5 9 9m0-9-9 9" /></svg>
  </button>
</div>

<style>
  :global(.menu-bar.desktop-titlebar) {
    min-width: 0; max-width: 100vw;
    min-height: 32px; padding: 0; gap: 0; user-select: none;
  }
  :global(.desktop-titlebar .menu-brand) {
    flex: 1 1 0; justify-content: center;
    margin: 0; padding: 0; border-radius: 0;
    overflow: hidden; pointer-events: none;
  }
  :global(.app-shell:not(.compact-workspace) .main-workspace-menu-bar.desktop-titlebar .menu-brand) {
    position: absolute; left: 50%; transform: translateX(-50%);
    width: max-content;
  }
  :global(.desktop-titlebar .menu-groups),
  :global(.desktop-titlebar .compact-menu-trigger) {
    flex-shrink: 0;
  }
  :global(.desktop-titlebar .menu-brand > *) { flex: 0 0 auto; }
  :global(.desktop-titlebar-hide-brand .menu-brand) { visibility: hidden; }
  :global(.desktop-titlebar-hide-mini .mini-player-control) { display: none; }
  :global(.desktop-titlebar-inactive .menu-brand) { opacity: 0.6; }
  .desktop-window-controls { display: flex; align-self: stretch; flex: 0 0 auto; margin-left: auto; }
  button {
    display: grid; place-items: center; width: 40px; min-height: 32px;
    margin: 0; padding: 0; border: 0; border-radius: 0; cursor: default;
    background: transparent; color: var(--window-topbar-text); transition: none;
  }
  button:hover { background: var(--window-topbar-hover-surface); }
  button:active { background: var(--hover-control); }
  button:focus-visible { outline: 1px solid var(--accent-strong); outline-offset: -3px; }
  .mini-player-control[aria-pressed='true'] { color: var(--accent-strong); }
  .close-control:hover, .close-control:active { background: #c42b1c; color: white; }
  svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1; }
</style>
