<script lang="ts">
  import { locale, t } from 'svelte-i18n';
  import type { BackupRestoreResult } from '$lib/services/backups';
  import { BACKUP_FILE_EXTENSION } from '$lib/services/backup-coordination';
  import { backupCoordinator } from '$lib/services/browser-backup-client';
  import { createOpenFilePickerOptions } from '$lib/services/import-controller';

  export let onOpenFolders: () => void;

  type PickerWindow = Window & typeof globalThis & {
    showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
  };

  let importInput: HTMLInputElement | null = null;
  let busy = false;
  let restoreResult: BackupRestoreResult | null = null;
  let status: 'idle' | 'created' | 'restored' | 'located' | 'mismatch' | 'invalid' | 'unsupported' | 'failed' = 'idle';

  $: looseTrackCount =
    $backupCoordinator.tracks.filter((track) => !track.sourceFolderId).length +
    $backupCoordinator.favorites.filter((track) => !track.sourceFolderId).length;
  $: pendingFolderTrackCount =
    $backupCoordinator.tracks.filter((track) => Boolean(track.sourceFolderId)).length +
    $backupCoordinator.favorites.filter((track) => Boolean(track.sourceFolderId)).length;
  $: hasPendingRestore =
    $backupCoordinator.folders.length > 0 ||
    $backupCoordinator.tracks.length > 0 ||
    $backupCoordinator.favorites.length > 0;

  async function createBackup() {
    busy = true;
    status = 'idle';
    try {
      const backup = await backupCoordinator.createBackup();
      const url = URL.createObjectURL(backup.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = backup.fileName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      status = 'created';
    } catch {
      status = 'failed';
    } finally {
      busy = false;
    }
  }

  function chooseBackup() {
    importInput?.click();
  }

  async function handleBackupSelected(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    busy = true;
    restoreResult = null;
    status = 'idle';
    try {
      restoreResult = await backupCoordinator.restoreBackup(file);
      status = 'restored';
    } catch (error) {
      status = error instanceof Error && error.message === 'unsupported-version'
        ? 'unsupported'
        : error instanceof Error && error.message === 'invalid-backup'
          ? 'invalid'
          : 'failed';
    } finally {
      busy = false;
    }
  }

  async function locateLooseFiles() {
    const pickerWindow = window as PickerWindow;
    if (!pickerWindow.showOpenFilePicker) {
      status = 'failed';
      return;
    }
    busy = true;
    status = 'idle';
    try {
      const handles = await pickerWindow.showOpenFilePicker(
        createOpenFilePickerOptions($t('options.backups.locateFilesDescription', { default: 'Original library files' }))
      );
      const result = await backupCoordinator.locateFiles(handles);
      status = result.status === 'success' ? 'located' : 'mismatch';
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) status = 'failed';
    } finally {
      busy = false;
    }
  }

  function formatBackupDate(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return value;
    return new Intl.DateTimeFormat($locale || undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date);
  }
</script>

