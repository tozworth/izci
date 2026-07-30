<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import { STREAM_EXTENSIONS } from '$lib/types';
  import { inferExtension } from '$lib/utils/files';
  import { listenForCurrentToolTrack } from '$lib/services/tool-track-context';
  import {
    analyzeLoudness,
    computeIntegratedLoudness,
    DEFAULT_REPLAYGAIN_TARGET_LUFS,
    replayGainForLoudness,
    type LoudnessAnalysis
  } from './loudness-analyzer';
  import { writeReplayGainInPlace } from './replaygain-writer';
  import LoudnessMenuBar from './LoudnessMenuBar.svelte';

  type RowState = 'ready' | 'analyzing' | 'analyzed' | 'writing' | 'written' | 'error';
  type AlbumGrouping = 'tags' | 'folder' | 'all' | 'none';

  interface LoudnessRow {
    id: string;
    file: File;
    handle: FileSystemFileHandle | null;
    path: string;
    selected: boolean;
    state: RowState;
    progress: number | null;
    analysis: LoudnessAnalysis | null;
    albumIntegratedLufs: number | null;
    albumPeak: number | null;
    error: string;
  }

  const ACCEPTED_EXTENSIONS = STREAM_EXTENSIONS.map((extension) => `.${extension}`);
  const OPEN_FILE_PICKER_OPTIONS: OpenFilePickerOptions = {
    multiple: true,
    types: [{
      description: 'Audio files',
      accept: {
        'audio/mpeg': ['.mp3'],
        'audio/wav': ['.wav'],
        'audio/flac': ['.flac'],
        'audio/ogg': ['.ogg', '.opus'],
        'audio/opus': ['.opus']
      }
    }]
  };

  let fileInput: HTMLInputElement;
  let rows: LoudnessRow[] = [];
  let targetLufs = DEFAULT_REPLAYGAIN_TARGET_LUFS;
  let albumGrouping: AlbumGrouping = 'tags';
  let parallelism = 1;
  let busy = false;
  let dragActive = false;
  let message = '';
  let errorMessage = '';
  let abortController: AbortController | null = null;

  $: selectedRows = rows.filter((row) => row.selected);
  $: analyzedSelectedRows = selectedRows.filter((row) => row.analysis && row.state !== 'analyzing');
  $: writableSelectedRows = analyzedSelectedRows.filter((row) => row.handle);
  $: allSelected = rows.length > 0 && rows.every((row) => row.selected);
  $: fileSummary = rows.length === 1
    ? rows[0].file.name
    : rows.length > 1 ? `${rows.length} ${$t('loudness.files', { default: 'files' })}` : '';
  $: effectiveTargetLufs = Number.isFinite(targetLufs)
    ? Math.min(-5, Math.max(-30, targetLufs))
    : DEFAULT_REPLAYGAIN_TARGET_LUFS;

  function makeRow(file: File, handle: FileSystemFileHandle | null, path: string): LoudnessRow {
    return {
      id: `${path}\u0000${file.size}\u0000${file.lastModified}`,
      file,
      handle,
      path,
      selected: true,
      state: 'ready',
      progress: null,
      analysis: null,
      albumIntegratedLufs: null,
      albumPeak: null,
      error: ''
    };
  }

  function isAccepted(file: File): boolean {
    return ACCEPTED_EXTENSIONS.includes(`.${inferExtension(file.name)}`);
  }

  function addRows(nextRows: LoudnessRow[], silent = false): void {
    const known = new Set(rows.map((row) => row.id));
    const accepted = nextRows.filter((row) => isAccepted(row.file) && !known.has(row.id));
    rows = [...rows, ...accepted];
    if (accepted.length > 0 || !silent) {
      message = accepted.length > 0
        ? ''
        : $t('loudness.noNewFiles', { default: 'No new supported audio files were found.' });
    }
    errorMessage = '';
  }

  onMount(() => listenForCurrentToolTrack((track) => {
    if (track.kind !== 'stream' || !isAccepted(track.file)) return;
    addRows([
      makeRow(track.file, track.fileHandle ?? null, track.path || track.file.name)
    ], true);
  }));

  async function rowsFromHandles(handles: FileSystemFileHandle[]): Promise<LoudnessRow[]> {
    return await Promise.all(handles.map(async (handle) => makeRow(await handle.getFile(), handle, handle.name)));
  }

  async function readDirectory(
    directory: FileSystemDirectoryHandle,
    path = directory.name
  ): Promise<LoudnessRow[]> {
    const found: LoudnessRow[] = [];
    for await (const entry of directory.values()) {
      if (entry.kind === 'file') {
        const handle = entry as FileSystemFileHandle;
        found.push(makeRow(await handle.getFile(), handle, `${path}/${handle.name}`));
      } else {
        const child = entry as FileSystemDirectoryHandle;
        found.push(...await readDirectory(child, `${path}/${child.name}`));
      }
    }
    return found;
  }

  async function chooseFiles(): Promise<void> {
    const pickerWindow = window as Window & {
      showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
    };
    if (!pickerWindow.showOpenFilePicker) {
      fileInput.click();
      return;
    }
    try {
      addRows(await rowsFromHandles(await pickerWindow.showOpenFilePicker(OPEN_FILE_PICKER_OPTIONS)));
    } catch (error) {
      handleOperationError(error);
    }
  }

  async function chooseFolder(): Promise<void> {
    const pickerWindow = window as Window & {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    };
    if (!pickerWindow.showDirectoryPicker) {
      errorMessage = $t('loudness.folderPickerUnavailable', {
        default: 'Folder access is unavailable here. Use Add files instead.'
      });
      return;
    }
    try {
      const directory = await pickerWindow.showDirectoryPicker();
      addRows(await readDirectory(directory));
    } catch (error) {
      handleOperationError(error);
    }
  }

  function handleFileInput(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    addRows(files.map((file) => makeRow(file, null, file.webkitRelativePath || file.name)));
  }

  async function handleDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    dragActive = false;
    const nextRows: LoudnessRow[] = [];
    for (const item of Array.from(event.dataTransfer?.items ?? [])) {
      try {
        const handle = await item.getAsFileSystemHandle?.();
        if (handle?.kind === 'file') {
          const fileHandle = handle as FileSystemFileHandle;
          nextRows.push(makeRow(await fileHandle.getFile(), fileHandle, fileHandle.name));
        } else if (handle?.kind === 'directory') {
          nextRows.push(...await readDirectory(handle as FileSystemDirectoryHandle));
        }
      } catch {
        // Fall through to the FileList for browsers with partial handle support.
      }
    }
    if (nextRows.length === 0) {
      nextRows.push(...Array.from(event.dataTransfer?.files ?? []).map((file) => makeRow(file, null, file.name)));
    }
    addRows(nextRows);
  }

  function updateRow(id: string, update: Partial<LoudnessRow>): void {
    rows = rows.map((row) => row.id === id ? { ...row, ...update } : row);
  }

  function removeSelected(): void {
    rows = rows.filter((row) => !row.selected);
    recomputeAlbums();
  }

  function setAllSelected(selected: boolean): void {
    rows = rows.map((row) => ({ ...row, selected }));
  }

  function folderOf(path: string): string {
    const separator = path.lastIndexOf('/');
    return separator >= 0 ? path.slice(0, separator) : '';
  }

  function albumKey(row: LoudnessRow): string | null {
    if (!row.analysis || albumGrouping === 'none') return null;
    if (albumGrouping === 'all') return 'all';
    const folder = folderOf(row.path);
    if (albumGrouping === 'folder') return folder || 'picked-files';
    const album = row.analysis.album?.toLocaleLowerCase();
    const albumArtist = row.analysis.albumArtist?.toLocaleLowerCase();
    return album ? `tags:${albumArtist ?? ''}\u0000${album}` : folder ? `folder:${folder}` : `track:${row.id}`;
  }

  function recomputeAlbums(): void {
    const groups = new Map<string, LoudnessRow[]>();
    for (const row of rows) {
      const key = albumKey(row);
      if (!key) continue;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    const values = new Map<string, { loudness: number; peak: number }>();
    for (const [key, group] of groups) {
      values.set(key, {
        loudness: computeIntegratedLoudness(group.flatMap((row) => row.analysis?.blockEnergies ?? [])),
        peak: Math.max(...group.map((row) => row.analysis?.samplePeak ?? 0))
      });
    }
    rows = rows.map((row) => {
      const key = albumKey(row);
      const album = key ? values.get(key) : null;
      return {
        ...row,
        albumIntegratedLufs: album?.loudness ?? null,
        albumPeak: album?.peak ?? null
      };
    });
  }

  function handleGroupingChange(event: Event): void {
    albumGrouping = (event.currentTarget as HTMLSelectElement).value as AlbumGrouping;
    recomputeAlbums();
  }

  async function analyzeSelected(): Promise<void> {
    const queued = rows.filter((row) => row.selected);
    if (queued.length === 0 || busy) return;
    busy = true;
    message = '';
    errorMessage = '';
    abortController = new AbortController();
    let cursor = 0;
    const worker = async () => {
      while (cursor < queued.length && !abortController?.signal.aborted) {
        const row = queued[cursor++];
        updateRow(row.id, {
          state: 'analyzing',
          progress: 0,
          analysis: null,
          albumIntegratedLufs: null,
          albumPeak: null,
          error: ''
        });
        try {
          const analysis = await analyzeLoudness(row.file, {
            signal: abortController?.signal,
            onProgress: ({ seconds, duration }) => updateRow(row.id, {
              progress: duration && duration > 0 ? Math.min(1, seconds / duration) : null
            })
          });
          updateRow(row.id, { state: 'analyzed', progress: 1, analysis });
        } catch (error) {
          if ((error as DOMException)?.name === 'AbortError') {
            updateRow(row.id, { state: 'ready', progress: null });
          } else {
            updateRow(row.id, {
              state: 'error',
              progress: null,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      }
    };
    const analyzerCount = Math.min(
      queued.length,
      Math.min(4, Math.max(1, Math.round(Number(parallelism) || 1)))
    );
    await Promise.all(Array.from({ length: analyzerCount }, worker));
    const wasCancelled = abortController.signal.aborted;
    abortController = null;
    busy = false;
    recomputeAlbums();
    message = wasCancelled
      ? $t('loudness.cancelled', { default: 'Analysis cancelled.' })
      : $t('loudness.analysisComplete', { default: 'Analysis complete.' });
  }

  function stopAnalysis(): void {
    abortController?.abort();
  }

  async function writeSelected(): Promise<void> {
    const queued = rows.filter((row) => row.selected && row.analysis && row.handle);
    if (queued.length === 0 || busy) return;
    busy = true;
    message = '';
    errorMessage = '';
    let written = 0;
    for (const row of queued) {
      if (!row.analysis || !row.handle) continue;
      updateRow(row.id, { state: 'writing', error: '' });
      try {
        await writeReplayGainInPlace(row.handle, {
          trackGainDb: replayGainForLoudness(row.analysis.integratedLufs, effectiveTargetLufs),
          trackPeak: row.analysis.samplePeak,
          albumGainDb: row.albumIntegratedLufs === null
            ? undefined
            : replayGainForLoudness(row.albumIntegratedLufs, effectiveTargetLufs),
          albumPeak: row.albumPeak ?? undefined
        });
        written += 1;
        updateRow(row.id, { state: 'written' });
      } catch (error) {
        updateRow(row.id, {
          state: 'error',
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    busy = false;
    message = $t('loudness.writeComplete', {
      default: 'Wrote ReplayGain tags to {count} files.',
      values: { count: written }
    });
  }

  function handleOperationError(error: unknown): void {
    if ((error as DOMException)?.name === 'AbortError') return;
    errorMessage = error instanceof Error ? error.message : String(error);
  }

  function formatLoudness(value: number | null | undefined): string {
    if (value === null || value === undefined) return '—';
    return Number.isFinite(value) ? `${value.toFixed(2)} LUFS` : '−∞ LUFS';
  }

  function formatGain(row: LoudnessRow): string {
    if (!row.analysis || !Number.isFinite(row.analysis.integratedLufs)) return '—';
    const gain = replayGainForLoudness(row.analysis.integratedLufs, effectiveTargetLufs);
    return `${gain >= 0 ? '+' : ''}${gain.toFixed(2)} dB`;
  }

  function formatPeak(value: number | undefined): string {
    if (value === undefined) return '—';
    return Number.isFinite(value) ? `${value.toFixed(2)} dBFS` : '−∞ dBFS';
  }

  function statusText(row: LoudnessRow): string {
    if (row.error) return row.error;
    switch (row.state) {
      case 'ready': return row.handle
        ? $t('loudness.status.ready', { default: 'Ready' })
        : $t('loudness.status.readOnly', { default: 'Analyze only' });
      case 'analyzing': return row.progress === null
        ? $t('loudness.status.analyzing', { default: 'Analyzing...' })
        : $t('loudness.status.analyzingPercent', {
            default: 'Analyzing {percent}%', values: { percent: Math.round(row.progress * 100) }
          });
      case 'analyzed': return $t('loudness.status.analyzed', { default: 'Analyzed' });
      case 'writing': return $t('loudness.status.writing', { default: 'Writing...' });
      case 'written': return $t('loudness.status.written', { default: 'Tagged' });
      case 'error': return $t('loudness.status.error', { default: 'Failed' });
    }
  }
</script>

<svelte:head><title>{fileSummary ? `${fileSummary} — Loudness` : 'izci Loudness'}</title></svelte:head>

<div
  role="region"
  aria-label={$t('loudness.title', { default: 'Loudness' })}
  class:drag-active={dragActive}
  class="tool-shell loudness-shell"
  on:dragenter|preventDefault={() => dragActive = true}
  on:dragover|preventDefault={() => dragActive = true}
  on:dragleave={(event) => { if (event.currentTarget === event.target) dragActive = false; }}
  on:drop={handleDrop}
>
  <div class="window-frame-safe-strip" aria-hidden="true"></div>
  <LoudnessMenuBar
    {fileSummary}
    canAnalyze={!busy && selectedRows.length > 0}
    canWrite={!busy && writableSelectedRows.length > 0}
    canRemove={!busy && selectedRows.length > 0}
    canSelect={!busy && rows.length > 0}
    analyzing={Boolean(abortController)}
    {busy}
    on:addFiles={() => void chooseFiles()}
    on:addFolder={() => void chooseFolder()}
    on:write={() => void writeSelected()}
    on:close={() => window.close()}
    on:selectAll={() => setAllSelected(true)}
    on:selectNone={() => setAllSelected(false)}
    on:removeSelected={removeSelected}
    on:analyze={() => void analyzeSelected()}
    on:stop={stopAnalysis}
  />

  <div class="tool-row tool-toolbar loudness-toolbar" role="toolbar" aria-label={$t('loudness.toolbar', { default: 'Loudness tools' })}>
    <div class="toolbar-group">
      <button class="icon-button hover-tooltip-anchor" type="button" on:click={chooseFiles} disabled={busy} aria-label={$t('loudness.addFiles', { default: 'Add files...' })}>
        <span class="material-symbols-outlined" aria-hidden="true">audio_file</span>
        <HoverTooltip>{$t('loudness.addFiles', { default: 'Add files...' })}</HoverTooltip>
      </button>
      <button class="icon-button hover-tooltip-anchor" type="button" on:click={chooseFolder} disabled={busy} aria-label={$t('loudness.addFolder', { default: 'Add folder...' })}>
        <span class="material-symbols-outlined" aria-hidden="true">create_new_folder</span>
        <HoverTooltip>{$t('loudness.addFolder', { default: 'Add folder...' })}</HoverTooltip>
      </button>
    </div>
    <span class="toolbar-separator" aria-hidden="true"></span>
    <button class="text-button primary" type="button" on:click={analyzeSelected} disabled={busy || selectedRows.length === 0}>
      <span class="material-symbols-outlined" aria-hidden="true">query_stats</span>
      {$t('loudness.analyzeSelected', { default: 'Analyze selected' })}
    </button>
    {#if abortController}
      <button class="icon-button danger hover-tooltip-anchor" type="button" on:click={stopAnalysis} aria-label={$t('loudness.stop', { default: 'Stop' })}>
        <span class="material-symbols-outlined" aria-hidden="true">stop_circle</span>
        <HoverTooltip>{$t('loudness.stop', { default: 'Stop' })}</HoverTooltip>
      </button>
    {/if}
    <button class="text-button" type="button" on:click={writeSelected} disabled={busy || writableSelectedRows.length === 0}>
      <span class="material-symbols-outlined" aria-hidden="true">save</span>
      {$t('loudness.writeSelected', { default: 'Write tags in-place' })}
    </button>
    <div class="toolbar-spacer"></div>
    <label class="compact-control">
      <span>{$t('loudness.targetShort', { default: 'Target' })}</span>
      <input bind:value={targetLufs} type="number" min="-30" max="-5" step="0.5" disabled={busy} />
      <span>LUFS</span>
    </label>
    <label class="sr-only" for="album-grouping">{$t('loudness.albumGrouping', { default: 'Album grouping' })}</label>
    <select id="album-grouping" class="grouping-select" value={albumGrouping} on:change={handleGroupingChange} disabled={busy} aria-label={$t('loudness.albumGrouping', { default: 'Album grouping' })}>
        <option value="tags">{$t('loudness.group.tags', { default: 'Album tags, then folder' })}</option>
        <option value="folder">{$t('loudness.group.folder', { default: 'Containing folder' })}</option>
        <option value="all">{$t('loudness.group.all', { default: 'All analyzed files' })}</option>
        <option value="none">{$t('loudness.group.none', { default: 'Track gain only' })}</option>
    </select>
    <label class="compact-control analyzers-control">
      <span>{$t('loudness.parallelShort', { default: 'Jobs' })}</span>
      <input bind:value={parallelism} type="number" min="1" max="4" step="1" disabled={busy} />
    </label>
    <span class="toolbar-separator" aria-hidden="true"></span>
    <button class="icon-button hover-tooltip-anchor" type="button" on:click={removeSelected} disabled={busy || selectedRows.length === 0} aria-label={$t('loudness.removeSelected', { default: 'Remove selected' })}>
      <span class="material-symbols-outlined" aria-hidden="true">remove</span>
      <HoverTooltip align="left">{$t('loudness.removeSelected', { default: 'Remove selected' })}</HoverTooltip>
    </button>
  </div>

  <main>
    <div class="table-header" role="row">
      <label class="check-cell" title={$t('loudness.selectAll', { default: 'Select all' })}>
        <input type="checkbox" checked={allSelected} on:change={() => setAllSelected(!allSelected)} />
      </label>
      <span>{$t('loudness.file', { default: 'File' })}</span>
      <span>{$t('loudness.integrated', { default: 'Integrated' })}</span>
      <span>{$t('loudness.peak', { default: 'Sample peak' })}</span>
      <span>{$t('loudness.trackGain', { default: 'Track gain' })}</span>
      <span>{$t('loudness.albumGain', { default: 'Album gain' })}</span>
      <span>{$t('loudness.status.label', { default: 'Status' })}</span>
    </div>
    <div class="table-body">
      {#each rows as row (row.id)}
        <div class:error={row.state === 'error'} class="result-row" role="row">
          <label class="check-cell"><input type="checkbox" bind:checked={row.selected} disabled={busy} /></label>
          <div class="file-cell" title={row.path}>
            <strong>{row.file.name}</strong>
            <span>{row.path}</span>
          </div>
          <span>{formatLoudness(row.analysis?.integratedLufs)}</span>
          <span>{formatPeak(row.analysis?.samplePeakDbfs)}</span>
          <span class:clipping={Boolean(row.analysis && row.analysis.samplePeak * (10 ** (replayGainForLoudness(row.analysis.integratedLufs, effectiveTargetLufs) / 20)) > 1)}>
            {formatGain(row)}
          </span>
          <span>{row.albumIntegratedLufs === null ? '—' : `${replayGainForLoudness(row.albumIntegratedLufs, effectiveTargetLufs) >= 0 ? '+' : ''}${replayGainForLoudness(row.albumIntegratedLufs, effectiveTargetLufs).toFixed(2)} dB`}</span>
          <div class="status-cell" title={statusText(row)}>
            {#if row.state === 'analyzing' && row.progress !== null}<progress max="1" value={row.progress}></progress>{/if}
            <span>{statusText(row)}</span>
          </div>
        </div>
      {:else}
        <div class="empty-state">
          <button class="tool-empty-state empty-drop-target" type="button" on:click={() => void chooseFiles()}>
            <span class="material-symbols-outlined" aria-hidden="true">audio_file</span>
            <strong>{$t('loudness.empty', { default: 'Add audio' })}</strong>
            <span>{$t('loudness.emptyHint', { default: 'or drop files and folders here' })}</span>
          </button>
        </div>
      {/each}
    </div>
  </main>

  <footer class="tool-status-bar" class:error={Boolean(errorMessage)}>
    {#if errorMessage || message || busy}<span class="material-symbols-outlined">{errorMessage ? 'error' : busy ? 'progress_activity' : 'info'}</span>{/if}
    <span>{errorMessage || message}</span>
    <span class="summary">{rows.length} {$t('loudness.files', { default: 'files' })} · {analyzedSelectedRows.length} {$t('loudness.analyzedCount', { default: 'analyzed' })}</span>
  </footer>

  {#if dragActive}<div class="tool-drop-overlay">{$t('loudness.drop', { default: 'Drop audio files or folders' })}</div>{/if}
  <input bind:this={fileInput} class="hidden-input" type="file" multiple accept={ACCEPTED_EXTENSIONS.join(',')} on:change={handleFileInput} />
</div>
