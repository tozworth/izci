<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import HoverTooltip from '$lib/components/HoverTooltip.svelte';
  import type { ComparisonSourceId } from '$lib/services/audio-comparison';
  import WaveformEditor from '../clip-tag/WaveformEditor.svelte';

  export let id: ComparisonSourceId;
  export let file: File | null = null;
  export let buffer: AudioBuffer | null = null;
  export let loudness: number | null = null;
  export let gainDb = 0;
  export let inverted = false;
  export let channelsSwapped = false;
  export let loading = false;
  export let loadingDetail = '';
  export let active = false;
  export let renderedModule = false;
  export let selectionStart = 0;
  export let selectionEnd = 0;
  export let playhead = 0;
  export let zoom = 1;
  export let scrollStart = 0;

  const dispatch = createEventDispatcher<{
    activate: void;
    open: void;
    selection: { start: number; end: number };
    seek: number;
    toggleInvert: void;
    toggleSwap: void;
    drop: File;
  }>();

  let dragActive = false;
  $: sourceLabel = id.toUpperCase();
  $: details = buffer
    ? `${formatTime(buffer.duration)} · ${(buffer.sampleRate / 1000).toFixed(1)} kHz · ${buffer.numberOfChannels} ch`
    : '';

  function formatTime(value: number): string {
    const minutes = Math.floor(value / 60);
    const seconds = value - minutes * 60;
    return `${minutes}:${seconds.toFixed(3).padStart(6, '0')}`;
  }

  function formatLoudness(value: number | null): string {
    return value !== null && Number.isFinite(value) ? `${value.toFixed(1)} LUFS` : '— LUFS';
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    dragActive = false;
    const dropped = event.dataTransfer?.files[0];
    if (dropped) dispatch('drop', dropped);
  }
</script>

