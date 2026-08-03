<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';

  export let open = false;
  export let installAvailable = false;
  export let videoAvailable = false;
  export let patternsVisible = false;

  type DrawerAction =
    | 'openFiles'
    | 'openFolder'
    | 'manageFolders'
    | 'showPatterns'
    | 'showVideo'
    | 'openOptions'
    | 'openAbout'
    | 'install';

  const dispatch = createEventDispatcher<{
    close: void;
    openFiles: void;
    openFolder: void;
    manageFolders: void;
    showPatterns: void;
    showVideo: void;
    openOptions: void;
    openAbout: void;
    install: void;
  }>();

  function run(action: DrawerAction): void {
    dispatch(action, undefined);
    dispatch('close');
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (open && event.key === 'Escape') {
      event.preventDefault();
      dispatch('close');
    }
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <button
    class="mobile-drawer-scrim"
    type="button"
    aria-label={$t('mobile.menu.close', { default: 'Close menu' })}
    on:click={() => dispatch('close')}
  ></button>
{/if}

<aside class="mobile-drawer" class:is-open={open} aria-hidden={!open} aria-label={$t('mobile.menu.label', { default: 'Main menu' })}>
  <header class="mobile-drawer-header">
    <img src="/icons/izci-mark.svg" alt="" />
    <div>
      <strong>izci</strong>
      <span>{$t('mobile.menu.offlinePlayer', { default: 'Offline media player' })}</span>
    </div>
    <button type="button" aria-label={$t('mobile.menu.close', { default: 'Close menu' })} on:click={() => dispatch('close')}>
      <span class="material-symbols-outlined" aria-hidden="true">close</span>
    </button>
  </header>

  <nav class="mobile-drawer-content">
    <section>
      <h2>{$t('mobile.menu.addMedia', { default: 'Add media' })}</h2>
      <button type="button" on:click={() => run('openFiles')}>
        <span class="material-symbols-outlined" aria-hidden="true">audio_file</span>
        <span>{$t('main.menu.openFiles', { default: 'Open files...' })}</span>
      </button>
      <button type="button" on:click={() => run('openFolder')}>
        <span class="material-symbols-outlined" aria-hidden="true">folder_open</span>
        <span>{$t('main.menu.openFolder', { default: 'Open folder...' })}</span>
      </button>
      <button type="button" on:click={() => run('manageFolders')}>
        <span class="material-symbols-outlined" aria-hidden="true">folder_copy</span>
        <span>{$t('main.menu.manageFolders', { default: 'Manage folders...' })}</span>
      </button>
    </section>

    <section>
      <h2>{$t('main.menu.view', { default: 'View' })}</h2>
      <button type="button" class:active={patternsVisible} on:click={() => run('showPatterns')}>
        <span class="material-symbols-outlined" aria-hidden="true">view_timeline</span>
        <span>{$t('main.menu.patterns', { default: 'Patterns' })}</span>
      </button>
      {#if videoAvailable}
        <button type="button" on:click={() => run('showVideo')}>
          <span class="material-symbols-outlined" aria-hidden="true">movie</span>
          <span>{$t('main.video.menu', { default: 'Video' })}</span>
        </button>
      {/if}
    </section>

    <section>
      <h2>{$t('mobile.menu.app', { default: 'App' })}</h2>
      <button type="button" on:click={() => run('openOptions')}>
        <span class="material-symbols-outlined" aria-hidden="true">settings</span>
        <span>{$t('main.menu.options', { default: 'Options...' })}</span>
      </button>
      {#if installAvailable}
        <button type="button" on:click={() => run('install')}>
          <span class="material-symbols-outlined" aria-hidden="true">install_mobile</span>
          <span>{$t('main.menu.installApp', { default: 'Install izci...' })}</span>
        </button>
      {/if}
      <button type="button" on:click={() => run('openAbout')}>
        <span class="material-symbols-outlined" aria-hidden="true">info</span>
        <span>{$t('main.menu.about', { default: 'About' })}</span>
      </button>
    </section>
  </nav>
</aside>
