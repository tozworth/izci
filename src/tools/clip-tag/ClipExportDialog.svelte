<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import {
    CLIP_EXPORT_FORMATS,
    DEFAULT_CLIP_EXPORT_OPTIONS,
    type ClipExportBitDepth,
    type ClipExportChannels,
    type ClipExportFormat,
    type ClipExportOptions,
    type ClipExportSampleRate
  } from './clip-export-options';

  export let busy = false;
  export let errorMessage = '';
  export let sourceSampleRate = 0;
  export let sourceChannels = 0;

  const dispatch = createEventDispatcher<{ export: ClipExportOptions; close: void }>();
  const MP3_BITRATES = [128, 160, 192, 256, 320] as const;
  const OPUS_BITRATES = [64, 96, 128, 160, 192, 256] as const;

  let dialog: HTMLDialogElement;
  let formatSelect: HTMLSelectElement;
  let format: ClipExportFormat = DEFAULT_CLIP_EXPORT_OPTIONS.format;
  let mp3BitrateKbps = 256;
  let opusBitrateKbps = 160;
  let bitrateMode = DEFAULT_CLIP_EXPORT_OPTIONS.bitrateMode;
  let sampleRate: ClipExportSampleRate = DEFAULT_CLIP_EXPORT_OPTIONS.sampleRate;
  let channels: ClipExportChannels = DEFAULT_CLIP_EXPORT_OPTIONS.channels;
  let wavBitDepth: ClipExportBitDepth = 16;
  let flacBitDepth: ClipExportBitDepth = 24;

  $: isLossy = format === 'mp3' || format === 'opus';
  $: bitDepth = format === 'flac' ? flacBitDepth : wavBitDepth;
  $: bitrateKbps = format === 'opus' ? opusBitrateKbps : mp3BitrateKbps;

  export function show(): void {
    if (!dialog.open) {
      dialog.showModal();
      formatSelect.focus();
    }
  }

  export function close(): void {
    if (dialog.open) dialog.close();
  }

  export function isOpen(): boolean {
    return dialog?.open ?? false;
  }

  function submit(): void {
    if (busy) return;
    dispatch('export', { format, bitrateKbps, bitrateMode, sampleRate, channels, bitDepth });
  }

  function closeDialog(): void {
    if (!busy) dialog.close();
  }
</script>

<dialog
  bind:this={dialog}
  class="clip-export-dialog"
  aria-labelledby="clip-export-title"
  aria-describedby="clip-export-summary"
  aria-busy={busy}
  on:cancel={(event) => { if (busy) event.preventDefault(); }}
  on:close={() => dispatch('close')}
