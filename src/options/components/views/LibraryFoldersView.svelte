<script lang="ts">
  import { onMount } from 'svelte';
  import OptionGlyphButton from '../OptionGlyphButton.svelte';
  import {
    filesystemFolders,
    getDroppedDirectoryHandles,
    type FilesystemFolder
  } from '$lib/services/filesystem-folders';
  import { requestLibraryFolderScan } from '$lib/services/library-folder-coordination';

  type PickerWindow = Window & typeof globalThis & {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  };

  let notice = '';
  let dropActive = false;
  let busyIds = new Set<string>();

  $: libraryFolders = $filesystemFolders.filter((folder) => folder.libraryMode !== null);
  $: availableFolders = $filesystemFolders.filter((folder) => folder.libraryMode === null);

  function setBusy(id: string, busy: boolean) {
    busyIds = new Set(busy ? [...busyIds, id] : [...busyIds].filter((value) => value !== id));
  }

  function formatLastScan(folder: FilesystemFolder): string {
    if (folder.lastScanStatus === 'scanning') return 'Scanning…';
    if (folder.lastScanStatus === 'permission-required') return 'Permission required';
    if (folder.lastScanStatus === 'error') return folder.lastScanMessage ?? 'Scan failed';
    if (!folder.lastScanAt) return 'Not scanned yet';
    const count = folder.lastScanTrackCount ?? 0;
    return `${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(folder.lastScanAt)} · ${count} track${count === 1 ? '' : 's'}`;
  }

  function queueScan(folder: FilesystemFolder) {
    if (folder.permission !== 'granted') {
      notice = `Grant access to ${folder.name} in Filesystem first.`;
      return;
    }
    notice = requestLibraryFolderScan(folder.id)
      ? `Scanning ${folder.name}…`
      : 'Open the main izci window to scan.';
  }

  async function addExisting(folder: FilesystemFolder) {
    setBusy(folder.id, true);
    try {
      await filesystemFolders.setLibraryMode(folder.id, 'manual');
      queueScan({ ...folder, libraryMode: 'manual' });
    } finally {
      setBusy(folder.id, false);
    }
  }

  async function registerLibraryFolder(handle: FileSystemDirectoryHandle) {
    const folder = await filesystemFolders.remember(handle, { libraryMode: 'manual' });
    queueScan(folder);
  }

  async function browseFolder() {
    const pickerWindow = window as PickerWindow;
    if (!pickerWindow.showDirectoryPicker) {
      notice = 'Folder browsing is unavailable in this window.';
      return;
    }

    try {
      const handle = await pickerWindow.showDirectoryPicker();
      await registerLibraryFolder(handle);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        notice = error instanceof Error ? error.message : 'The folder could not be added.';
      }
    }
  }

  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    dropActive = false;
    if (!event.dataTransfer) return;
    const handles = await getDroppedDirectoryHandles(event.dataTransfer);
    if (handles.length === 0) {
      notice = 'Drop folders here.';
      return;
    }
    for (const handle of handles) await registerLibraryFolder(handle);
  }

  function handleDragLeave(event: DragEvent) {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !(event.currentTarget as HTMLElement).contains(nextTarget)) {
      dropActive = false;
    }
  }

  async function toggleLaunchScan(folder: FilesystemFolder) {
    await filesystemFolders.setLibraryMode(
      folder.id,
      folder.libraryMode === 'launch' ? 'manual' : 'launch'
    );
  }

  async function removeLibraryFolder(folder: FilesystemFolder) {
    setBusy(folder.id, true);
    try {
      await filesystemFolders.setLibraryMode(folder.id, null);
      notice = `${folder.name} removed. Existing tracks were kept.`;
    } finally {
      setBusy(folder.id, false);
    }
  }

  onMount(() => void filesystemFolders.refresh());
</script>

