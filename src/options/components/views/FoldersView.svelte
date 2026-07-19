<script lang="ts">
  import { onMount } from 'svelte';
  import { locale, t } from 'svelte-i18n';
  import OptionGlyphButton from '../OptionGlyphButton.svelte';
  import {
    filesystemFolders,
    getDroppedDirectoryHandles,
    type FilesystemFolder,
    type FilesystemFolderPermission
  } from '$lib/services/filesystem-folders';
  import { requestLibraryFolderScan } from '$lib/services/library-folder-coordination';

  type PickerWindow = Window & typeof globalThis & {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
  };

  const permissionIcons: Record<FilesystemFolderPermission, string> = {
    granted: 'check',
    prompt: 'key',
    denied: 'block',
    unavailable: 'link_off'
  };

  let dropActive = false;
  let busyIds = new Set<string>();

  function setBusy(id: string, busy: boolean) {
    busyIds = new Set(busy ? [...busyIds, id] : [...busyIds].filter((value) => value !== id));
  }

  function formatLastScan(folder: FilesystemFolder): string {
    if (folder.libraryMode === null) return '—';
    if (folder.lastScanStatus === 'scanning') return $t('options.folders.scan.scanning', { default: 'Scanning…' });
    if (folder.lastScanStatus === 'permission-required') return $t('options.folders.permission.required', { default: 'Permission required' });
    if (folder.lastScanStatus === 'error') {
      switch (folder.lastScanFailure) {
        case 'not-library-folder':
          return $t('options.folders.scan.notLibraryFolder', {
            default: 'Folder is no longer registered as a library folder.'
          });
        case 'cancelled':
          return $t('options.folders.scan.cancelled', {
            default: 'Folder scanning was cancelled because it is no longer a library folder.'
          });
        default:
          return $t('options.folders.scan.failed', { default: 'Scan failed' });
      }
    }
    if (!folder.lastScanAt) return $t('options.folders.scan.notScanned', { default: 'Not scanned' });

    return new Intl.DateTimeFormat($locale || undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(folder.lastScanAt);
  }

  function formatTrackCount(folder: FilesystemFolder): string {
    if (folder.libraryMode === null || folder.lastScanTrackCount === undefined) return '—';
    return new Intl.NumberFormat($locale || undefined).format(folder.lastScanTrackCount);
  }

  function permissionLabel(permission: FilesystemFolderPermission): string {
    if (permission === 'granted') return $t('options.folders.permission.available', { default: 'Available' });
    if (permission === 'prompt') return $t('options.folders.permission.required', { default: 'Permission required' });
    if (permission === 'denied') return $t('options.folders.permission.denied', { default: 'Access denied' });
    return $t('options.folders.permission.unavailable', { default: 'Unavailable' });
  }

  function libraryModeLabel(folder: FilesystemFolder): string {
    if (folder.libraryMode === 'launch') return $t('options.folders.library.scanOnLaunch', { default: 'Scan on launch' });
    if (folder.libraryMode === 'manual') return $t('options.folders.library.inLibrary', { default: 'In library' });
    return $t('options.folders.library.notInLibrary', { default: 'Not in library' });
  }

  function libraryModeIcon(folder: FilesystemFolder): string | null {
    if (folder.libraryMode === 'launch') return 'published_with_changes';
    if (folder.libraryMode === 'manual') return 'check';
    return null;
  }

  function queueScan(folder: FilesystemFolder) {
    if (folder.permission !== 'granted') return;
    requestLibraryFolderScan(folder.id);
  }

  async function browseFolder() {
    const pickerWindow = window as PickerWindow;
    if (!pickerWindow.showDirectoryPicker) return;

    try {
      const handle = await pickerWindow.showDirectoryPicker();
      await filesystemFolders.remember(handle);
    } catch {
      // Picker cancellation and unavailable handles leave the folder list unchanged.
    }
  }

  function handleWindowDragEnter(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer?.types.includes('Files')) dropActive = true;
  }

  function handleWindowDragOver(event: DragEvent) {
    event.preventDefault();
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.dataTransfer.dropEffect = 'copy';
    dropActive = true;
  }

  function handleWindowDragLeave(event: DragEvent) {
    if (event.relatedTarget === null) dropActive = false;
  }

  async function handleDrop(event: DragEvent) {
    event.preventDefault();
    dropActive = false;
    if (!event.dataTransfer) return;

    const handles = await getDroppedDirectoryHandles(event.dataTransfer);
    if (handles.length > 0) await filesystemFolders.rememberMany(handles);
  }

  async function addToLibrary(folder: FilesystemFolder) {
    setBusy(folder.id, true);
    try {
      await filesystemFolders.setLibraryMode(folder.id, 'manual');
      queueScan({ ...folder, libraryMode: 'manual' });
    } finally {
      setBusy(folder.id, false);
    }
  }

  async function toggleLaunchScan(folder: FilesystemFolder) {
    setBusy(folder.id, true);
    try {
      await filesystemFolders.setLibraryMode(
        folder.id,
        folder.libraryMode === 'launch' ? 'manual' : 'launch'
      );
    } finally {
      setBusy(folder.id, false);
    }
  }

  async function removeFromLibrary(folder: FilesystemFolder) {
    setBusy(folder.id, true);
    try {
      await filesystemFolders.setLibraryMode(folder.id, null);
    } finally {
      setBusy(folder.id, false);
    }
  }

  async function checkAccess(folder: FilesystemFolder) {
    setBusy(folder.id, true);
    try {
      await filesystemFolders.requestPermission(folder.id);
    } finally {
      setBusy(folder.id, false);
    }
  }

  async function forgetFolder(folder: FilesystemFolder) {
    setBusy(folder.id, true);
    try {
      await filesystemFolders.forget(folder.id);
    } finally {
      setBusy(folder.id, false);
    }
  }

  onMount(() => void filesystemFolders.refresh());
