<script lang="ts">
  import { t } from 'svelte-i18n';
  import {
    PITCH_ALIGNMENT_OPTIONS,
    PITCH_GRAIN_SIZES,
    PITCH_MAX_PEAKS_OPTIONS,
    PITCH_PEAK_FLOOR_OPTIONS,
    PITCH_SEMITONES_MAX,
    PITCH_SEMITONES_MIN,
    PITCH_WINDOW_SIZES
  } from '$lib/services/raf-effects/pitch';
  import { rafSettings } from '$lib/stores/raf-settings';
  import type { RafPitchEngine, RafPitchSettings } from '$lib/types';

  export let settings: RafPitchSettings;

  type PitchKey = 'semitones' | 'windowSize' | 'maxPeaks' | 'peakFloorDb' | 'grainSize' | 'alignmentWindow';

  function update(changes: Partial<RafPitchSettings>) {
    rafSettings.updateEffect(settings.id, (effect) => effect.type === 'pitch' ? { ...effect, ...changes } : effect);
  }

  function updateNumber(event: Event, key: PitchKey) {
    update({ [key]: (event.currentTarget as HTMLInputElement).valueAsNumber });
  }

  function updateEngine(engine: RafPitchEngine) {
    update({ engine });
  }

  function windowSizeLabel(size: number): string {
    return `${size} (~${Math.round(size / 48_000 * 1_000)} ms)`;
  }
</script>

<div class="pitch-editor">
  <div class="engine-control">
    <span>{$t('options.raf.pitch.engine', { default: 'Engine' })}</span>
    <div class="engine-switch" role="group" aria-label={$t('options.raf.pitch.engine', { default: 'Engine' })}>
      <button class:active={settings.engine === 'phase-vocoder'} aria-pressed={settings.engine === 'phase-vocoder'} on:click={() => updateEngine('phase-vocoder')}>{$t('options.raf.pitch.engines.phaseVocoder', { default: 'Phase vocoder' })}</button>
      <button class:active={settings.engine === 'granular'} aria-pressed={settings.engine === 'granular'} on:click={() => updateEngine('granular')}>{$t('options.raf.pitch.engines.granular', { default: 'Granular' })}</button>
    </div>
  </div>

  <label class="pitch-control">
    <span>{$t('options.raf.pitch.lower', { default: 'Lower' })}</span>
    <input type="range" min={PITCH_SEMITONES_MIN} max={PITCH_SEMITONES_MAX} step="1" value={settings.semitones} on:input={(event) => updateNumber(event, 'semitones')} aria-label={$t('options.raf.pitch.semitones', { default: 'Pitch shift' })} />
    <span>{$t('options.raf.pitch.higher', { default: 'Higher' })}</span>
    <output>{settings.semitones > 0 ? '+' : ''}{settings.semitones.toFixed(0)} st</output>
  </label>

  {#if settings.engine === 'phase-vocoder'}
    <div class="knob-grid">
      <label>
        <span>{$t('options.raf.pitch.windowSize', { default: 'Window size' })}</span>
        <select value={settings.windowSize} on:change={(event) => updateNumber(event, 'windowSize')}>
          {#each PITCH_WINDOW_SIZES as size}
            <option value={size}>{windowSizeLabel(size)}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>{$t('options.raf.pitch.maxPeaks', { default: 'Max oscillators' })}</span>
        <select value={settings.maxPeaks} on:change={(event) => updateNumber(event, 'maxPeaks')}>
          {#each PITCH_MAX_PEAKS_OPTIONS as count}
            <option value={count}>{count}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>{$t('options.raf.pitch.peakFloor', { default: 'Peak floor' })}</span>
        <select value={settings.peakFloorDb} on:change={(event) => updateNumber(event, 'peakFloorDb')}>
          {#each PITCH_PEAK_FLOOR_OPTIONS as floor}
            <option value={floor}>{floor} dB</option>
          {/each}
        </select>
      </label>
    </div>
    <p class="pitch-note">{$t('options.raf.pitch.note', { default: 'Realtime phase-vocoder pitch shift; adds about 45 ms of latency.' })}</p>
  {:else}
    <div class="knob-grid">
      <label>
        <span>{$t('options.raf.pitch.grainSize', { default: 'Grain size' })}</span>
        <select value={settings.grainSize} on:change={(event) => updateNumber(event, 'grainSize')}>
          {#each PITCH_GRAIN_SIZES as size}
            <option value={size}>{size}</option>
          {/each}
        </select>
      </label>
      <label>
        <span>{$t('options.raf.pitch.alignmentWindow', { default: 'Alignment window' })}</span>
        <select value={settings.alignmentWindow} on:change={(event) => updateNumber(event, 'alignmentWindow')}>
          {#each PITCH_ALIGNMENT_OPTIONS as window}
            <option value={window}>{window}</option>
          {/each}
        </select>
      </label>
    </div>
    <p class="pitch-note">{$t('options.raf.pitch.granularNote', { default: 'Realtime granular pitch shift; adds about 85 ms of latency.' })}</p>
  {/if}
</div>

<style>
  .pitch-editor { display: grid; gap: 10px; padding: 2px; }
  .engine-control { display: grid; grid-template-columns: 42px minmax(200px, 1fr); align-items: center; gap: 7px; }
  .engine-control > span,
  .pitch-control > span { color: var(--muted); font-size: 10px; }
  .engine-switch { min-width: 0; display: inline-flex; border: 1px solid var(--border-faint); border-radius: 999px; overflow: hidden; }
  .engine-switch button { min-width: 0; min-height: 24px; padding: 2px 10px; flex: 1 1 auto; border-radius: 0; background: transparent; color: var(--muted-strong); font-size: 10px; white-space: nowrap; }
  .engine-switch button + button { border-left: 1px solid var(--border-faint); }
  .engine-switch button.active { background: var(--accent); color: var(--accent-text, #fff); }
  .engine-switch button:hover:not(.active) { background: var(--hover-surface); color: var(--text-strong); }
  .pitch-control { width: 100%; min-width: 0; display: grid; grid-template-columns: auto minmax(90px, 1fr) auto 54px; align-items: center; gap: 7px; }
  .knob-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 14px; padding-top: 9px; border-top: 1px solid var(--border-faint); }
  .knob-grid label { min-width: 0; display: grid; grid-template-columns: minmax(70px, 1fr) 110px; align-items: center; gap: 7px; color: var(--muted); font-size: 10px; }
  .knob-grid select { min-width: 0; border-radius: 6px; border: 1px solid var(--menu-bar-border); padding: 3px 6px; color: var(--text); background: var(--bg-input); font-size: 10px; }
  input[type='range'] { width: 100%; accent-color: var(--accent-strong); }
  output { color: var(--text-strong); text-align: right; font-variant-numeric: tabular-nums; }
  .pitch-note { margin: 0; color: var(--muted); font-size: 10px; line-height: 1.4; }
  @container (max-width: 390px) {
    .knob-grid { grid-template-columns: 1fr; }
  }
</style>
