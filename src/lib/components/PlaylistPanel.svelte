<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { onDestroy } from 'svelte';
  import { tick } from 'svelte';
  import { formatDuration, stripFileExtension, truncateMiddle } from '$lib/utils/files';
  import type { PlaylistItem } from '$lib/types';

  export let items: PlaylistItem[] = [];
  export let selectedIds: string[] = [];
  export let playingId: string | null = null;

  const dispatch = createEventDispatcher<{
    addFiles: FileList | File[];
    select: { id: string; range: boolean; toggle: boolean };
    play: string;
    remove: string[];
  }>();

  let contextMenu:
    | {
        x: number;
        y: number;
        ids: string[];
      }
    | null = null;
  let contextMenuElement: HTMLDivElement | null = null;
  let dropzoneElement: HTMLDivElement | null = null;

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

  function isToggleSelection(event: MouseEvent): boolean {
    return event.ctrlKey || event.metaKey;
  }

  function emitSelection(event: MouseEvent, id: string) {
    dispatch('select', {
      id,
      range: event.shiftKey,
      toggle: isToggleSelection(event)
    });
  }

  function handleItemClick(event: MouseEvent, id: string) {
    emitSelection(event, id);
    closeContextMenu();
  }

  function handleItemDoubleClick(id: string) {
    dispatch('play', id);
  }

  function closeContextMenu() {
    contextMenu = null;
  }

  async function handleItemContextMenu(event: MouseEvent, id: string) {
    event.preventDefault();

    if (!dropzoneElement) {
      return;
    }

    const itemIsSelected = selectedIds.includes(id);
    const bounds = dropzoneElement.getBoundingClientRect();

    if (!itemIsSelected) {
      dispatch('select', {
        id,
        range: false,
        toggle: false
      });
    }

    contextMenu = {
      x: event.clientX - bounds.left + dropzoneElement.scrollLeft,
      y: event.clientY - bounds.top + dropzoneElement.scrollTop,
      ids: itemIsSelected ? selectedIds : [id]
    };

    await tick();
    clampContextMenu();
  }

  function handleRemoveSelection() {
    if (!contextMenu) {
      return;
    }

    dispatch('remove', contextMenu.ids);
    closeContextMenu();
  }

  function handleWindowPointerDown(event: PointerEvent) {
    if (!contextMenu) {
      return;
    }

    const target = event.target;

    if (target instanceof Node && contextMenuElement?.contains(target)) {
      return;
    }

    closeContextMenu();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      closeContextMenu();
    }
  }

  function clampContextMenu() {
    if (!contextMenu || !contextMenuElement || !dropzoneElement) {
      return;
    }

    const padding = 8;
    const minX = dropzoneElement.scrollLeft + padding;
    const minY = dropzoneElement.scrollTop + padding;
    const maxX = dropzoneElement.scrollLeft + dropzoneElement.clientWidth - contextMenuElement.offsetWidth - padding;
    const maxY = dropzoneElement.scrollTop + dropzoneElement.clientHeight - contextMenuElement.offsetHeight - padding;

    contextMenu = {
      ...contextMenu,
      x: Math.max(minX, Math.min(contextMenu.x, maxX)),
      y: Math.max(minY, Math.min(contextMenu.y, maxY))
    };
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', handleWindowPointerDown);
    window.addEventListener('keydown', handleWindowKeydown);
    window.addEventListener('scroll', closeContextMenu, true);
    window.addEventListener('blur', closeContextMenu);
    window.addEventListener('resize', closeContextMenu);
  }

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', handleWindowPointerDown);
      window.removeEventListener('keydown', handleWindowKeydown);
      window.removeEventListener('scroll', closeContextMenu, true);
      window.removeEventListener('blur', closeContextMenu);
      window.removeEventListener('resize', closeContextMenu);
    }
  });

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

  <div
    bind:this={dropzoneElement}
    class="dropzone"
    role="region"
    aria-label="Playlist dropzone"
    on:dragover|preventDefault
    on:drop={handleDrop}
  >
    {#if items.length === 0}
      <div class="empty-state">
        <p>Drop local audio or tracker modules here.</p>
        <p>Supported: MP3, WAV, FLAC, OGG, Opus, MOD, XM, S3M, IT.</p>
      </div>
    {:else}
      <ul class="track-list">
        {#each items as item}
          <li class:selected={selectedIds.includes(item.id)} class:playing={item.id === playingId}>
            <button
              class="track-row"
              type="button"
              aria-current={item.id === playingId ? 'true' : undefined}
              on:click={(event) => handleItemClick(event, item.id)}
              on:dblclick={() => handleItemDoubleClick(item.id)}
              on:contextmenu={(event) => handleItemContextMenu(event, item.id)}
              title={stripFileExtension(item.name)}
            >
              <span class="track-name">{truncateMiddle(stripFileExtension(item.name))}</span>
              <span class="track-meta">{formatTrackType(item)} {formatDuration(item.metadata?.duration ?? 0)}</span>
            </button>
          </li>
        {/each}
      </ul>

      {#if contextMenu}
        <div
          bind:this={contextMenuElement}
          class="playlist-context-menu"
          role="menu"
          aria-label="Playlist item actions"
          style={`left: ${contextMenu.x}px; top: ${contextMenu.y}px;`}
        >
          <button type="button" role="menuitem" on:click={handleRemoveSelection}>Remove</button>
        </div>
      {/if}
    {/if}
  </div>
</section>