</script>

<svelte:window
  on:dragenter={handleWindowDragEnter}
  on:dragover={handleWindowDragOver}
  on:dragleave={handleWindowDragLeave}
  on:drop={handleDrop}
/>

<article class="view section">
  <div class="section-heading">
    <div>
      <h2>{$t('options.folders.heading', { default: 'Folders' })}</h2>
      <p class="field-hint">{$t('options.folders.description', { default: 'Every folder izci has remembered, including folders used for library scans.' })}</p>
    </div>
    <div class="page-actions">
      <OptionGlyphButton
        icon="refresh"
        label={$t('options.folders.actions.checkAllAccess', { default: 'Check all folder access' })}
        on:click={() => void filesystemFolders.refresh()}
      />
      <OptionGlyphButton icon="create_new_folder" label={$t('options.folders.actions.add', { default: 'Add folder' })} on:click={() => void browseFolder()} />
    </div>
  </div>

  <div
    class="folder-table-scroll"
    role="table"
    aria-label={$t('options.folders.table.label', { default: 'Known folders' })}
    aria-rowcount={$filesystemFolders.length + 1}
  >
    <div class="folder-table" role="rowgroup">
      <div class="folder-header" role="row">
        <span role="columnheader">{$t('options.folders.table.folder', { default: 'Folder' })}</span>
        <span class="access-heading" role="columnheader">{$t('options.folders.table.access', { default: 'Access' })}</span>
        <span class="library-heading" role="columnheader">{$t('options.folders.table.library', { default: 'Library' })}</span>
        <span role="columnheader">{$t('options.folders.table.lastScan', { default: 'Last scan' })}</span>
        <span class="tracks-heading" role="columnheader">{$t('options.folders.table.tracks', { default: 'Tracks' })}</span>
        <span class="actions-heading" role="columnheader">{$t('options.folders.table.actions', { default: 'Actions' })}</span>
      </div>

      {#if $filesystemFolders.length === 0}
        <div class="empty-row" role="row">
          <span class="material-symbols-outlined" aria-hidden="true">folder_off</span>
          <span role="cell">{$t('options.folders.empty', { default: 'No known folders. Add or drop one here.' })}</span>
        </div>
      {:else}
        {#each $filesystemFolders as folder, index (folder.id)}
          <div class="folder-row" role="row" aria-rowindex={index + 2}>
            <div class="folder-name" role="cell" title={folder.name}>
              <span class="material-symbols-outlined folder-icon" aria-hidden="true">
                {folder.libraryMode === null ? 'folder' : 'folder_special'}
              </span>
              <span>{folder.name}</span>
            </div>
            <div
              class="access-cell"
              role="cell"
              title={permissionLabel(folder.permission)}
              aria-label={permissionLabel(folder.permission)}
            >
              <span class="material-symbols-outlined" aria-hidden="true">
                {permissionIcons[folder.permission]}
              </span>
            </div>
            <span
              class="library-cell"
              role="cell"
              title={libraryModeLabel(folder)}
              aria-label={libraryModeLabel(folder)}
            >
              {#if libraryModeIcon(folder)}
                <span class="material-symbols-outlined" aria-hidden="true">
                  {libraryModeIcon(folder)}
                </span>
              {:else}
                <span aria-hidden="true">—</span>
              {/if}
            </span>
            <span
              class:status-error={folder.lastScanStatus === 'error' || folder.lastScanStatus === 'permission-required'}
              class="text-cell scan-cell"
              role="cell"
              title={formatLastScan(folder)}
            >
              {formatLastScan(folder)}
            </span>
            <span class="text-cell tracks-cell" role="cell" title={formatTrackCount(folder)}>
              {formatTrackCount(folder)}
            </span>
            <div class="row-actions" role="cell" aria-label={$t('options.folders.actions.forFolder', { default: 'Actions for {folder}', values: { folder: folder.name } })}>
              {#if folder.libraryMode === null}
                <OptionGlyphButton
                  icon="library_add"
                  label={$t('options.folders.actions.addToLibrary', { default: 'Add to library' })}
                  placement="above"
                  disabled={busyIds.has(folder.id)}
                  on:click={() => void addToLibrary(folder)}
                />
              {:else}
                <OptionGlyphButton
                  icon="sync"
                  label={folder.libraryMode === 'launch'
                    ? $t('options.folders.actions.disableScanOnLaunch', { default: 'Disable scan on launch' })
                    : $t('options.folders.actions.scanOnLaunch', { default: 'Scan on launch' })}
                  placement="above"
                  pressed={folder.libraryMode === 'launch'}
                  disabled={busyIds.has(folder.id)}
                  on:click={() => void toggleLaunchScan(folder)}
                />
                <OptionGlyphButton
                  icon="refresh"
                  label={$t('options.folders.actions.scanNow', { default: 'Scan now' })}
                  placement="above"
                  disabled={folder.lastScanStatus === 'scanning' || busyIds.has(folder.id)}
                  on:click={() => queueScan(folder)}
                />
                <OptionGlyphButton
                  icon="playlist_remove"
                  label={$t('options.folders.actions.removeFromLibrary', { default: 'Remove from library' })}
                  placement="above"
                  danger
                  disabled={busyIds.has(folder.id)}
                  on:click={() => void removeFromLibrary(folder)}
                />
              {/if}
              <OptionGlyphButton
                icon={folder.permission === 'granted' ? 'verified_user' : 'key'}
                label={$t('options.folders.actions.checkAccess', { default: 'Check access' })}
                placement="above"
                disabled={busyIds.has(folder.id)}
                on:click={() => void checkAccess(folder)}
              />
              <OptionGlyphButton
                icon="delete"
                label={$t('options.folders.actions.forget', { default: 'Forget folder' })}
                placement="above"
                danger
                disabled={busyIds.has(folder.id)}
                on:click={() => void forgetFolder(folder)}
              />
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <p class="field-hint page-hint">{$t('options.folders.retentionHint', { default: 'Forgetting a folder or removing it from the library keeps tracks already imported from it.' })}</p>
</article>

{#if dropActive}
  <div class="window-drop-overlay" aria-hidden="true">
    <span class="material-symbols-outlined">drive_file_move</span>
    <span>{$t('options.folders.dropToAdd', { default: 'Drop folders to add' })}</span>
  </div>
{/if}

<style>
  .section-heading {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 12px;
  }

  .section-heading h2 {
    margin-bottom: 3px;
  }

  .section-heading .field-hint,
  .page-hint {
    line-height: 1.4;
  }

  .page-actions,
  .row-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 1px;
  }

  .row-actions {
    opacity: 0;
    pointer-events: none;
    transition: opacity 55ms ease-out;
  }

  .folder-row:hover .row-actions,
  .folder-row:focus-within .row-actions {
    opacity: 1;
    pointer-events: auto;
  }

  .folder-table-scroll {
    margin-top: 8px;
    overflow-x: auto;
    border-top: 1px solid var(--border-faint);
    border-bottom: 1px solid var(--border-faint);
  }

  .folder-table {
    min-width: 500px;
    display: grid;
    grid-template-columns: minmax(100px, 1fr) max-content max-content max-content max-content max-content;
    column-gap: 7px;
    padding: 0 4px 0 7px;
  }

  .folder-header,
  .folder-row {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: subgrid;
    align-items: center;
  }

  .folder-header {
    min-height: 24px;
    border-bottom: 1px solid var(--border-soft);
    color: var(--muted);
    font-size: 0.66rem;
    font-weight: 600;
    letter-spacing: 0.03em;
  }

  .folder-row {
    min-height: 31px;
    border-bottom: 1px solid var(--border-faint);
  }

  .folder-row:last-child {
    border-bottom: 0;
  }

  .folder-row:hover,
  .folder-row:focus-within {
    background: var(--hover-surface);
  }

  .folder-name,
  .access-cell,
  .library-cell {
    min-width: 0;
    display: flex;
    align-items: center;
  }

  .folder-name > span:last-child,
  .text-cell {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .folder-name {
    gap: 5px;
    color: var(--text-strong);
    font-weight: 600;
  }

  .folder-icon {
    flex: 0 0 auto;
    color: var(--accent-strong);
    font-size: 17px;
  }

  .text-cell {
    color: var(--muted-strong);
    font-size: 0.69rem;
  }

  .access-cell,
  .library-cell {
    justify-content: center;
    color: var(--muted-strong);
  }

  .access-cell .material-symbols-outlined,
  .library-cell .material-symbols-outlined {
    font-size: 17px;
  }

  .scan-cell.status-error {
    color: #df8d72;
  }

  .access-heading,
  .library-heading {
    text-align: center;
  }

  .tracks-heading,
  .tracks-cell,
  .actions-heading {
    text-align: right;
  }

  .tracks-cell {
    font-variant-numeric: tabular-nums;
  }

  .empty-row {
    grid-column: 1 / -1;
    min-height: 38px;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 7px;
    color: var(--muted);
  }

  .empty-row .material-symbols-outlined {
    font-size: 17px;
  }

  .page-hint {
    margin-top: 7px;
  }

  .window-drop-overlay {
    position: fixed;
    z-index: 100;
    inset: 4px;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 8px;
    border: 2px dashed var(--accent);
    border-radius: 7px;
    background: color-mix(in srgb, var(--bg-base) 82%, transparent);
    color: var(--text-strong);
    font-weight: 600;
    pointer-events: none;
    backdrop-filter: blur(3px);
  }

  .window-drop-overlay .material-symbols-outlined {
    color: var(--accent-strong);
    font-size: 28px;
  }
</style>
