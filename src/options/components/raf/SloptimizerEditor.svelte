<script lang="ts">
  import {
    SLOPTIMIZER_CEILING_MAX_DB,
    SLOPTIMIZER_CEILING_MIN_DB,
    SLOPTIMIZER_DENSITY_MAX,
    SLOPTIMIZER_DENSITY_MIN,
    SLOPTIMIZER_LIFT_MAX_DB,
    SLOPTIMIZER_LIFT_MIN_DB,
    SLOPTIMIZER_SLOP_MAX,
    SLOPTIMIZER_SLOP_MIN,
    SLOPTIMIZER_SPEED_MAX,
    SLOPTIMIZER_SPEED_MIN,
    mapSlopToParameters
  } from '$lib/services/raf-effects/sloptimizer';
  import { rafSettings } from '$lib/stores/raf-settings';
  import type { RafSloptimizerSettings } from '$lib/types';

  export let settings: RafSloptimizerSettings;

  type AdvancedKey = 'lowLiftDb' | 'midLiftDb' | 'highLiftDb' | 'density' | 'speed' | 'ceilingDb';

  function setAdvanced(advanced: boolean) {
    update({ advanced });
  }

  function updateSlop(event: Event) {
    const slop = (event.currentTarget as HTMLInputElement).valueAsNumber;
    update({ slop, customized: false, ...mapSlopToParameters(slop) });
  }

  function updateAdvanced(event: Event, key: AdvancedKey) {
    update({ [key]: (event.currentTarget as HTMLInputElement).valueAsNumber, customized: true });
  }

  function resetMapping() {
    update({ customized: false, ...mapSlopToParameters(settings.slop) });
  }

  function update(changes: Partial<RafSloptimizerSettings>) {
    rafSettings.updateEffect(settings.id, (effect) => effect.type === 'sloptimizer' ? { ...effect, ...changes } : effect);
  }

  function formatDb(value: number): string {
    return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
  }
</script>

<div class="sloptimizer-editor">
  <div class="mode-row" aria-label="Sloptimizer editor mode">
    <button class:active={!settings.advanced} on:click={() => setAdvanced(false)} aria-pressed={!settings.advanced}>Simple</button>
    <button class:active={settings.advanced} on:click={() => setAdvanced(true)} aria-pressed={settings.advanced}>Advanced</button>
    {#if settings.customized}<span class="customized">Customized</span>{/if}
  </div>

  <label class="slop-control">
    <span class="control-name">Slop</span>
    <input type="range" min={SLOPTIMIZER_SLOP_MIN} max={SLOPTIMIZER_SLOP_MAX} step="1" value={settings.slop} on:input={updateSlop} />
    <output>{settings.slop.toFixed(0)}%</output>
  </label>

  {#if settings.advanced}
    <div class="advanced-grid">
      <label><span>Low lift</span><input type="range" min={SLOPTIMIZER_LIFT_MIN_DB} max={SLOPTIMIZER_LIFT_MAX_DB} step="0.1" value={settings.lowLiftDb} on:input={(event) => updateAdvanced(event, 'lowLiftDb')} /><output>{formatDb(settings.lowLiftDb)}</output></label>
      <label><span>Mid lift</span><input type="range" min={SLOPTIMIZER_LIFT_MIN_DB} max={SLOPTIMIZER_LIFT_MAX_DB} step="0.1" value={settings.midLiftDb} on:input={(event) => updateAdvanced(event, 'midLiftDb')} /><output>{formatDb(settings.midLiftDb)}</output></label>
      <label><span>High lift</span><input type="range" min={SLOPTIMIZER_LIFT_MIN_DB} max={SLOPTIMIZER_LIFT_MAX_DB} step="0.1" value={settings.highLiftDb} on:input={(event) => updateAdvanced(event, 'highLiftDb')} /><output>{formatDb(settings.highLiftDb)}</output></label>
      <label><span>Density</span><input type="range" min={SLOPTIMIZER_DENSITY_MIN} max={SLOPTIMIZER_DENSITY_MAX} step="1" value={settings.density} on:input={(event) => updateAdvanced(event, 'density')} /><output>{settings.density.toFixed(0)}%</output></label>
      <label><span>Speed</span><input type="range" min={SLOPTIMIZER_SPEED_MIN} max={SLOPTIMIZER_SPEED_MAX} step="1" value={settings.speed} on:input={(event) => updateAdvanced(event, 'speed')} /><output>{settings.speed.toFixed(0)}%</output></label>
      <label><span>Ceiling</span><input type="range" min={SLOPTIMIZER_CEILING_MIN_DB} max={SLOPTIMIZER_CEILING_MAX_DB} step="0.1" value={settings.ceilingDb} on:input={(event) => updateAdvanced(event, 'ceilingDb')} /><output>{formatDb(settings.ceilingDb)}</output></label>
    </div>
    <div class="advanced-footer">
      <span>Fixed crossovers: 180 Hz / 3 kHz</span>
      <button on:click={resetMapping} disabled={!settings.customized} title="Restore the stock macro mapping at the current Slop value">
        <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span> Reset mapping
      </button>
    </div>
  {/if}
</div>

<style>
  .sloptimizer-editor { display: grid; gap: 8px; padding: 2px; }
  .mode-row { display: flex; align-items: center; gap: 3px; }
  .mode-row button,
  .advanced-footer button { min-height: 24px; padding: 3px 8px; border: 1px solid var(--border-faint); border-radius: 4px; background: transparent; color: var(--muted-strong); }
  .mode-row button:hover,
  .mode-row button.active,
  .advanced-footer button:hover:not(:disabled) { border-color: var(--accent-strong); background: var(--hover-surface); color: var(--text-strong); }
  .mode-row button.active { color: var(--accent-strong); }
  .customized { margin-left: auto; color: var(--accent-strong); font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; }
  .slop-control,
  .advanced-grid label { min-width: 0; display: grid; grid-template-columns: 55px minmax(80px, 1fr) 55px; align-items: center; gap: 7px; color: var(--muted); font-size: 10px; }
  .slop-control { grid-template-columns: 35px minmax(100px, 1fr) 42px; }
  input[type='range'] { width: 100%; accent-color: var(--accent-strong); }
  output { color: var(--text-strong); text-align: right; font-variant-numeric: tabular-nums; }
  .control-name { color: var(--text-strong); font-weight: 700; }
  .advanced-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 14px; padding-top: 2px; }
  .advanced-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--muted); font-size: 9px; }
  .advanced-footer button { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; }
  .advanced-footer button:disabled { opacity: 0.4; }
  .advanced-footer .material-symbols-outlined { font-size: 14px; }
  @container (max-width: 360px) {
    .advanced-grid { grid-template-columns: 1fr; }
    .advanced-footer { align-items: flex-start; flex-direction: column; }
  }
</style>
