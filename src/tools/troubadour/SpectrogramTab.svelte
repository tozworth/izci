<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import type { MenuActionItem } from '$lib/types';
  import SpectrogramCanvas from './SpectrogramCanvas.svelte';
  import {
    analyzeSpectrogram,
    DEFAULT_FFT_SIZE,
    SPECTROGRAM_FFT_SIZES,
    type SpectrogramAnalysis
  } from './spectrogram-analyzer';
  import type { TroubadourWorkbenchItem } from './troubadour-controller';

  export let item: TroubadourWorkbenchItem | null = null;

  let analysis: SpectrogramAnalysis | null = null;
  let fftSize: number = DEFAULT_FFT_SIZE;
  let floorDb = -120;
  let progress = 0;
  let loading = false;
  let errorMessage = '';
  let analysisController: AbortController | null = null;
  let analyzedSourceKey = '';
  let contextMenuOpen = false;
  let contextMenuX = 0;
  let contextMenuY = 0;

  $: sourceKey = item
    ? `${item.id}:${item.file.name}:${item.file.size}:${item.file.lastModified}:${fftSize}`
    : '';
  $: if (sourceKey !== analyzedSourceKey) {
    analyzedSourceKey = sourceKey;
    void analyzeItem(item);
  }
  $: fileDetails = analysis && item
    ? `${analysis.codec.toUpperCase()} · ${(analysis.sampleRate / 1000).toFixed(1)} kHz · ${analysis.channels} ch · ${formatDuration(analysis.duration)} · ${formatBytes(item.file.size)}`
    : '';
  $: contextMenuItems = buildContextMenu(fftSize, floorDb, loading, Boolean(item));

  function buildContextMenu(
    currentFftSize: number,
    currentFloorDb: number,
    isLoading: boolean,
    hasSource: boolean
  ): MenuActionItem[] {
    return [
      {
        id: 'reanalyze',
        label: $t('spectrogram.reanalyze', { default: 'Regenerate spectrum' }),
        icon: 'refresh',
        disabled: isLoading || !hasSource
      },
      {
        id: 'stop',
        label: $t('spectrogram.stop', { default: 'Stop' }),
        icon: 'stop',
        disabled: !isLoading
      },
      {
        id: 'fft',
        label: $t('spectrogram.fftSize', { default: 'FFT size' }),
        icon: 'graphic_eq',
        disabled: isLoading,
        separatorBefore: true,
        children: SPECTROGRAM_FFT_SIZES.map((size) => ({
          id: `fft:${size}`,
          label: String(size),
          icon: currentFftSize === size ? 'radio_button_checked' : 'radio_button_unchecked'
        }))
      },
      {
        id: 'floor',
        label: $t('spectrogram.range', { default: 'Floor' }),
        icon: 'contrast',
        children: [-80, -100, -120, -140].map((value) => ({
          id: `floor:${value}`,
          label: `−${Math.abs(value)} dBFS`,
          icon: currentFloorDb === value ? 'radio_button_checked' : 'radio_button_unchecked'
        }))
      }
    ];
  }

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

  async function analyzeItem(nextItem: TroubadourWorkbenchItem | null): Promise<void> {
    analysisController?.abort();
    analysisController = null;
    analysis = null;
    errorMessage = '';
    progress = 0;
    loading = false;
    if (!nextItem) return;

    const controller = new AbortController();
    analysisController = controller;
    loading = true;
    try {
      const result = await analyzeSpectrogram(nextItem.file, {
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

  function regenerate(): void {
    analyzedSourceKey = '';
  }

  function openContextMenu(event: MouseEvent): void {
    contextMenuX = event.clientX;
    contextMenuY = event.clientY;
    contextMenuOpen = true;
  }

  function runContextMenuAction(action: string): void {
    contextMenuOpen = false;
    if (action === 'reanalyze') regenerate();
    else if (action === 'stop') analysisController?.abort();
    else if (action.startsWith('fft:')) fftSize = Number(action.slice(4));
    else if (action.startsWith('floor:')) floorDb = Number(action.slice(6));
  }

  onDestroy(() => analysisController?.abort());
</script>

<section class="spectrogram-tab">
  <div class="tool-row tool-toolbar spectrogram-toolbar" role="toolbar" aria-label={$t('spectrogram.toolbar', { default: 'Spectrogram tools' })}>
    <button class="text-button" type="button" disabled={!item || loading} on:click={regenerate}>
      <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
      {$t('spectrogram.reanalyze', { default: 'Regenerate spectrum' })}
    </button>
    {#if loading}
      <button class="text-button" type="button" on:click={() => analysisController?.abort()}>
        <span class="material-symbols-outlined" aria-hidden="true">stop</span>
        {$t('spectrogram.stop', { default: 'Stop' })}
      </button>
    {/if}
    <span class="separator" aria-hidden="true"></span>
    <label>
      <span>{$t('spectrogram.fftSize', { default: 'FFT size' })}</span>
      <select bind:value={fftSize} disabled={loading}>
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
    <span class="toolbar-note">{item?.file.name ?? $t('troubadour.workbench.selectSpectrogramFile', { default: 'Select a streamed audio file from Metadata, then open Spectrogram.' })}</span>
  </div>

  <main class="spectrogram-view">
    {#if analysis}
      <SpectrogramCanvas {analysis} {floorDb} on:contextMenu={(event) => openContextMenu(event.detail)} />
    {:else if loading}
      <div class="analysis-state">
        <span class="material-symbols-outlined spinning" aria-hidden="true">progress_activity</span>
        <strong>{$t('spectrogram.analyzing', { default: 'Analyzing spectrum...' })}</strong>
        <progress max="1" value={progress}></progress>
        <span>{Math.round(progress * 100)}%</span>
      </div>
    {:else}
      <div class="tool-empty-state empty-state">
        <span class="material-symbols-outlined" aria-hidden="true">waterfall_chart</span>
        <strong>{errorMessage || $t('spectrogram.empty', { default: 'Open a streamed audio file' })}</strong>
        <span>{$t('spectrogram.emptyHint', { default: 'MP3, WAV, FLAC, Ogg, or Opus · you can also drop a file here' })}</span>
      </div>
    {/if}
  </main>

  {#if contextMenuOpen}
    <MenuSurface
      items={contextMenuItems}
      x={contextMenuX}
      y={contextMenuY}
      ariaLabel={$t('spectrogram.graphLabel', { default: 'Audio spectrogram: time from left to right, frequency from bottom to top, and color showing level in dBFS' })}
      enableOverflowSubmenuFallback
      on:action={(event) => runContextMenuAction(event.detail)}
      on:dismiss={() => (contextMenuOpen = false)}
    />
  {/if}

  <footer class="tool-status-bar" class:error={Boolean(errorMessage)}>
    <span class="material-symbols-outlined" aria-hidden="true">{errorMessage ? 'error' : 'info'}</span>
    <span>{errorMessage || fileDetails || $t('spectrogram.caveat', { default: 'A sharp cutoff can suggest a lossy source, but it is not proof by itself.' })}</span>
    {#if analysis}<span class="summary">{analysis.fftSize} FFT · {analysis.binCount} {$t('spectrogram.bins', { default: 'bins' })}</span>{/if}
  </footer>
</section>
