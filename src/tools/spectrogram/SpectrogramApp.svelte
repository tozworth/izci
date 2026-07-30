<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import { STREAM_EXTENSIONS } from '$lib/types';
  import { listenForCurrentToolTrack } from '$lib/services/tool-track-context';
  import { inferExtension } from '$lib/utils/files';
  import SpectrogramCanvas from './SpectrogramCanvas.svelte';
  import SpectrogramMenuBar from './SpectrogramMenuBar.svelte';
  import {
    analyzeSpectrogram,
    DEFAULT_FFT_SIZE,
    SPECTROGRAM_FFT_SIZES,
    type SpectrogramAnalysis
  } from './spectrogram-analyzer';

  const ACCEPTED_EXTENSIONS = STREAM_EXTENSIONS.map((extension) => `.${extension}`);
  const FILE_ACCEPT = ACCEPTED_EXTENSIONS.join(',');
  const OPEN_FILE_PICKER_OPTIONS: OpenFilePickerOptions = {
    multiple: false,
    types: [{
      description: 'Streamed audio files',
      accept: { 'audio/*': ACCEPTED_EXTENSIONS }
    }]
  };

  let fileInput: HTMLInputElement;
  let sourceFile: File | null = null;
  let sourceHandle: FileSystemFileHandle | null = null;
  let analysis: SpectrogramAnalysis | null = null;
  let fftSize: number = DEFAULT_FFT_SIZE;
  let floorDb = -120;
  let progress = 0;
  let loading = false;
  let errorMessage = '';
  let dragDepth = 0;
  let dragActive = false;
  let analysisController: AbortController | null = null;

  $: fileDetails = analysis && sourceFile
    ? `${analysis.codec.toUpperCase()} · ${(analysis.sampleRate / 1000).toFixed(1)} kHz · ${analysis.channels} ch · ${formatDuration(analysis.duration)} · ${formatBytes(sourceFile.size)}`
    : '';

  function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    const remaining = Math.floor(seconds % 60);
    return hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
      : `${minutes}:${String(remaining).padStart(2, '0')}`;
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  }

  function isStreamedAudio(file: File): boolean {
    return (STREAM_EXTENSIONS as readonly string[]).includes(inferExtension(file.name));
  }

  async function openFile(file: File, handle: FileSystemFileHandle | null = null): Promise<void> {
    if (!isStreamedAudio(file)) {
      errorMessage = $t('spectrogram.unsupported', {
        default: 'Spectrogram supports streamed audio only: MP3, WAV, FLAC, Ogg, and Opus.'
      });
      return;
    }

    analysisController?.abort();
    const controller = new AbortController();
    analysisController = controller;
    sourceFile = file;
    sourceHandle = handle;
    analysis = null;
    errorMessage = '';
    progress = 0;
    loading = true;
    try {
      const result = await analyzeSpectrogram(file, {
        fftSize,
        signal: controller.signal,
        onProgress: ({ completed, total }) => {
          progress = total > 0 ? completed / total : 0;
        }
      });
      if (analysisController === controller) analysis = result;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      if (analysisController === controller) {
        errorMessage = error instanceof Error
          ? error.message
          : $t('spectrogram.failed', { default: 'The spectrogram could not be generated.' });
      }
    } finally {
      if (analysisController === controller) {
        loading = false;
        analysisController = null;
      }
    }
  }

  async function chooseFile(): Promise<void> {
    const pickerWindow = window as Window & {
      showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
    };
    if (!pickerWindow.showOpenFilePicker) {
      fileInput.click();
      return;
    }
    try {
      const [handle] = await pickerWindow.showOpenFilePicker(OPEN_FILE_PICKER_OPTIONS);
      if (handle) await openFile(await handle.getFile(), handle);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        errorMessage = $t('spectrogram.openFailed', { default: 'The audio file could not be opened.' });
      }
    }
  }

  async function handleFileInput(): Promise<void> {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) await openFile(file);
  }

  async function handleDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    dragDepth = 0;
    dragActive = false;
    const item = event.dataTransfer?.items[0];
    let handle: FileSystemHandle | null = null;
    try {
      handle = await item?.getAsFileSystemHandle?.() ?? null;
    } catch {
      handle = null;
    }
    if (handle?.kind === 'file') {
      const fileHandle = handle as FileSystemFileHandle;
      await openFile(await fileHandle.getFile(), fileHandle);
      return;
    }
    const file = event.dataTransfer?.files[0];
    if (file) await openFile(file);
  }

  function handleDragEnter(event: DragEvent): void {
    event.preventDefault();
    dragDepth += 1;
    dragActive = true;
  }

  function handleDragLeave(event: DragEvent): void {
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    dragActive = dragDepth > 0;
  }

  function changeFftSize(): void {
    if (sourceFile && !loading) void openFile(sourceFile, sourceHandle);
  }

  function handleWindowKeydown(event: KeyboardEvent): void {
    if (!event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key.toLowerCase() === 'o') {
      event.preventDefault();
      void chooseFile();
    } else if (event.key.toLowerCase() === 'w') {
      event.preventDefault();
      window.close();
    }
  }

  onMount(() => {
    const preventDefault = (event: DragEvent) => event.preventDefault();
    const stopListeningForTrack = listenForCurrentToolTrack((track) => {
      if (track.kind === 'stream' && isStreamedAudio(track.file)) {
        void openFile(track.file, track.fileHandle ?? null);
      }
    });
    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', handleDrop);
    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('keydown', handleWindowKeydown);
    return () => {
      stopListeningForTrack();
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('keydown', handleWindowKeydown);
    };
  });

  onDestroy(() => analysisController?.abort());
