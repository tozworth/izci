<script lang="ts">
  import { createEventDispatcher, onDestroy, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import { loadOptionsView } from './view-loaders';
  import type { OptionsViewName } from './views';

  export let activeView: OptionsViewName;
  export let onSelectView: (view: OptionsViewName) => void;
  export let mobilePresentation = false;

  const dispatch = createEventDispatcher<{ ready: void }>();
  let viewModule: Awaited<ReturnType<typeof loadOptionsView>> | null = null;
  let renderedView: OptionsViewName | null = null;
  let loading = true;
  let loadFailed = false;
  let requestVersion = 0;

  $: void showView(activeView, mobilePresentation);

  onDestroy(() => { requestVersion += 1; });

  async function showView(view: OptionsViewName, mobile = mobilePresentation): Promise<void> {
    const version = ++requestVersion;
    loading = true;
    loadFailed = false;
    try {
      const loaded = await loadOptionsView(view, mobile);
      if (version !== requestVersion) return;
      viewModule = loaded;
      renderedView = view;
    } catch {
      if (version !== requestVersion) return;
      loadFailed = true;
    }
    loading = false;

    // Oda waits for the new page (or retry control) to be mounted before focusing.
    await tick();
    if (version === requestVersion) dispatch('ready');
  }
</script>

<div class="options-page-host" class:loading aria-busy={loading} inert={loading}>
  {#if loadFailed}
    <div class="view">
      <p role="alert">{$t('options.content.loadFailed', { default: 'This options page could not be loaded.' })}</p>
      <button type="button" on:click={() => showView(activeView)}>
        {$t('options.content.retry', { default: 'Retry' })}
      </button>
    </div>
  {:else if viewModule}
    {#key renderedView}
      {#if viewModule.kind === 'about'}
        <svelte:component this={viewModule.default} onOpenLicenses={() => onSelectView('licenses')} />
      {:else if viewModule.kind === 'backups'}
        <svelte:component this={viewModule.default} onOpenFolders={() => onSelectView('folders')} />
      {:else}
        <svelte:component this={viewModule.default} />
      {/if}
    {/key}
  {/if}
</div>

<style>
  .options-page-host { display: contents; }

  .options-page-host > :global(*) { transition: opacity 120ms ease; }
  .options-page-host.loading > :global(*) { opacity: 0.75; }

  @media (prefers-reduced-motion: reduce) {
    .options-page-host > :global(*) { transition: none; }
  }
</style>
