<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { onDestroy } from 'svelte';
  import { tick } from 'svelte';
  import type { PlaylistRepeatMode } from '$lib/types';
  import { extractDroppedFiles, formatDuration, getTrackDisplayTitle } from '$lib/utils/files';
  import type { PlaylistItem } from '$lib/types';

  export let items: PlaylistItem[] = [];
  export let selectedIds: string[] = [];
  export let playingId: string | null = null;
  export let hideEyebrow = false;
  export let shuffleEnabled = false;
  export let repeatMode: PlaylistRepeatMode = 'off';

  const dispatch = createEventDispatcher<{
    addFiles: FileList | File[];
    openFiles: void;
    select: { id: string; range: boolean; toggle: boolean };
    play: string;
    remove: string[];
    toggleShuffle: void;
    cycleRepeat: void;
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
  let playlistHeaderCovered = false;

  async function handleDrop(event: DragEvent) {
    event.preventDefault();

    if (!event.dataTransfer) {
      return;
    }

    const files = await extractDroppedFiles(event.dataTransfer);

    if (files.length > 0) {
      dispatch('addFiles', files);
    }
  }

  function formatTrackType(item: PlaylistItem): string {
    return item.extension.toUpperCase();
  }

  function getTrackMeta(item: PlaylistItem): string {
    const duration = item.metadata?.duration ?? 0;
    const hasDuration = Number.isFinite(duration) && duration > 0;

    return hasDuration ? `${formatTrackType(item)} ${formatDuration(duration)}` : formatTrackType(item);
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

  function updatePlaylistHeaderState() {
    playlistHeaderCovered = (dropzoneElement?.scrollTop ?? 0) > 0;
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
  $: repeatIcon = repeatMode === 'one' ? 'repeat_one' : 'repeat';
  $: repeatLabel =
    repeatMode === 'one' ? 'Repeat current track' : repeatMode === 'all' ? 'Repeat playlist' : 'Repeat off';
  $: if (items) {
    tick().then(() => updatePlaylistHeaderState());
  }
</script>

<section class="panel playlist-panel">
  <div
    bind:this={dropzoneElement}
    class="dropzone playlist-dropzone"
    role="region"
    aria-label="Playlist dropzone"
    on:dragover|preventDefault
    on:drop={handleDrop}
    on:scroll={updatePlaylistHeaderState}
  >
    <div class="panel-header playlist-panel-header" class:is-covered={playlistHeaderCovered}>
      <div class="panel-heading">
        {#if !hideEyebrow}
          <p class="eyebrow">Playlist</p>
        {/if}
        <p class="panel-summary">{trackSummary}</p>
      </div>
      <div class="playlist-actions">
        <button
          type="button"
          class="playlist-action-button"
          class:active={shuffleEnabled}
          aria-label={shuffleEnabled ? 'Disable shuffle' : 'Enable shuffle'}
          title={shuffleEnabled ? 'Shuffle on' : 'Shuffle off'}
          on:click={() => dispatch('toggleShuffle')}
        >
          <span class="material-symbols-outlined" aria-hidden="true">shuffle</span>
        </button>
        <button
          type="button"
          class="playlist-action-button"
          class:active={repeatMode !== 'off'}
          aria-label={repeatLabel}
          title={repeatLabel}
          on:click={() => dispatch('cycleRepeat')}
        >
          <span class="material-symbols-outlined" aria-hidden="true">{repeatIcon}</span>
        </button>
        <button
          type="button"
          class="playlist-add-files"
          aria-label="Add files"
          title="Add files"
          on:click={() => dispatch('openFiles')}
        >
          <span class="material-symbols-outlined" aria-hidden="true">add</span>
        </button>
      </div>
    </div>

    {#if items.length > 0}
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
              title={getTrackDisplayTitle(item)}
            >
              <span class="track-name">{getTrackDisplayTitle(item)}</span>
              <span class="track-meta">{getTrackMeta(item)}</span>
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

<style>
  .playlist-actions {
    display: inline-flex;
    align-items: center;
    gap: 0.7rem;
  }

  .playlist-action-button,
  .playlist-add-files {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    background: transparent;
    border: 0;
    color: var(--muted);
    cursor: pointer;
    transition: color 180ms ease;
  }

  .playlist-action-button.active,
  .playlist-action-button:hover,
  .playlist-add-files:hover {
    color: var(--accent-strong);
  }

  .playlist-action-button .material-symbols-outlined,
  .playlist-add-files .material-symbols-outlined {
    font-size: 1.15rem;
    line-height: 1;
  }

</style>
