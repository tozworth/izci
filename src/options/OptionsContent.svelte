<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';
  import { t } from 'svelte-i18n';
  import { loadOptionsView } from './view-loaders';
  import type { OptionsViewName } from './views';

  export let activeView: OptionsViewName;
  export let onSelectView: (view: OptionsViewName) => void;

  const dispatch = createEventDispatcher<{ ready: void }>();
  let content: HTMLElement | null = null;

  $: viewPromise = loadOptionsView(activeView);

  // Signal after the loaded page (or retry control) is mounted. Oda must not
  // depend on a fixed number of animation frames while a chunk is loading.
  $: if (content) void notifyReady(content);

  async function notifyReady(mounted: HTMLElement): Promise<void> {
    await tick();
    if (content === mounted) dispatch('ready');
  }
</script>

{#key activeView}
  {#await viewPromise}
    <p role="status">{$t('options.content.loading', { default: 'Loading options…' })}</p>
  {:then viewModule}
    <div bind:this={content} class="options-page-host">
      {#if viewModule.kind === 'about'}
        <svelte:component this={viewModule.default} onOpenLicenses={() => onSelectView('licenses')} />
      {:else if viewModule.kind === 'backups'}
        <svelte:component this={viewModule.default} onOpenFolders={() => onSelectView('folders')} />
      {:else}
        <svelte:component this={viewModule.default} />
      {/if}
    </div>
  {:catch}
    <div bind:this={content} class="view">
      <p role="alert">{$t('options.content.loadFailed', { default: 'This options page could not be loaded.' })}</p>
      <button type="button" on:click={() => (viewPromise = loadOptionsView(activeView))}>
        {$t('options.content.retry', { default: 'Retry' })}
      </button>
    </div>
  {/await}
{/key}

<style>
  .options-page-host { display: contents; }
</style>
