<script lang="ts">
  import { t } from 'svelte-i18n';
  import { STEREO_WIDTH_MAX_DB, STEREO_WIDTH_MIN_DB } from '$lib/services/raf-effects/mid-side';
  import { rafSettings } from '$lib/stores/raf-settings';
  import type { RafStereoWidthSettings } from '$lib/contracts/raf';

  export let settings: RafStereoWidthSettings;

  function updateWidth(event: Event) {
    const widthDb = (event.currentTarget as HTMLInputElement).valueAsNumber;
    rafSettings.updateEffect(settings.id, (effect) => ({ ...effect, widthDb } as RafStereoWidthSettings));
  }
</script>

<label class="width-control">
  <span>{$t('options.raf.stereoWidth.narrower', { default: 'Narrower' })}</span>
  <input type="range" min={STEREO_WIDTH_MIN_DB} max={STEREO_WIDTH_MAX_DB} step="0.5" value={settings.widthDb} on:input={updateWidth} aria-label={$t('options.raf.stereoWidth.label', { default: 'Stereo width' })} />
  <span>{$t('options.raf.stereoWidth.wider', { default: 'Wider' })}</span>
  <output>{settings.widthDb > 0 ? '+' : ''}{settings.widthDb.toFixed(1)} dB</output>
</label>

<style>
  .width-control { width: 100%; min-width: 0; display: grid; grid-template-columns: auto minmax(90px, 1fr) auto 54px; align-items: center; gap: 7px; color: var(--muted); font-size: 10px; }
  input[type='range'] { width: 100%; accent-color: var(--accent-strong); }
  output { color: var(--text-strong); text-align: right; font-variant-numeric: tabular-nums; }
</style>
