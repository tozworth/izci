<script lang="ts">
  import { onDestroy } from 'svelte';
  import { t } from 'svelte-i18n';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import MenuSurface from '$lib/components/MenuSurface.svelte';
  import type { MenuActionItem } from '$lib/contracts/window-menu';
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
  $: contextMenuItems = buildContextMenu(fftSize, floorDb, loading);

  function buildContextMenu(
    currentFftSize: number,
    currentFloorDb: number,
    isLoading: boolean
  ): MenuActionItem[] {
    return [
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

  async function analyzeItem(nextItem: TroubadourWorkbenchItem | null): Promise<void> {
    analysisController?.abort();
    analysisController = null;
    analysis = null;
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
    } finally {
      if (analysisController === controller) {
        loading = false;
        analysisController = null;
      }
    }
  }

  function openContextMenu(event: MouseEvent): void {
    contextMenuX = event.clientX;
    contextMenuY = event.clientY;
    contextMenuOpen = true;
  }

  function runContextMenuAction(action: string): void {
    contextMenuOpen = false;
    if (action === 'stop') analysisController?.abort();
    else if (action.startsWith('fft:')) fftSize = Number(action.slice(4));
    else if (action.startsWith('floor:')) floorDb = Number(action.slice(6));
  }

  onDestroy(() => analysisController?.abort());
</script>

<section class="spectrogram-tab">
  <div class="tool-row tool-toolbar spectrogram-toolbar" role="toolbar" aria-label={$t('spectrogram.toolbar', { default: 'Spectrogram tools' })}>
    {#if loading}
      <button class="icon-button hover-tooltip-anchor" type="button" on:click={() => analysisController?.abort()} aria-label={$t('spectrogram.stop', { default: 'Stop' })}>
        <span class="material-symbols-outlined" aria-hidden="true">stop</span>
        <HoverTooltip>{$t('spectrogram.stop', { default: 'Stop' })}</HoverTooltip>
      </button>
      <span class="separator" aria-hidden="true"></span>
    {/if}
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
      <div class="spectrogram-empty-state">
        <span class="material-symbols-outlined" aria-hidden="true">waterfall_chart</span>
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

</section>
