<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { formatDuration, truncateMiddle } from '$lib/utils/files';
  import type { PlaylistItem } from '$lib/types';

  export let items: PlaylistItem[] = [];
  export let activeId: string | null = null;

  const dispatch = createEventDispatcher<{
    addFiles: FileList | File[];
    select: string;
  }>();

  function handleInput(event: Event) {
    const input = event.currentTarget as HTMLInputElement;

    if (input.files?.length) {
      dispatch('addFiles', input.files);
      input.value = '';
    }
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer?.files?.length) {
      dispatch('addFiles', event.dataTransfer.files);
    }
  }

  function formatTrackType(item: PlaylistItem): string {
    return item.kind === 'module' ? 'MOD' : item.extension.toUpperCase();
  }

  function formatTotalDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return '--:--';
    }

    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainingSeconds = total % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    }

    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  $: totalDuration = items.reduce((sum, item) => {
    const duration = item.metadata?.duration ?? 0;
    return Number.isFinite(duration) && duration > 0 ? sum + duration : sum;
  }, 0);

  $: trackSummary = `${items.length} song${items.length === 1 ? '' : 's'} · ${formatTotalDuration(totalDuration)}`;
</script>

<section class="panel playlist-panel">
  <div class="panel-header">
    <div class="panel-heading">
      <p class="eyebrow">Playlist</p>
      <p class="panel-summary">{trackSummary}</p>
    </div>
    <label class="add-files" aria-label="Add files" title="Add files">
      <span class="material-symbols-outlined" aria-hidden="true">add</span>
      <input type="file" multiple accept=".mp3,.wav,.flac,.ogg,.opus,.mod,.xm,.s3m,.it" on:change={handleInput} />
    </label>
  </div>

  <div class="dropzone" role="region" aria-label="Playlist dropzone" on:dragover|preventDefault on:drop={handleDrop}>
    {#if items.length === 0}
      <div class="empty-state">
        <p>Drop local audio or tracker modules here.</p>
        <p>Supported: MP3, WAV, FLAC, OGG, Opus, MOD, XM, S3M, IT.</p>
      </div>
    {:else}
      <ul class="track-list">
        {#each items as item}
          <li>
            <button
              class:active={item.id === activeId}
              type="button"
              on:click={() => dispatch('select', item.id)}
              title={item.name}
            >
              <span class="track-name">{truncateMiddle(item.name)}</span>
              <span class="track-meta">{formatTrackType(item)} {formatDuration(item.metadata?.duration ?? 0)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>