<article class="view">
  <div class="section">
    <div class="section-heading">
      <div>
        <h2>Library Folders</h2>
        <p class="field-hint">Rescan folders manually or keep them in sync whenever izci launches.</p>
      </div>
      <OptionGlyphButton icon="create_new_folder" label="Add folder" on:click={() => void browseFolder()} />
    </div>

    <div
      class="folder-list"
      class:is-drop-active={dropActive}
      role="list"
      aria-label="Library folders"
      on:dragenter|preventDefault={() => (dropActive = true)}
      on:dragover|preventDefault
      on:dragleave={handleDragLeave}
      on:drop={handleDrop}
    >
      {#if libraryFolders.length === 0}
        <div class="empty-row" role="listitem">
          <span class="material-symbols-outlined" aria-hidden="true">drive_file_move</span>
          <span>Drop or add folders</span>
          <OptionGlyphButton icon="create_new_folder" label="Add folder" placement="above" on:click={() => void browseFolder()} />
        </div>
      {:else}
        {#each libraryFolders as folder (folder.id)}
          <div class="folder-row" role="listitem">
            <span class="material-symbols-outlined folder-icon" aria-hidden="true">folder_special</span>
            <div class="folder-copy">
              <strong>{folder.name}</strong>
              <span class:status-error={folder.lastScanStatus === 'error' || folder.lastScanStatus === 'permission-required'}>{formatLastScan(folder)}</span>
            </div>
            <div class="row-actions">
              <OptionGlyphButton
                icon="rocket_launch"
                label={folder.libraryMode === 'launch' ? 'Disable scan on launch' : 'Scan on launch'}
                placement="above"
                pressed={folder.libraryMode === 'launch'}
                disabled={busyIds.has(folder.id)}
                on:click={() => void toggleLaunchScan(folder)}
              />
              <OptionGlyphButton
                icon="refresh"
                label="Rescan folder"
                placement="above"
                disabled={folder.lastScanStatus === 'scanning' || busyIds.has(folder.id)}
                on:click={() => queueScan(folder)}
              />
              <OptionGlyphButton
                icon="playlist_remove"
                label="Remove library folder"
                placement="above"
                danger
                disabled={busyIds.has(folder.id)}
                on:click={() => void removeLibraryFolder(folder)}
              />
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  {#if availableFolders.length > 0}
    <div class="section">
      <div class="section-heading">
        <div>
          <h2>Available From Filesystem</h2>
          <p class="field-hint">Folders izci already knows about can be added without browsing again.</p>
        </div>
      </div>
      <div class="available-list" role="list">
        {#each availableFolders as folder (folder.id)}
          <div class="available-row" role="listitem">
            <span class="material-symbols-outlined folder-icon" aria-hidden="true">folder</span>
            <div class="folder-copy">
              <strong>{folder.name}</strong>
              <span>{folder.permission === 'granted' ? 'Available' : 'Permission required'}</span>
            </div>
            <div class="row-actions">
              <OptionGlyphButton
                icon="library_add"
                label="Add to library folders"
                placement="above"
                disabled={busyIds.has(folder.id)}
                on:click={() => void addExisting(folder)}
              />
            </div>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  {#if notice}
    <p class="notice" aria-live="polite">{notice}</p>
  {/if}
</article>

<style>
  .section-heading { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
  .section-heading h2 { margin-bottom: 3px; }
  .section-heading .field-hint { line-height: 1.4; }
  .folder-list, .available-list { margin-top: 8px; border-top: 1px solid var(--border-faint); transition: background 60ms ease-out, box-shadow 60ms ease-out; }
  .folder-list.is-drop-active { background: var(--selection-strong); box-shadow: inset 0 0 0 1px var(--accent); }
  .folder-row, .available-row, .empty-row { min-height: 44px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 5px 4px 5px 7px; border-bottom: 1px solid var(--border-faint); }
  .folder-row:hover, .folder-row:focus-within, .available-row:hover, .available-row:focus-within { background: var(--hover-surface); }
  .folder-icon { color: var(--accent-strong); font-size: 19px; }
  .folder-copy { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .folder-copy strong { overflow: hidden; color: var(--text-strong); text-overflow: ellipsis; white-space: nowrap; }
  .folder-copy span { color: var(--muted); font-size: .69rem; }
  .folder-copy span.status-error { color: #df8d72; }
  .row-actions { display: flex; align-items: center; gap: 1px; opacity: 0; pointer-events: none; transition: opacity 55ms ease-out; }
  .folder-row:hover .row-actions, .folder-row:focus-within .row-actions, .available-row:hover .row-actions, .available-row:focus-within .row-actions { opacity: 1; pointer-events: auto; }
  .empty-row { color: var(--muted); }
  .empty-row > .material-symbols-outlined { font-size: 19px; }
  .notice { margin: 10px 0 0; padding: 5px 7px; border-left: 2px solid var(--accent); color: var(--muted-strong); font-size: .72rem; }
</style>