>
  <form on:submit|preventDefault={submit}>
    <header>
      <div>
        <h2 id="clip-export-title">{$t('clipTag.exportDialog.title', { default: 'Export clip' })}</h2>
        <p id="clip-export-summary">{$t('clipTag.exportDialog.summary', { default: 'Choose the output encoding and audio configuration.' })}</p>
      </div>
      <button class="icon-button" type="button" disabled={busy} aria-label={$t('clipTag.exportDialog.cancel', { default: 'Cancel' })} on:click={closeDialog}>
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>

    <div class="export-settings-grid">
      <label>
        <span>{$t('clipTag.exportDialog.format', { default: 'Format' })}</span>
        <select bind:this={formatSelect} bind:value={format} disabled={busy}>
          {#each CLIP_EXPORT_FORMATS as option}
            <option value={option}>{option.toUpperCase()}</option>
          {/each}
        </select>
      </label>

      {#if isLossy}
        <label>
          <span>{$t('clipTag.exportDialog.bitrate', { default: 'Bitrate' })}</span>
          {#if format === 'opus'}
            <select bind:value={opusBitrateKbps} disabled={busy}>
              {#each OPUS_BITRATES as bitrate}<option value={bitrate}>{bitrate} kbps</option>{/each}
            </select>
          {:else}
            <select bind:value={mp3BitrateKbps} disabled={busy}>
              {#each MP3_BITRATES as bitrate}<option value={bitrate}>{bitrate} kbps</option>{/each}
            </select>
          {/if}
        </label>
      {:else}
        <label>
          <span>{$t('clipTag.exportDialog.bitDepth', { default: 'Bit depth' })}</span>
          {#if format === 'flac'}
            <select bind:value={flacBitDepth} disabled={busy}>
              <option value={16}>16-bit</option>
              <option value={24}>24-bit</option>
            </select>
          {:else}
            <select bind:value={wavBitDepth} disabled={busy}>
              <option value={16}>16-bit PCM</option>
              <option value={24}>24-bit PCM</option>
              <option value={32}>32-bit float</option>
            </select>
          {/if}
        </label>
      {/if}

      <label>
        <span>{$t('clipTag.exportDialog.sampleRate', { default: 'Sample rate' })}</span>
        {#if format === 'opus'}
          <select disabled><option>48,000 Hz</option></select>
        {:else}
          <select bind:value={sampleRate} disabled={busy}>
            <option value="source">{$t('clipTag.exportDialog.sourceRate', { default: 'Source ({rate} Hz)', values: { rate: sourceSampleRate.toLocaleString() } })}</option>
            <option value={44_100}>44,100 Hz</option>
            <option value={48_000}>48,000 Hz</option>
          </select>
        {/if}
      </label>

      <label>
        <span>{$t('clipTag.exportDialog.channels', { default: 'Channels' })}</span>
        <select bind:value={channels} disabled={busy}>
          <option value="source">{$t('clipTag.exportDialog.sourceChannels', { default: 'Source ({count})', values: { count: sourceChannels } })}</option>
          <option value={1}>{$t('clipTag.exportDialog.mono', { default: 'Mono' })}</option>
          <option value={2}>{$t('clipTag.exportDialog.stereo', { default: 'Stereo' })}</option>
        </select>
      </label>

      {#if format === 'opus'}
        <label>
          <span>{$t('clipTag.exportDialog.bitrateMode', { default: 'Bitrate mode' })}</span>
          <select bind:value={bitrateMode} disabled={busy}>
            <option value="variable">{$t('clipTag.exportDialog.variable', { default: 'Variable (VBR)' })}</option>
            <option value="constant">{$t('clipTag.exportDialog.constant', { default: 'Constant (CBR)' })}</option>
          </select>
        </label>
      {/if}
    </div>

    <p class="export-format-note">
      {#if format === 'wav'}
        {$t('clipTag.exportDialog.wavNote', { default: 'Uncompressed audio with ID3 metadata.' })}
      {:else if format === 'flac'}
        {$t('clipTag.exportDialog.flacNote', { default: 'Lossless compression with Vorbis comments and embedded artwork.' })}
      {:else if format === 'mp3'}
        {$t('clipTag.exportDialog.mp3Note', { default: 'LAME MP3 encoding with ID3 metadata.' })}
      {:else}
        {$t('clipTag.exportDialog.opusNote', { default: 'Opus in an Ogg container with Vorbis comments and embedded artwork.' })}
      {/if}
    </p>

    {#if errorMessage}
      <p class="export-dialog-error" role="alert"><span class="material-symbols-outlined" aria-hidden="true">error</span>{errorMessage}</p>
    {/if}

    <footer>
      <button class="text-button" type="button" disabled={busy} on:click={closeDialog}>{$t('clipTag.exportDialog.cancel', { default: 'Cancel' })}</button>
      <button class="text-button primary" type="submit" disabled={busy}>
        <span class="material-symbols-outlined" class:spinning={busy} aria-hidden="true">{busy ? 'progress_activity' : 'save'}</span>
        {busy
          ? $t('clipTag.encoding', { default: 'Encoding {format}...', values: { format: format.toUpperCase() } })
          : $t('clipTag.clip.export', { default: 'Export {format}', values: { format: format.toUpperCase() } })}
      </button>
    </footer>
  </form>
</dialog>