<section class="source-panel" class:active class:drag-active={dragActive} data-source={id} role="group" aria-label={$t('audioCompare.sourceGroup', { default: 'Comparison source {source}', values: { source: sourceLabel } })} on:pointerdown={() => dispatch('activate')}>
  <header>
    <span class="source-badge">{sourceLabel}</span>
    <div class="source-identity">
      <strong>{file?.name ?? $t('audioCompare.sourceEmpty', { default: 'No source loaded' })}</strong>
      {#if details}<span>{details}</span>{/if}
    </div>
    {#if buffer}
      <span class="source-reading" title={$t('audioCompare.integratedLoudness', { default: 'Integrated loudness' })}>{formatLoudness(loudness)}</span>
      {#if gainDb !== 0}<span class="gain-badge">{gainDb.toFixed(1)} dB</span>{/if}
      {#if renderedModule}<span class="material-symbols-outlined render-badge" title={$t('audioCompare.renderedModule', { default: 'Rendered module' })}>deployed_code</span>{/if}
    {/if}
    <button class="icon-button hover-tooltip-anchor" type="button" on:click|stopPropagation={() => dispatch('open')} aria-label={$t('audioCompare.replaceSource', { default: 'Open or replace source {source}', values: { source: sourceLabel } })}>
      <span class="material-symbols-outlined" aria-hidden="true">file_open</span>
      <HoverTooltip>{$t('audioCompare.replaceSource', { default: 'Open or replace source {source}', values: { source: sourceLabel } })}</HoverTooltip>
    </button>
  </header>

  <div
    class="source-waveform"
    role="group"
    aria-label={$t('audioCompare.sourceDropArea', { default: 'Source {source} audio and drop area', values: { source: sourceLabel } })}
    on:dragenter|preventDefault={() => dragActive = true}
    on:dragover|preventDefault
    on:dragleave={() => dragActive = false}
    on:drop={handleDrop}
  >
    {#if buffer}
      <WaveformEditor
        {buffer}
        {selectionStart}
        {selectionEnd}
        {playhead}
        disabled={loading}
        bind:zoom
        bind:scrollStart
        waveformLabel={$t('audioCompare.waveformLabel', { default: 'Source {source} waveform and comparison selection', values: { source: sourceLabel } })}
        overviewLabel={$t('audioCompare.overviewLabel', { default: 'Source {source} waveform overview and seek bar', values: { source: sourceLabel } })}
        on:selection={(event) => dispatch('selection', event.detail)}
        on:seek={(event) => dispatch('seek', event.detail)}
      />
      {#if loading}
        <div class="loading-overlay"><span class="material-symbols-outlined spinning" aria-hidden="true">progress_activity</span><span>{loadingDetail}</span></div>
      {/if}
    {:else}
      <button class="empty-source" type="button" on:click|stopPropagation={() => dispatch('open')}>
        <span class="material-symbols-outlined" aria-hidden="true">audio_file</span>
        <strong>{$t('audioCompare.openSource', { default: 'Open source {source}', values: { source: sourceLabel } })}</strong>
        <span>{$t('audioCompare.dropHint', { default: 'or drop an audio file here' })}</span>
        {#if loading}<span class="loading-line"><span class="material-symbols-outlined spinning" aria-hidden="true">progress_activity</span>{loadingDetail}</span>{/if}
      </button>
    {/if}
  </div>

  <footer>
    <label><input type="checkbox" checked={inverted} disabled={!buffer} on:change={() => dispatch('toggleInvert')} /> {$t('audioCompare.invertPolarity', { default: 'Invert polarity' })}</label>
    <label title={buffer?.numberOfChannels !== 2 ? $t('audioCompare.stereoOnly', { default: 'Available for stereo sources' }) : ''}><input type="checkbox" checked={channelsSwapped} disabled={!buffer || buffer.numberOfChannels !== 2} on:change={() => dispatch('toggleSwap')} /> {$t('audioCompare.swapChannels', { default: 'Swap L/R' })}</label>
  </footer>
</section>

<style>
  .source-panel {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: color-mix(in srgb, var(--bg-elevated) 62%, var(--bg-base));
    border: 1px solid var(--border-soft);
    border-radius: 0.25rem;
  }

  .source-panel.active {
    border-color: color-mix(in srgb, var(--accent-strong) 65%, var(--border));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent-strong) 12%, transparent);
  }

  .source-panel.drag-active {
    border-color: var(--accent-strong);
    box-shadow: inset 0 0 0 2px color-mix(in srgb, var(--accent-strong) 34%, transparent);
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.42rem;
    min-height: 2.45rem;
    padding: 0.3rem 0.38rem;
    background: color-mix(in srgb, var(--window-topbar-bg) 72%, var(--bg-elevated));
    border-bottom: 1px solid var(--border-soft);
  }

  .source-badge {
    display: grid;
    place-items: center;
    width: 1.45rem;
    height: 1.45rem;
    flex: 0 0 auto;
    border: 1px solid color-mix(in srgb, var(--accent-strong) 55%, var(--border));
    border-radius: 0.22rem;
    background: color-mix(in srgb, var(--accent-strong) 13%, var(--bg-soft));
    color: var(--accent-strong);
    font-size: 0.72rem;
    font-weight: 700;
  }

  .source-identity {
    display: flex;
    flex-direction: column;
    min-width: 0;
    margin-right: auto;
  }

  .source-identity strong,
  .source-identity span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .source-identity strong { color: var(--text-strong); font-size: 0.72rem; font-weight: 600; }
  .source-identity span { color: var(--muted); font-size: 0.62rem; }
  .source-reading,
  .gain-badge { flex: 0 0 auto; font-size: 0.64rem; font-variant-numeric: tabular-nums; }
  .source-reading { color: var(--muted); }
  .gain-badge { padding: 0.12rem 0.25rem; border-radius: 0.2rem; background: var(--bg-soft); color: var(--text); }
  .render-badge { flex: 0 0 auto; color: var(--accent-strong); font-size: 0.95rem; }

  .source-waveform { position: relative; min-height: 0; overflow: hidden; background: var(--bg-input); }
  .source-waveform :global(.waveform-editor) { min-height: 150px; }

  .empty-source {
    display: flex;
    width: 100%;
    height: 100%;
    min-height: 180px;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 0.32rem;
    background: color-mix(in srgb, var(--bg-input) 94%, transparent);
    color: var(--muted);
  }

  .empty-source:hover { background: color-mix(in srgb, var(--accent-strong) 6%, var(--bg-input)); color: var(--text); }
  .empty-source > .material-symbols-outlined { color: var(--accent-strong); font-size: 2rem; }
  .empty-source strong { color: var(--text-strong); font-weight: 600; }

  .loading-overlay {
    position: absolute;
    inset: 0;
    z-index: 2;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 0.35rem;
    background: color-mix(in srgb, var(--bg-input) 88%, transparent);
    color: var(--muted);
  }

  .loading-line { display: inline-flex; align-items: center; gap: 0.3rem; margin-top: 0.25rem; }
  .spinning { animation: source-spin 850ms linear infinite; }
  @keyframes source-spin { to { transform: rotate(360deg); } }

  footer {
    display: flex;
    align-items: center;
    gap: 0.85rem;
    min-height: 2rem;
    padding: 0.28rem 0.5rem;
    background: color-mix(in srgb, var(--window-topbar-bg) 70%, var(--bg-elevated));
    border-top: 1px solid var(--border-soft);
    color: var(--muted);
    font-size: 0.68rem;
  }

  footer label { display: inline-flex; align-items: center; gap: 0.28rem; white-space: nowrap; }
  footer input { margin: 0; accent-color: var(--accent-strong); }

  .icon-button {
    display: inline-flex;
    width: 1.82rem;
    min-height: 1.75rem;
    flex: 0 0 auto;
    align-items: center;
    justify-content: center;
    border: 1px solid transparent;
    border-radius: 0.3rem;
    background: transparent;
    color: var(--text);
  }
  .icon-button:hover { border-color: var(--border-soft); background: var(--hover-surface); color: var(--text-strong); }
  .icon-button .material-symbols-outlined { font-size: 1.08rem; }
</style>
