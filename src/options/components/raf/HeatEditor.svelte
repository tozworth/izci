<script lang="ts">
  import { t } from 'svelte-i18n';
  import {
    HEAT_ASYMMETRY_MAX,
    HEAT_ASYMMETRY_MIN,
    HEAT_COLOR_MAX_DB,
    HEAT_COLOR_MIN_DB,
    HEAT_DRIVE_MAX_DB,
    HEAT_DRIVE_MIN_DB,
    HEAT_OUTPUT_MAX_DB,
    HEAT_OUTPUT_MIN_DB
  } from '$lib/services/raf-effects/heat';
  import { rafSettings } from '$lib/stores/raf-settings';
  import type { RafHeatSettings } from '$lib/types';

  export let settings: RafHeatSettings;
  type HeatKey = 'driveDb' | 'outputDb' | 'colorDb' | 'asymmetry';

  function update(event: Event, key: HeatKey) {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
    rafSettings.updateEffect(settings.id, (effect) => effect.type === 'heat' ? { ...effect, [key]: value } : effect);
  }
</script>

<div class="heat-editor">
  <label><span>{$t('options.raf.heat.drive', { default: 'Drive' })}</span><input type="range" min={HEAT_DRIVE_MIN_DB} max={HEAT_DRIVE_MAX_DB} step="0.5" value={settings.driveDb} on:input={(event) => update(event, 'driveDb')} /><output>{settings.driveDb.toFixed(1)} dB</output></label>
  <label><span>{$t('options.raf.heat.output', { default: 'Output' })}</span><input type="range" min={HEAT_OUTPUT_MIN_DB} max={HEAT_OUTPUT_MAX_DB} step="0.5" value={settings.outputDb} on:input={(event) => update(event, 'outputDb')} /><output>{settings.outputDb > 0 ? '+' : ''}{settings.outputDb.toFixed(1)} dB</output></label>
  <label><span>{$t('options.raf.heat.color', { default: 'Color' })}</span><input type="range" min={HEAT_COLOR_MIN_DB} max={HEAT_COLOR_MAX_DB} step="0.5" value={settings.colorDb} on:input={(event) => update(event, 'colorDb')} /><output>{settings.colorDb > 0 ? '+' : ''}{settings.colorDb.toFixed(1)} dB</output></label>
  <label><span>{$t('options.raf.heat.asymmetry', { default: 'Asymmetry' })}</span><input type="range" min={HEAT_ASYMMETRY_MIN} max={HEAT_ASYMMETRY_MAX} step="1" value={settings.asymmetry} on:input={(event) => update(event, 'asymmetry')} /><output>{settings.asymmetry.toFixed(0)}%</output></label>
</div>

<style>
  .heat-editor { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 14px; padding: 2px; }
  label { min-width: 0; display: grid; grid-template-columns: 55px minmax(80px, 1fr) 65px; align-items: center; gap: 7px; color: var(--muted); font-size: 10px; }
  input[type='range'] { width: 100%; accent-color: var(--accent-strong); }
  output { color: var(--text-strong); text-align: right; font-variant-numeric: tabular-nums; }
  @container (max-width: 390px) { .heat-editor { grid-template-columns: 1fr; } }
</style>