<article class="view section backup-view">
  <h2>{$t('options.backups.heading', { default: 'Backups' })}</h2>
  <p class="backup-intro">
    {$t('options.backups.description', { default: 'Move izci settings and library data between app origins or keep a portable copy on disk.' })}
  </p>

  <div class="backup-actions">
    <button class="backup-button primary" type="button" disabled={busy} on:click={() => void createBackup()}>
      <span class="material-symbols-outlined" aria-hidden="true">archive</span>
      {$t('options.backups.actions.create', { default: 'Create backup…' })}
    </button>
    <button class="backup-button" type="button" disabled={busy} on:click={chooseBackup}>
      <span class="material-symbols-outlined" aria-hidden="true">unarchive</span>
      {$t('options.backups.actions.restore', { default: 'Restore backup…' })}
    </button>
    <input
      class="backup-file-input"
      bind:this={importInput}
      type="file"
      accept={BACKUP_FILE_EXTENSION}
      on:change={(event) => void handleBackupSelected(event)}
    />
  </div>

  {#if status !== 'idle'}
    <div class:error={status === 'invalid' || status === 'unsupported' || status === 'failed' || status === 'mismatch'} class="backup-status" role="status">
      <span class="material-symbols-outlined" aria-hidden="true">
        {status === 'invalid' || status === 'unsupported' || status === 'failed' || status === 'mismatch' ? 'error' : 'check_circle'}
      </span>
      <span>
        {#if status === 'created'}
          {$t('options.backups.status.created', { default: 'Backup created.' })}
        {:else if status === 'restored' && restoreResult}
          {$t('options.backups.status.restored', {
            default: 'Backup restored. {matched} tracks were matched immediately; {pending} still need their original location.',
            values: { matched: restoreResult.tracksMatched, pending: restoreResult.tracksPending }
          })}
        {:else if status === 'located'}
          {$t('options.backups.status.located', { default: 'Located files were restored to the library.' })}
        {:else if status === 'mismatch'}
          {$t('options.backups.status.mismatch', { default: 'None of the selected files matched the pending library tracks.' })}
        {:else if status === 'unsupported'}
          {$t('options.backups.status.unsupported', { default: 'This backup was created with an unsupported backup format.' })}
        {:else if status === 'invalid'}
          {$t('options.backups.status.invalid', { default: 'This is not a valid izci backup.' })}
        {:else}
          {$t('options.backups.status.failed', { default: 'The backup operation failed.' })}
        {/if}
      </span>
    </div>
  {/if}

  {#if hasPendingRestore}
    <section class="restore-card" aria-labelledby="pending-restore-heading">
      <div class="restore-card-heading">
        <div>
          <h3 id="pending-restore-heading">{$t('options.backups.pending.heading', { default: 'Files still needed' })}</h3>
          {#if $backupCoordinator.createdAt}
            <p>
              {$t('options.backups.pending.from', {
                default: 'Backup from {origin}, created {date}',
                values: {
                  origin: $backupCoordinator.sourceOrigin || '—',
                  date: formatBackupDate($backupCoordinator.createdAt)
                }
              })}
            </p>
          {/if}
        </div>
      </div>

      {#if $backupCoordinator.folders.length > 0}
        <div class="restore-row">
          <span class="material-symbols-outlined" aria-hidden="true">folder_off</span>
          <span class="restore-copy">
            <strong>{$t('options.backups.pending.folders', {
              default: '{folders} folders · {tracks} tracks',
              values: { folders: $backupCoordinator.folders.length, tracks: pendingFolderTrackCount }
            })}</strong>
            <small>{$t('options.backups.pending.foldersHint', { default: 'Open Folders and use Locate… for each missing root.' })}</small>
          </span>
          <button class="backup-button compact" type="button" on:click={onOpenFolders}>
            {$t('options.backups.actions.openFolders', { default: 'Open Folders' })}
          </button>
        </div>
      {/if}

      {#if looseTrackCount > 0}
        <div class="restore-row">
          <span class="material-symbols-outlined" aria-hidden="true">audio_file</span>
          <span class="restore-copy">
            <strong>{$t('options.backups.pending.looseFiles', {
              default: '{tracks} loose library files',
              values: { tracks: looseTrackCount }
            })}</strong>
            <small>{$t('options.backups.pending.looseFilesHint', { default: 'Select the original files so izci can restore their handles.' })}</small>
          </span>
          <button class="backup-button compact" type="button" disabled={busy} on:click={() => void locateLooseFiles()}>
            {$t('options.backups.actions.locate', { default: 'Locate…' })}
          </button>
        </div>
      {/if}
    </section>
  {/if}

  <section class="backup-contents">
    <h3>{$t('options.backups.contents.heading', { default: 'What is included' })}</h3>
    <p>{$t('options.backups.contents.included', { default: 'User-facing options, workspace settings, Raf presets, loadouts, library tracks and metadata, favorites, folder descriptors, play counts, and remembered playback positions.' })}</p>
    <h3>{$t('options.backups.contents.excludedHeading', { default: 'Not included' })}</h3>
    <p>{$t('options.backups.contents.excluded', { default: 'Media files, file and directory handles, artwork cache, lyrics, live meters, pattern snapshots, object URLs, temporary window state, update timestamps, and cross-window coordination state.' })}</p>
    <p class="privacy-note">
      <span class="material-symbols-outlined" aria-hidden="true">lock_open</span>
      {$t('options.backups.contents.privacy', { default: 'Backups are not encrypted. They can contain filenames, paths, metadata, favorites, and listening progress.' })}
    </p>
  </section>
</article>

<style>
  .backup-view {
    max-width: 760px;
  }

  .backup-intro,
  .backup-contents p {
    margin: 0;
    color: var(--muted-strong);
    line-height: 1.45;
  }

  .backup-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 12px;
  }

  .backup-button {
    min-height: 29px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 4px 10px;
    border: 1px solid var(--menu-bar-border);
    border-radius: 6px;
    background: var(--bg-input);
    color: var(--text);
  }

  .backup-button:hover:not(:disabled) {
    background: var(--hover-surface);
    color: var(--text-strong);
  }

  .backup-button.primary {
    border-color: color-mix(in srgb, var(--accent-strong) 52%, var(--menu-bar-border));
    background: color-mix(in srgb, var(--accent) 17%, var(--bg-input));
  }

  .backup-button.compact {
    min-height: 25px;
    padding: 3px 8px;
    white-space: nowrap;
  }

  .backup-button:disabled {
    opacity: 0.5;
  }

  .backup-file-input {
    display: none;
  }

  .backup-status {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: 10px;
    padding: 7px 9px;
    border: 1px solid color-mix(in srgb, var(--accent) 38%, var(--border-faint));
    border-radius: 6px;
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    color: var(--text-strong);
  }

  .backup-status.error {
    border-color: rgba(205, 93, 73, 0.45);
    color: #df8d72;
  }

  .backup-status .material-symbols-outlined {
    flex: 0 0 auto;
    font-size: 18px;
  }

  .restore-card {
    margin-top: 14px;
    border: 1px solid var(--border-soft);
    border-radius: 7px;
    background: color-mix(in srgb, var(--bg-input) 76%, transparent);
    overflow: hidden;
  }

  .restore-card-heading {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border-faint);
  }

  .restore-card h3,
  .backup-contents h3 {
    margin: 0;
    color: var(--text-strong);
    font-size: 0.78rem;
  }

  .restore-card-heading p {
    margin: 2px 0 0;
    color: var(--muted);
    font-size: 0.69rem;
  }

  .restore-row {
    min-height: 42px;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 6px 9px;
    border-bottom: 1px solid var(--border-faint);
  }

  .restore-row:last-child {
    border-bottom: 0;
  }

  .restore-row > .material-symbols-outlined {
    color: var(--muted);
    font-size: 19px;
  }

  .restore-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .restore-copy strong {
    color: var(--text-strong);
    font-size: 0.76rem;
  }

  .restore-copy small {
    color: var(--muted);
    font-size: 0.68rem;
  }

  .backup-contents {
    margin-top: 18px;
    padding-top: 10px;
    border-top: 1px solid var(--border-faint);
  }

  .backup-contents h3 + p {
    margin-top: 4px;
  }

  .backup-contents p + h3 {
    margin-top: 12px;
  }

  .backup-contents .privacy-note {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin-top: 12px;
    color: var(--muted);
    font-size: 0.7rem;
  }

  .privacy-note .material-symbols-outlined {
    margin-top: 1px;
    font-size: 16px;
  }
</style>
