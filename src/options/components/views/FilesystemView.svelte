<script lang="ts">
  import { onMount } from 'svelte';
  import OptionGlyphButton from '../OptionGlyphButton.svelte';
  import {
    filesystemFolders,
    type FilesystemFolder,
    type FilesystemFolderPermission
  } from '$lib/services/filesystem-folders';

  let busyIds = new Set<string>();

  const permissionLabels: Record<FilesystemFolderPermission, string> = {
    granted: 'Available',
    prompt: 'Permission required',
    denied: 'Access denied',
    unavailable: 'Unavailable'
  };

  function setBusy(id: string, busy: boolean) {
    busyIds = new Set(busy ? [...busyIds, id] : [...busyIds].filter((value) => value !== id));
  }

  async function grantAccess(folder: FilesystemFolder) {
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

<article class="view">
  <div class="section">
    <div class="section-heading">
      <div>
        <h2>Known Folders</h2>
        <p class="field-hint">Folders opened or dropped into izci appear here when they can be remembered.</p>
      </div>
      <OptionGlyphButton icon="refresh" label="Check all folder access" on:click={() => void filesystemFolders.refresh()} />
    </div>

    <div class="folder-list">
      {#if $filesystemFolders.length === 0}
        <div class="empty-row">
          <span class="material-symbols-outlined" aria-hidden="true">folder_off</span>
          <span>No known folders</span>
        </div>
      {:else}
        {#each $filesystemFolders as folder (folder.id)}
          <div class="folder-row">
            <span class="material-symbols-outlined folder-icon" aria-hidden="true">folder</span>
            <div class="folder-copy">
              <strong>{folder.name}</strong>
              <span class:status-good={folder.permission === 'granted'} class:status-warn={folder.permission !== 'granted'}>
                {permissionLabels[folder.permission]}{folder.libraryMode ? ' · Library' : ''}
              </span>
            </div>
            <div class="row-actions">
              <OptionGlyphButton
                icon={folder.permission === 'granted' ? 'verified_user' : 'key'}
                label={folder.permission === 'granted' ? 'Check access' : 'Grant access'}
                placement="above"
                disabled={busyIds.has(folder.id)}
                on:click={() => void grantAccess(folder)}
              />
              <OptionGlyphButton
                icon="delete"
                label="Forget folder"
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

    <p class="field-hint page-hint">Forgetting stops future scans but keeps tracks already in the library.</p>
  </div>
</article>

<style>
  .section-heading { display: flex; align-items: start; justify-content: space-between; gap: 12px; }
  .section-heading h2 { margin-bottom: 3px; }
  .section-heading .field-hint, .page-hint { line-height: 1.4; }
  .folder-list { margin-top: 8px; border-top: 1px solid var(--border-faint); }
  .folder-row, .empty-row { min-height: 44px; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 5px 4px 5px 7px; border-bottom: 1px solid var(--border-faint); }
  .folder-row:hover, .folder-row:focus-within { background: var(--hover-surface); }
  .folder-icon { color: var(--accent-strong); font-size: 19px; }
  .folder-copy { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .folder-copy strong { overflow: hidden; color: var(--text-strong); text-overflow: ellipsis; white-space: nowrap; }
  .folder-copy span { color: var(--muted); font-size: .69rem; }
  .folder-copy .status-good { color: var(--success, #78ad86); }
  .folder-copy .status-warn { color: var(--warning, #d6a35c); }
  .row-actions { display: flex; align-items: center; gap: 1px; opacity: 0; pointer-events: none; transition: opacity 55ms ease-out; }
  .folder-row:hover .row-actions, .folder-row:focus-within .row-actions { opacity: 1; pointer-events: auto; }
  .empty-row { grid-template-columns: auto 1fr; color: var(--muted); }
  .empty-row .material-symbols-outlined { font-size: 19px; }
  .page-hint { margin-top: 7px; }
</style>