</script>

<svelte:head><title>{sourceFile ? `${sourceFile.name} — Spectrogram` : 'izci Spectrogram'}</title></svelte:head>

<div class="spectrogram-shell">
  <div class="window-frame-safe-strip" aria-hidden="true"></div>
  <SpectrogramMenuBar
    fileName={sourceFile?.name ?? ''}
    on:open={() => void chooseFile()}
    on:close={() => window.close()}
  />

  <section class="toolbar" aria-label={$t('spectrogram.toolbar', { default: 'Spectrogram tools' })}>
    <button type="button" on:click={() => void chooseFile()}>
      <span class="material-symbols-outlined" aria-hidden="true">file_open</span>
      {$t('spectrogram.open', { default: 'Open...' })}
    </button>
    {#if loading}
      <button type="button" on:click={() => analysisController?.abort()}>
        <span class="material-symbols-outlined" aria-hidden="true">stop</span>
        {$t('spectrogram.stop', { default: 'Stop' })}
      </button>
    {/if}
    <span class="separator" aria-hidden="true"></span>
    <label>
      <span>{$t('spectrogram.fftSize', { default: 'FFT size' })}</span>
      <select bind:value={fftSize} disabled={loading} on:change={changeFftSize}>
        {#each SPECTROGRAM_FFT_SIZES as size}<option value={size}>{size}</option>{/each}
      </select>
    </label>
    <label>
      <span>{$t('spectrogram.range', { default: 'Floor' })}</span>
      <select bind:value={floorDb}>
        <option value={-80}>−80 dBFS</option>
        <option value={-100}>−100 dBFS</option>
        <option value={-120}>−120 dBFS</option>
        <option value={-140}>−140 dBFS</option>
      </select>
    </label>
    <span class="toolbar-note">{$t('spectrogram.hoverHint', { default: 'Hover the plot for exact time and frequency.' })}</span>
  </section>

  <main>
    {#if analysis}
      <SpectrogramCanvas {analysis} {floorDb} />
    {:else if loading}
      <div class="analysis-state">
        <span class="material-symbols-outlined spinning" aria-hidden="true">progress_activity</span>
        <strong>{$t('spectrogram.analyzing', { default: 'Analyzing spectrum...' })}</strong>
        <progress max="1" value={progress}></progress>
        <span>{Math.round(progress * 100)}%</span>
      </div>
    {:else}
      <button class="empty-state" type="button" on:click={() => void chooseFile()}>
        <span class="material-symbols-outlined" aria-hidden="true">waterfall_chart</span>
        <strong>{$t('spectrogram.empty', { default: 'Open a streamed audio file' })}</strong>
        <span>{$t('spectrogram.emptyHint', { default: 'MP3, WAV, FLAC, Ogg, or Opus · you can also drop a file here' })}</span>
      </button>
    {/if}
  </main>

  <footer class:error={Boolean(errorMessage)}>
    <span class="material-symbols-outlined" aria-hidden="true">{errorMessage ? 'error' : 'info'}</span>
    <span>{errorMessage || fileDetails || $t('spectrogram.caveat', { default: 'A sharp cutoff can suggest a lossy source, but it is not proof by itself.' })}</span>
    {#if analysis}<span class="summary">{analysis.fftSize} FFT · {analysis.binCount} {$t('spectrogram.bins', { default: 'bins' })}</span>{/if}
  </footer>

  <input bind:this={fileInput} class="hidden-input" type="file" accept={FILE_ACCEPT} on:change={() => void handleFileInput()} />
  {#if dragActive}<div class="drop-overlay">{$t('spectrogram.drop', { default: 'Drop streamed audio file' })}</div>{/if}
</div>
