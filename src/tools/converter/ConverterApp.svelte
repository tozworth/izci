<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import { MODULE_EXTENSIONS, STREAM_EXTENSIONS, VIDEO_EXTENSIONS, type MenuActionItem } from '$lib/types';
  import { listenForCurrentToolTrack } from '$lib/services/tool-track-context';
  import { inferExtension } from '$lib/utils/files';
  import ConverterMenuBar from './ConverterMenuBar.svelte';
  import {
    COMPRESSED_AUDIO_CODECS,
    CONVERTER_FORMATS,
    changeConverterFormat,
    getConverterFormat,
    getEffectiveAudioCodec,
    getEffectiveVideoCodec,
    normalizeConverterSettings,
    outputFileName,
    type ConverterAudioCodec,
    type ConverterChannels,
    type ConverterFormatDefinition,
    type ConverterFormatId,
    type ConverterFrameRate,
    type ConverterPcmFormat,
    type ConverterSampleRate,
    type ConverterSettings,
    type ConverterVideoSize
  } from './converter-options';
  import { loadConverterSettings, saveConverterSettings } from './converter-settings';
  import {
    convertMediaFile,
    detectConverterCapabilities,
    runConcurrent,
    type ConverterCapabilities,
    type ConverterProgress
  } from './converter-engine';
  import {
    converterOutputExists,
    converterOutputKey,
    resolveConverterOutputLocation,
    writeConverterOutput
  } from './converter-output';
  import type { AudioCodec, VideoCodec } from 'mediabunny';

  type RowState = 'ready' | 'queued' | 'rendering' | 'converting' | 'done' | 'skipped' | 'cancelled' | 'error';

  interface ConverterRow {
    id: string;
    file: File;
    handle: FileSystemFileHandle | null;
    path: string;
    outputDirectories: string[];
    selected: boolean;
    state: RowState;
    progress: number | null;
    outputSize: number | null;
    detail: string;
  }

  const ACCEPTED_EXTENSIONS = [...STREAM_EXTENSIONS, ...MODULE_EXTENSIONS, ...VIDEO_EXTENSIONS];
  const FILE_ACCEPT = ACCEPTED_EXTENSIONS.map((extension) => `.${extension}`).join(',');
  const OPEN_FILE_PICKER_OPTIONS: OpenFilePickerOptions = {
    multiple: true,
    types: [{
      description: 'Media files',
      accept: {
        'audio/*': [...STREAM_EXTENSIONS, ...MODULE_EXTENSIONS].map((extension) => `.${extension}`),
        'video/*': VIDEO_EXTENSIONS.map((extension) => `.${extension}`)
      }
    }]
  };
  const AUDIO_CODEC_LABELS: Record<string, string> = {
    aac: 'AAC', opus: 'Opus', mp3: 'MP3', vorbis: 'Vorbis', flac: 'FLAC', ac3: 'AC-3', eac3: 'E-AC-3', none: 'No audio'
  };
  const VIDEO_CODEC_LABELS: Record<VideoCodec, string> = {
    avc: 'H.264 / AVC', hevc: 'H.265 / HEVC', vp9: 'VP9', av1: 'AV1', vp8: 'VP8', prores: 'Apple ProRes'
  };

  let fileInput: HTMLInputElement;
  let rows: ConverterRow[] = [];
  let settings = loadConverterSettings();
  let outputDirectory: FileSystemDirectoryHandle | null = null;
  let capabilities: ConverterCapabilities | null = null;
  let busy = false;
  let dragActive = false;
  let message = '';
  let errorMessage = '';
  let abortController: AbortController | null = null;
  let contextMenuRowId: string | null = null;
  let contextMenuX = 0;
  let contextMenuY = 0;

  $: selectedRows = rows.filter((row) => row.selected);
  $: allSelected = rows.length > 0 && rows.every((row) => row.selected);
  $: finishedRows = rows.filter((row) => ['done', 'skipped', 'cancelled', 'error'].includes(row.state));
  $: format = getConverterFormat(settings.format);
  $: effectiveAudioCodec = getEffectiveAudioCodec(settings);
  $: effectiveVideoCodec = getEffectiveVideoCodec(settings);
  $: isLossyAudio = effectiveAudioCodec !== 'none' && COMPRESSED_AUDIO_CODECS.includes(effectiveAudioCodec);
  $: chosenCodecsAvailable = isAudioCodecAvailable(effectiveAudioCodec)
    && (!effectiveVideoCodec || isVideoCodecAvailable(effectiveVideoCodec));
  $: canStart = !busy && Boolean(outputDirectory) && selectedRows.length > 0 && chosenCodecsAvailable;
  $: fileSummary = rows.length === 1
    ? rows[0].file.name
    : rows.length > 1 ? `${rows.length} ${$t('converter.files', { default: 'files' })}` : '';
  $: contextMenuItems = contextMenuRowId ? buildRowContextMenu() : [];

  onMount(() => {
    void detectConverterCapabilities().then((value) => {
      capabilities = value;
    }).catch(() => {
      capabilities = { audio: {}, video: {} };
    });
    return listenForCurrentToolTrack((track) => {
      if (!isAccepted(track.file)) return;
      addRows([makeRow(track.file, track.fileHandle ?? null, track.path || track.file.name, [])], true);
    });
  });

  function makeRow(
    file: File,
    handle: FileSystemFileHandle | null,
    path: string,
    outputDirectories: string[]
  ): ConverterRow {
    return {
      id: `${path}\u0000${file.size}\u0000${file.lastModified}`,
      file,
      handle,
      path,
      outputDirectories,
      selected: true,
      state: 'ready',
      progress: null,
      outputSize: null,
      detail: ''
    };
  }

  function isAccepted(file: File): boolean {
    return ACCEPTED_EXTENSIONS.includes(inferExtension(file.name) as (typeof ACCEPTED_EXTENSIONS)[number]);
  }

  function addRows(nextRows: ConverterRow[], silent = false): void {
    const known = new Set(rows.map((row) => row.id));
    const accepted = nextRows.filter((row) => isAccepted(row.file) && !known.has(row.id));
    rows = [...rows, ...accepted];
    if (accepted.length > 0 || !silent) {
      message = accepted.length > 0 ? '' : $t('converter.noNewFiles', { default: 'No new supported media files were found.' });
    }
    errorMessage = '';
  }

  async function rowsFromHandles(handles: FileSystemFileHandle[]): Promise<ConverterRow[]> {
    return await Promise.all(handles.map(async (handle) => makeRow(await handle.getFile(), handle, handle.name, [])));
  }

  async function readDirectory(
    directory: FileSystemDirectoryHandle,
    path = directory.name,
    outputDirectories: string[] = []
  ): Promise<ConverterRow[]> {
    const found: ConverterRow[] = [];
    for await (const entry of directory.values()) {
      if (entry.kind === 'file') {
        const handle = entry as FileSystemFileHandle;
        found.push(makeRow(await handle.getFile(), handle, `${path}/${handle.name}`, outputDirectories));
      } else {
        const child = entry as FileSystemDirectoryHandle;
        found.push(...await readDirectory(child, `${path}/${child.name}`, [...outputDirectories, child.name]));
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
      showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
    };
    if (!pickerWindow.showDirectoryPicker) {
      errorMessage = $t('converter.folderPickerUnavailable', { default: 'Folder access is unavailable here. Use Add files instead.' });
      return;
    }
    try {
      const directory = await pickerWindow.showDirectoryPicker({ mode: 'read' });
      addRows(await readDirectory(directory));
    } catch (error) {
      handleOperationError(error);
    }
  }

  async function chooseOutput(): Promise<void> {
    const pickerWindow = window as Window & {
      showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
    };
    if (!pickerWindow.showDirectoryPicker) {
      errorMessage = $t('converter.outputPickerUnavailable', { default: 'Writable folder access is required for bulk conversion.' });
      return;
    }
    try {
      outputDirectory = await pickerWindow.showDirectoryPicker({ mode: 'readwrite' });
      message = $t('converter.outputChosen', { default: 'Output folder: {name}', values: { name: outputDirectory.name } });
      errorMessage = '';
    } catch (error) {
      handleOperationError(error);
    }
  }

  function handleFileInput(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    addRows(files.map((file) => makeRow(file, null, file.webkitRelativePath || file.name, [])));
  }

  async function handleDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    dragActive = false;
    const nextRows: ConverterRow[] = [];
    for (const item of Array.from(event.dataTransfer?.items ?? [])) {
      try {
        const handle = await item.getAsFileSystemHandle?.();
        if (handle?.kind === 'file') {
          const fileHandle = handle as FileSystemFileHandle;
          nextRows.push(makeRow(await fileHandle.getFile(), fileHandle, fileHandle.name, []));
        } else if (handle?.kind === 'directory') {
          nextRows.push(...await readDirectory(handle as FileSystemDirectoryHandle));
        }
      } catch {
        // Fall through to the FileList when handles are only partially supported.
      }
    }
    if (nextRows.length === 0) {
      nextRows.push(...Array.from(event.dataTransfer?.files ?? []).map((file) =>
        makeRow(file, null, file.webkitRelativePath || file.name, [])
      ));
    }
    addRows(nextRows);
  }

  function handleOperationError(error: unknown): void {
    if ((error as DOMException)?.name === 'AbortError') return;
    errorMessage = error instanceof Error ? error.message : $t('converter.operationFailed', { default: 'The operation failed.' });
  }

  function updateRow(id: string, update: Partial<ConverterRow>): void {
    rows = rows.map((row) => row.id === id ? { ...row, ...update } : row);
  }

  function updateSetting<K extends keyof ConverterSettings>(key: K, value: ConverterSettings[K]): void {
    settings = normalizeConverterSettings({ ...settings, [key]: value });
    saveConverterSettings(settings);
  }

  function updateFormat(id: ConverterFormatId): void {
    settings = changeConverterFormat(settings, id);
    saveConverterSettings(settings);
  }

  function removeSelected(): void {
    if (busy) return;
    rows = rows.filter((row) => !row.selected);
  }

  function clearFinished(): void {
    if (busy) return;
    rows = rows.filter((row) => !['done', 'skipped', 'cancelled', 'error'].includes(row.state));
  }

  function setAllSelected(selected: boolean): void {
    rows = rows.map((row) => ({ ...row, selected }));
  }

  function buildRowContextMenu(): MenuActionItem[] {
    const row = rows.find((candidate) => candidate.id === contextMenuRowId);
    return [
      {
        id: 'start',
        label: $t('converter.start', { default: 'Convert selected' }),
        icon: 'sync_alt',
        shortcut: 'Ctrl+S',
        disabled: !canStart
      },
      {
        id: 'stop',
        label: $t('converter.stop', { default: 'Stop' }),
        icon: 'stop_circle',
        disabled: !busy
      },
      {
        id: 'chooseOutput',
        label: $t('converter.chooseOutput', { default: 'Choose output folder...' }),
        icon: 'drive_file_move',
        disabled: busy,
        separatorBefore: true
      },
      {
        id: 'toggleRow',
        label: $t('converter.selectFile', {
          default: 'Select {name}',
          values: { name: row?.file.name ?? '' }
        }),
        icon: 'description',
        checked: Boolean(row?.selected),
        disabled: busy
      },
      {
        id: 'selectAll',
        label: $t('converter.selectAll', { default: 'Select all' }),
        icon: 'select_all',
        shortcut: 'Ctrl+A',
        disabled: busy || rows.length === 0
      },
      {
        id: 'selectNone',
        label: $t('converter.menu.selectNone', { default: 'Select none' }),
        icon: 'deselect',
        disabled: busy || rows.length === 0
      },
      {
        id: 'removeSelected',
        label: $t('converter.removeSelected', { default: 'Remove selected' }),
        icon: 'remove',
        disabled: busy || selectedRows.length === 0,
        separatorBefore: true
      },
      {
        id: 'clearFinished',
        label: $t('converter.clearFinished', { default: 'Clear finished' }),
        icon: 'filter_alt_off',
        disabled: busy || finishedRows.length === 0
      }
    ];
  }

  function openRowContextMenu(event: MouseEvent, row: ConverterRow): void {
    if (!busy && !row.selected) {
      rows = rows.map((candidate) => ({ ...candidate, selected: candidate.id === row.id }));
    }
    contextMenuRowId = row.id;
    contextMenuX = event.clientX;
    contextMenuY = event.clientY;
  }

  function runRowContextAction(action: string): void {
    const rowId = contextMenuRowId;
    contextMenuRowId = null;
    if (action === 'start') void startConversion();
    else if (action === 'stop') stopConversion();
    else if (action === 'chooseOutput') void chooseOutput();
    else if (action === 'toggleRow' && rowId && !busy) {
      rows = rows.map((row) => row.id === rowId ? { ...row, selected: !row.selected } : row);
    } else if (action === 'selectAll') setAllSelected(true);
    else if (action === 'selectNone') setAllSelected(false);
    else if (action === 'removeSelected') removeSelected();
    else if (action === 'clearFinished') clearFinished();
  }

  function outputDirectoriesFor(row: ConverterRow, snapshot: ConverterSettings): string[] {
    return snapshot.preserveFolders ? row.outputDirectories : [];
  }

  async function startConversion(): Promise<void> {
    const root = outputDirectory;
    if (!root || !canStart) return;
    const snapshot = { ...settings };
    const selected = rows.filter((row) => row.selected);
    const selectedIds = new Set(selected.map((row) => row.id));
    const reservedTargets = new Set<string>();
    const queued: ConverterRow[] = [];
    for (const row of selected) {
      const directories = outputDirectoriesFor(row, snapshot);
      const fileName = outputFileName(row.file.name, snapshot);
      const key = converterOutputKey(directories, fileName);
      if (reservedTargets.has(key)) {
        updateRow(row.id, {
          state: snapshot.skipExisting ? 'skipped' : 'error',
          progress: null,
          detail: $t('converter.duplicateTarget', { default: 'Another queued file has the same output path.' })
        });
        continue;
      }
      reservedTargets.add(key);
      queued.push(row);
      updateRow(row.id, { state: 'queued', progress: 0, outputSize: null, detail: '' });
    }
    if (queued.length === 0) return;

    busy = true;
    errorMessage = '';
    message = $t('converter.convertingCount', { default: 'Converting {count} files...', values: { count: queued.length } });
    abortController = new AbortController();
    const { signal } = abortController;

    await runConcurrent(queued, snapshot.parallelism, signal, async (row) => {
      try {
        const directories = outputDirectoriesFor(row, snapshot);
        const fileName = outputFileName(row.file.name, snapshot);
        const location = await resolveConverterOutputLocation(root, directories, fileName);
        if (snapshot.skipExisting && await converterOutputExists(location)) {
          updateRow(row.id, {
            state: 'skipped',
            progress: null,
            detail: $t('converter.exists', { default: 'Already exists' })
          });
          return;
        }
        updateRow(row.id, { state: 'converting', progress: 0, detail: '' });
        const blob = await convertMediaFile(row.file, snapshot, signal, (progress) => updateProgress(row.id, progress));
        if (signal.aborted) throw new DOMException('Conversion cancelled.', 'AbortError');
        await writeConverterOutput(location, blob);
        updateRow(row.id, { state: 'done', progress: 1, outputSize: blob.size, detail: fileName });
      } catch (error) {
        updateRow(row.id, (error as DOMException)?.name === 'AbortError'
          ? { state: 'cancelled', progress: null, detail: $t('converter.cancelled', { default: 'Cancelled' }) }
          : {
              state: 'error',
              progress: null,
              detail: error instanceof Error ? error.message : $t('converter.failed', { default: 'Conversion failed' })
            });
      }
    });

    rows = rows.map((row) => row.state === 'queued'
      ? { ...row, state: 'cancelled', progress: null, detail: $t('converter.cancelled', { default: 'Cancelled' }) }
      : row);
    const completed = rows.filter((row) => selectedIds.has(row.id) && row.state === 'done').length;
    const skipped = rows.filter((row) => selectedIds.has(row.id) && row.state === 'skipped').length;
    const failed = rows.filter((row) => selectedIds.has(row.id) && row.state === 'error').length;
    message = signal.aborted
      ? $t('converter.batchCancelled', { default: 'Conversion stopped.' })
      : $t('converter.batchComplete', {
          default: '{done} converted · {skipped} skipped · {failed} failed',
          values: { done: completed, skipped, failed }
        });
    busy = false;
    abortController = null;
  }

  function updateProgress(id: string, progress: ConverterProgress): void {
    updateRow(id, {
      state: progress.phase,
      progress: progress.progress,
      detail: progress.phase === 'rendering'
        ? $t('converter.renderingModule', { default: 'Rendering module' })
        : ''
    });
  }

  function stopConversion(): void {
    abortController?.abort();
  }

  function isAudioCodecAvailable(codec: ConverterAudioCodec): boolean {
    if (codec === 'none' || codec.startsWith('pcm-')) return true;
    return capabilities?.audio[codec] !== false;
  }

  function isVideoCodecAvailable(codec: VideoCodec): boolean {
    return capabilities?.video[codec] !== false;
  }

  function isFormatAvailable(candidate: ConverterFormatDefinition): boolean {
    if (!candidate.fixedAudioCodec || candidate.fixedAudioCodec.startsWith('pcm-')) return true;
    return isAudioCodecAvailable(candidate.fixedAudioCodec);
  }

  function stateLabel(row: ConverterRow): string {
    switch (row.state) {
      case 'ready': return $t('converter.status.ready', { default: 'Ready' });
      case 'queued': return $t('converter.status.queued', { default: 'Queued' });
      case 'rendering': return $t('converter.status.rendering', { default: 'Rendering...' });
      case 'converting': return row.progress === null
        ? $t('converter.status.converting', { default: 'Converting...' })
        : $t('converter.status.convertingPercent', { default: 'Converting {percent}%', values: { percent: Math.round(row.progress * 100) } });
      case 'done': return $t('converter.status.done', { default: 'Done' });
      case 'skipped': return $t('converter.status.skipped', { default: 'Skipped' });
      case 'cancelled': return $t('converter.status.cancelled', { default: 'Cancelled' });
      case 'error': return $t('converter.status.error', { default: 'Failed' });
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  }

  function numberFromEvent(event: Event): number {
    return Number((event.currentTarget as HTMLInputElement).value);
  }
</script>

<svelte:head><title>izci Converter</title></svelte:head>

<svelte:window
  on:dragenter={(event) => { event.preventDefault(); if (!busy) dragActive = true; }}
  on:dragover={(event) => event.preventDefault()}
  on:dragleave={(event) => { if (event.relatedTarget === null) dragActive = false; }}
  on:drop={(event) => { if (!busy) void handleDrop(event); }}
/>

<div class="window-frame-safe-strip" aria-hidden="true"></div>
<div class="tool-shell converter-shell" aria-label={$t('converter.title', { default: 'Converter' })}>
  <ConverterMenuBar
    {fileSummary}
    {busy}
    {canStart}
    canRemove={!busy && selectedRows.length > 0}
    canSelect={rows.length > 0}
    canClearFinished={!busy && finishedRows.length > 0}
    on:addFiles={() => void chooseFiles()}
    on:addFolder={() => void chooseFolder()}
    on:chooseOutput={() => void chooseOutput()}
    on:close={() => window.close()}
    on:selectAll={() => setAllSelected(true)}
    on:selectNone={() => setAllSelected(false)}
    on:removeSelected={removeSelected}
    on:clearFinished={clearFinished}
    on:start={() => void startConversion()}
    on:stop={stopConversion}
  />

  <input bind:this={fileInput} class="hidden-input" type="file" multiple accept={FILE_ACCEPT} on:change={handleFileInput} />

  <div class="tool-toolbar converter-toolbar" role="toolbar" aria-label={$t('converter.toolbar', { default: 'Converter tools' })}>
    <div class="toolbar-group">
      <button class="icon-button hover-tooltip-anchor" type="button" on:click={chooseFiles} disabled={busy} aria-label={$t('converter.addFiles', { default: 'Add files...' })}>
        <span class="material-symbols-outlined" aria-hidden="true">note_add</span><HoverTooltip>{$t('converter.addFiles', { default: 'Add files...' })}</HoverTooltip>
      </button>
      <button class="icon-button hover-tooltip-anchor" type="button" on:click={chooseFolder} disabled={busy} aria-label={$t('converter.addFolder', { default: 'Add folder...' })}>
        <span class="material-symbols-outlined" aria-hidden="true">create_new_folder</span><HoverTooltip>{$t('converter.addFolder', { default: 'Add folder...' })}</HoverTooltip>
      </button>
    </div>
    <span class="toolbar-separator"></span>
    <button class="text-button output-button" type="button" on:click={chooseOutput} disabled={busy}>
      <span class="material-symbols-outlined" aria-hidden="true">drive_file_move</span>
      <span>{outputDirectory?.name ?? $t('converter.chooseOutputShort', { default: 'Output folder...' })}</span>
    </button>
    <span class="toolbar-separator"></span>
    <button class="text-button primary" type="button" on:click={startConversion} disabled={!canStart}>
      <span class="material-symbols-outlined" aria-hidden="true">sync_alt</span>{$t('converter.start', { default: 'Convert selected' })}
    </button>
    {#if busy}
      <button class="icon-button danger hover-tooltip-anchor" type="button" on:click={stopConversion} aria-label={$t('converter.stop', { default: 'Stop' })}>
        <span class="material-symbols-outlined" aria-hidden="true">stop_circle</span><HoverTooltip>{$t('converter.stop', { default: 'Stop' })}</HoverTooltip>
      </button>
    {/if}
    <span class="toolbar-spacer"></span>
    <label class="compact-control jobs-control">
      <span>{$t('converter.parallelJobs', { default: 'Parallel jobs' })}</span>
      <input type="number" min="1" max="8" step="1" value={settings.parallelism} disabled={busy} on:change={(event) => updateSetting('parallelism', numberFromEvent(event))} />
    </label>
    <button class="icon-button hover-tooltip-anchor" type="button" on:click={removeSelected} disabled={busy || selectedRows.length === 0} aria-label={$t('converter.removeSelected', { default: 'Remove selected' })}>
      <span class="material-symbols-outlined" aria-hidden="true">remove</span><HoverTooltip align="left">{$t('converter.removeSelected', { default: 'Remove selected' })}</HoverTooltip>
    </button>
  </div>

  <main>
    <section class="queue-panel" aria-label={$t('converter.queue', { default: 'Conversion queue' })}>
      <div class="table-header" aria-hidden="true">
        <label class="check-cell" title={$t('converter.selectAll', { default: 'Select all' })}><input type="checkbox" checked={allSelected} on:change={(event) => setAllSelected((event.currentTarget as HTMLInputElement).checked)} /></label>
        <span>{$t('converter.file', { default: 'File' })}</span>
        <span>{$t('converter.input', { default: 'Input' })}</span>
        <span>{$t('converter.output', { default: 'Output' })}</span>
        <span>{$t('converter.status.label', { default: 'Status' })}</span>
      </div>
      <div class="table-body">
        {#if rows.length === 0}
          <div class="empty-state">
            <button class="tool-empty-state empty-drop-target" type="button" on:click={chooseFiles}>
              <span class="material-symbols-outlined" aria-hidden="true">sync_alt</span>
              <strong>{$t('converter.empty', { default: 'Add media to convert' })}</strong>
              <span>{$t('converter.emptyHint', { default: 'or drop files and folders here' })}</span>
            </button>
          </div>
        {:else}
          {#each rows as row (row.id)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class:error={row.state === 'error'}
              class:finished={row.state === 'done'}
              class="result-row"
              on:contextmenu|preventDefault={(event) => openRowContextMenu(event, row)}
            >
              <label class="check-cell"><input type="checkbox" bind:checked={row.selected} disabled={busy} aria-label={$t('converter.selectFile', { default: 'Select {name}', values: { name: row.file.name } })} /></label>
              <div class="file-cell" title={row.path}><strong>{row.file.name}</strong><span>{row.path}</span></div>
              <span>{inferExtension(row.file.name).toUpperCase()} · {formatBytes(row.file.size)}</span>
              <span title={outputFileName(row.file.name, settings)}>{row.outputSize !== null ? formatBytes(row.outputSize) : outputFileName(row.file.name, settings)}</span>
              <div class="status-cell" title={row.detail}>
                <span>{row.detail || stateLabel(row)}</span>
                {#if row.progress !== null && (row.state === 'converting' || row.state === 'rendering')}<progress max="1" value={row.progress}></progress>{/if}
              </div>
            </div>
          {/each}
        {/if}
      </div>
    </section>

    <aside class="settings-panel" aria-label={$t('converter.settings', { default: 'Conversion settings' })}>
      <fieldset disabled={busy}>
        <legend>{$t('converter.outputFormat', { default: 'Output format' })}</legend>
        <label class="setting-row wide">
          <span>{$t('converter.format', { default: 'Format' })}</span>
          <select value={settings.format} on:change={(event) => updateFormat((event.currentTarget as HTMLSelectElement).value as ConverterFormatId)}>
            <optgroup label={$t('converter.audioFormats', { default: 'Audio' })}>
              {#each CONVERTER_FORMATS.filter((candidate) => candidate.kind === 'audio') as candidate}
                <option value={candidate.id} disabled={!isFormatAvailable(candidate)}>{candidate.label}{!isFormatAvailable(candidate) ? ` · ${$t('converter.unavailable', { default: 'unavailable' })}` : ''}</option>
              {/each}
            </optgroup>
            <optgroup label={$t('converter.videoFormats', { default: 'Video / container' })}>
              {#each CONVERTER_FORMATS.filter((candidate) => candidate.kind === 'video') as candidate}<option value={candidate.id}>{candidate.label}</option>{/each}
            </optgroup>
          </select>
        </label>

        {#if format.kind === 'video'}
          <label class="setting-row"><span>{$t('converter.videoCodec', { default: 'Video codec' })}</span>
            <select value={effectiveVideoCodec ?? ''} on:change={(event) => updateSetting('videoCodec', (event.currentTarget as HTMLSelectElement).value as VideoCodec)}>
              {#each format.videoCodecs as codec}<option value={codec} disabled={!isVideoCodecAvailable(codec)}>{VIDEO_CODEC_LABELS[codec]}{!isVideoCodecAvailable(codec) ? ` · ${$t('converter.unavailable', { default: 'unavailable' })}` : ''}</option>{/each}
            </select>
          </label>
          <label class="setting-row"><span>{$t('converter.audioCodec', { default: 'Audio codec' })}</span>
            <select value={effectiveAudioCodec} on:change={(event) => updateSetting('audioCodec', (event.currentTarget as HTMLSelectElement).value as ConverterAudioCodec)}>
              {#each format.audioCodecs as codec}<option value={codec} disabled={!isAudioCodecAvailable(codec)}>{AUDIO_CODEC_LABELS[codec] ?? codec.toUpperCase()}{!isAudioCodecAvailable(codec) ? ` · ${$t('converter.unavailable', { default: 'unavailable' })}` : ''}</option>{/each}
            </select>
          </label>
        {/if}

        {#if settings.format === 'wav'}
          <label class="setting-row"><span>{$t('converter.pcmFormat', { default: 'PCM format' })}</span>
            <select value={settings.pcmFormat} on:change={(event) => updateSetting('pcmFormat', (event.currentTarget as HTMLSelectElement).value as ConverterPcmFormat)}>
              <option value="u8">8-bit unsigned</option><option value="s16">16-bit integer</option><option value="s24">24-bit integer</option><option value="s32">32-bit integer</option><option value="f32">32-bit float</option><option value="f64">64-bit float</option>
            </select>
          </label>
        {:else if settings.format === 'flac'}
          <label class="setting-row"><span>{$t('converter.bitDepth', { default: 'Bit depth' })}</span>
            <select value={settings.flacBitDepth} on:change={(event) => updateSetting('flacBitDepth', Number((event.currentTarget as HTMLSelectElement).value) as 16 | 24)}><option value={16}>16-bit</option><option value={24}>24-bit</option></select>
          </label>
        {/if}

        {#if isLossyAudio}
          <label class="setting-row"><span>{$t('converter.audioBitrate', { default: 'Audio bitrate' })}</span><span class="number-unit"><input type="number" min="6" max="1024" step="1" value={settings.audioBitrateKbps} on:change={(event) => updateSetting('audioBitrateKbps', numberFromEvent(event))} /><small>kbps</small></span></label>
          <label class="setting-row"><span>{$t('converter.bitrateMode', { default: 'Bitrate mode' })}</span><select value={settings.audioBitrateMode} on:change={(event) => updateSetting('audioBitrateMode', (event.currentTarget as HTMLSelectElement).value as 'constant' | 'variable')}><option value="variable">VBR</option><option value="constant">CBR</option></select></label>
        {/if}

        {#if effectiveAudioCodec !== 'none'}
          <label class="setting-row"><span>{$t('converter.sampleRate', { default: 'Sample rate' })}</span>
            {#if effectiveAudioCodec === 'opus'}
              <select disabled><option>48,000 Hz</option></select>
            {:else}
              <select value={settings.sampleRate} on:change={(event) => updateSetting('sampleRate', ((event.currentTarget as HTMLSelectElement).value === 'source' ? 'source' : Number((event.currentTarget as HTMLSelectElement).value)) as ConverterSampleRate)}>
                <option value="source">{$t('converter.source', { default: 'Source' })}</option><option value={22_050}>22,050 Hz</option><option value={32_000}>32,000 Hz</option><option value={44_100}>44,100 Hz</option><option value={48_000}>48,000 Hz</option><option value={88_200}>88,200 Hz</option><option value={96_000}>96,000 Hz</option>
              </select>
            {/if}
          </label>
          <label class="setting-row"><span>{$t('converter.channels', { default: 'Channels' })}</span><select value={settings.channels} on:change={(event) => updateSetting('channels', ((event.currentTarget as HTMLSelectElement).value === 'source' ? 'source' : Number((event.currentTarget as HTMLSelectElement).value)) as ConverterChannels)}><option value="source">{$t('converter.source', { default: 'Source' })}</option><option value={1}>{$t('converter.mono', { default: 'Mono' })}</option><option value={2}>{$t('converter.stereo', { default: 'Stereo' })}</option></select></label>
        {/if}
      </fieldset>

      {#if format.kind === 'video'}
        <fieldset disabled={busy}>
          <legend>{$t('converter.video', { default: 'Video' })}</legend>
          <label class="setting-row"><span>{$t('converter.videoBitrate', { default: 'Video bitrate' })}</span><span class="number-unit"><input type="number" min="0.1" max="500" step="0.1" value={settings.videoBitrateMbps} on:change={(event) => updateSetting('videoBitrateMbps', numberFromEvent(event))} /><small>Mbps</small></span></label>
          <label class="setting-row"><span>{$t('converter.bitrateMode', { default: 'Bitrate mode' })}</span><select value={settings.videoBitrateMode} on:change={(event) => updateSetting('videoBitrateMode', (event.currentTarget as HTMLSelectElement).value as 'constant' | 'variable')}><option value="variable">VBR</option><option value="constant">CBR</option></select></label>
          <label class="setting-row"><span>{$t('converter.size', { default: 'Size' })}</span><select value={settings.videoSize} on:change={(event) => updateSetting('videoSize', (event.currentTarget as HTMLSelectElement).value as ConverterVideoSize)}><option value="source">{$t('converter.source', { default: 'Source' })}</option><option value="3840x2160">3840 × 2160</option><option value="2560x1440">2560 × 1440</option><option value="1920x1080">1920 × 1080</option><option value="1280x720">1280 × 720</option><option value="854x480">854 × 480</option></select></label>
          {#if settings.videoSize !== 'source'}<label class="setting-row"><span>{$t('converter.fit', { default: 'Fit' })}</span><select value={settings.videoFit} on:change={(event) => updateSetting('videoFit', (event.currentTarget as HTMLSelectElement).value as 'contain' | 'cover' | 'fill')}><option value="contain">{$t('converter.contain', { default: 'Contain' })}</option><option value="cover">{$t('converter.cover', { default: 'Cover' })}</option><option value="fill">{$t('converter.fill', { default: 'Stretch' })}</option></select></label>{/if}
          <label class="setting-row"><span>{$t('converter.frameRate', { default: 'Frame rate' })}</span><select value={settings.frameRate} on:change={(event) => updateSetting('frameRate', ((event.currentTarget as HTMLSelectElement).value === 'source' ? 'source' : Number((event.currentTarget as HTMLSelectElement).value)) as ConverterFrameRate)}><option value="source">{$t('converter.source', { default: 'Source' })}</option><option value={24}>24 fps</option><option value={25}>25 fps</option><option value={30}>30 fps</option><option value={50}>50 fps</option><option value={60}>60 fps</option></select></label>
          <label class="setting-row"><span>{$t('converter.rotation', { default: 'Rotation' })}</span><select value={settings.rotate} on:change={(event) => updateSetting('rotate', Number((event.currentTarget as HTMLSelectElement).value) as 0 | 90 | 180 | 270)}><option value={0}>0°</option><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option></select></label>
          <label class="setting-row"><span>{$t('converter.keyframes', { default: 'Keyframe interval' })}</span><span class="number-unit"><input type="number" min="0" max="60" step="0.5" value={settings.keyFrameInterval} on:change={(event) => updateSetting('keyFrameInterval', numberFromEvent(event))} /><small>s</small></span></label>
          <label class="setting-row"><span>{$t('converter.hardware', { default: 'Acceleration' })}</span><select value={settings.hardwareAcceleration} on:change={(event) => updateSetting('hardwareAcceleration', (event.currentTarget as HTMLSelectElement).value as ConverterSettings['hardwareAcceleration'])}><option value="no-preference">{$t('converter.auto', { default: 'Automatic' })}</option><option value="prefer-hardware">{$t('converter.preferHardware', { default: 'Prefer hardware' })}</option><option value="prefer-software">{$t('converter.preferSoftware', { default: 'Prefer software' })}</option></select></label>
          <label class="check-setting"><input type="checkbox" checked={settings.alpha === 'keep'} on:change={(event) => updateSetting('alpha', (event.currentTarget as HTMLInputElement).checked ? 'keep' : 'discard')} /><span>{$t('converter.keepAlpha', { default: 'Keep alpha channel' })}</span></label>
          <label class="check-setting"><input type="checkbox" checked={settings.allowRotationMetadata} on:change={(event) => updateSetting('allowRotationMetadata', (event.currentTarget as HTMLInputElement).checked)} /><span>{$t('converter.rotationMetadata', { default: 'Allow rotation metadata' })}</span></label>
        </fieldset>
      {/if}

      <fieldset disabled={busy}>
        <legend>{$t('converter.container', { default: 'Container' })}</legend>
        {#if ['m4a', 'mp4', 'mov'].includes(settings.format)}
          <label class="setting-row"><span>{$t('converter.fastStart', { default: 'Fast start' })}</span><select value={settings.fastStart} on:change={(event) => updateSetting('fastStart', (event.currentTarget as HTMLSelectElement).value as ConverterSettings['fastStart'])}><option value="off">{$t('converter.off', { default: 'Off' })}</option><option value="in-memory">{$t('converter.indexFirst', { default: 'Index first' })}</option><option value="fragmented">{$t('converter.fragmented', { default: 'Fragmented' })}</option></select></label>
          {#if settings.fastStart === 'fragmented'}<label class="setting-row"><span>{$t('converter.fragmentDuration', { default: 'Fragment duration' })}</span><span class="number-unit"><input type="number" min="0" max="60" step="0.25" value={settings.fragmentDuration} on:change={(event) => updateSetting('fragmentDuration', numberFromEvent(event))} /><small>s</small></span></label>{/if}
        {:else if settings.format === 'wav'}
          <label class="setting-row"><span>{$t('converter.metadataFormat', { default: 'Metadata' })}</span><select value={settings.wavMetadata} on:change={(event) => updateSetting('wavMetadata', (event.currentTarget as HTMLSelectElement).value as 'info' | 'id3')}><option value="id3">ID3 chunk</option><option value="info">RIFF INFO</option></select></label>
          <label class="check-setting"><input type="checkbox" checked={settings.wavLargeFile} on:change={(event) => updateSetting('wavLargeFile', (event.currentTarget as HTMLInputElement).checked)} /><span>{$t('converter.rf64', { default: 'RF64 (files over 4 GiB)' })}</span></label>
        {:else if settings.format === 'mp3'}
          <label class="check-setting"><input type="checkbox" checked={settings.mp3XingHeader} on:change={(event) => updateSetting('mp3XingHeader', (event.currentTarget as HTMLInputElement).checked)} /><span>{$t('converter.xingHeader', { default: 'Write Xing header and seek index' })}</span></label>
        {:else if settings.format === 'ogg-opus' || settings.format === 'ogg-vorbis'}
          <label class="setting-row"><span>{$t('converter.pageDuration', { default: 'Max page duration' })}</span><span class="number-unit"><input type="number" min="0.05" max="60" step="0.05" value={settings.oggPageDuration} on:change={(event) => updateSetting('oggPageDuration', numberFromEvent(event))} /><small>s</small></span></label>
        {:else if settings.format === 'mkv' || settings.format === 'webm'}
          <label class="setting-row"><span>{$t('converter.clusterDuration', { default: 'Min cluster duration' })}</span><span class="number-unit"><input type="number" min="0" max="60" step="0.25" value={settings.matroskaClusterDuration} on:change={(event) => updateSetting('matroskaClusterDuration', numberFromEvent(event))} /><small>s</small></span></label>
        {:else}
          <p class="settings-note">{$t('converter.noContainerOptions', { default: 'No container-specific settings.' })}</p>
        {/if}
        {#if format.kind === 'video'}<label class="setting-row"><span>{$t('converter.tracks', { default: 'Tracks' })}</span><select value={settings.trackSelection} on:change={(event) => updateSetting('trackSelection', (event.currentTarget as HTMLSelectElement).value as 'primary' | 'all')}><option value="primary">{$t('converter.primaryTracks', { default: 'Primary audio and video' })}</option><option value="all">{$t('converter.allTracks', { default: 'All tracks' })}</option></select></label>{/if}
        <label class="check-setting"><input type="checkbox" checked={settings.preserveMetadata} on:change={(event) => updateSetting('preserveMetadata', (event.currentTarget as HTMLInputElement).checked)} /><span>{$t('converter.copyMetadata', { default: 'Copy metadata and artwork' })}</span></label>
      </fieldset>

      <fieldset disabled={busy}>
        <legend>{$t('converter.filesAndFolders', { default: 'Files and folders' })}</legend>
        <label class="setting-row"><span>{$t('converter.suffix', { default: 'Filename suffix' })}</span><input type="text" maxlength="80" value={settings.fileSuffix} placeholder={$t('converter.none', { default: '(none)' })} on:input={(event) => updateSetting('fileSuffix', (event.currentTarget as HTMLInputElement).value)} /></label>
        <label class="check-setting"><input type="checkbox" checked={settings.preserveFolders} on:change={(event) => updateSetting('preserveFolders', (event.currentTarget as HTMLInputElement).checked)} /><span>{$t('converter.preserveFolders', { default: 'Recreate source folders' })}</span></label>
        <label class="check-setting"><input type="checkbox" checked={settings.skipExisting} on:change={(event) => updateSetting('skipExisting', (event.currentTarget as HTMLInputElement).checked)} /><span>{$t('converter.skipExisting', { default: 'Skip output files that exist' })}</span></label>
      </fieldset>

      <p class:warning={!chosenCodecsAvailable} class="capability-note">
        {#if capabilities === null}
          {$t('converter.checkingCodecs', { default: 'Checking browser codec support...' })}
        {:else if !chosenCodecsAvailable}
          {$t('converter.codecUnavailable', { default: 'The selected codec is unavailable in this Chromium build.' })}
        {:else}
          {$t('converter.workerNote', { default: 'Each parallel job runs in a dedicated worker.' })}
        {/if}
      </p>
    </aside>
  </main>

  {#if contextMenuRowId}
    <MenuSurface
      items={contextMenuItems}
      x={contextMenuX}
      y={contextMenuY}
      ariaLabel={$t('converter.queue', { default: 'Conversion queue' })}
      on:action={(event) => runRowContextAction(event.detail)}
      on:dismiss={() => (contextMenuRowId = null)}
    />
  {/if}

  <footer class="tool-status-bar" class:error={Boolean(errorMessage)}>
    <span>{errorMessage || message || (outputDirectory
      ? $t('converter.readyOutput', { default: 'Ready · output to {name}', values: { name: outputDirectory.name } })
      : $t('converter.chooseOutputPrompt', { default: 'Choose an output folder before converting.' }))}</span>
    <span class="summary">{rows.length} {$t('converter.files', { default: 'files' })} · {selectedRows.length} {$t('converter.selected', { default: 'selected' })}</span>
  </footer>

  {#if dragActive}<div class="tool-drop-overlay">{$t('converter.drop', { default: 'Drop media files or folders' })}</div>{/if}
</div>
