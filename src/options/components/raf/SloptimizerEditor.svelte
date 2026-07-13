<script lang="ts">
  import {
    SLOPTIMIZER_CEILING_MAX_DB,
    SLOPTIMIZER_CEILING_MIN_DB,
    SLOPTIMIZER_DENSITY_MAX,
    SLOPTIMIZER_DENSITY_MIN,
    SLOPTIMIZER_HIGH_CROSSOVER_MAX_HZ,
    SLOPTIMIZER_HIGH_CROSSOVER_MIN_HZ,
    SLOPTIMIZER_LIFT_MAX_DB,
    SLOPTIMIZER_LIFT_MIN_DB,
    SLOPTIMIZER_LOW_CROSSOVER_MAX_HZ,
    SLOPTIMIZER_LOW_CROSSOVER_MIN_HZ,
    SLOPTIMIZER_SLOP_MAX,
    SLOPTIMIZER_SLOP_MIN,
    SLOPTIMIZER_SPEED_MAX,
    SLOPTIMIZER_SPEED_MIN,
    mapSlopToParameters
  } from '$lib/services/raf-effects/sloptimizer';
  import { rafSettings } from '$lib/stores/raf-settings';
  import type { RafSloptimizerSettings } from '$lib/types';

  export let settings: RafSloptimizerSettings;

  type AdvancedKey = 'lowLiftDb' | 'midLiftDb' | 'highLiftDb' | 'lowCrossoverHz' | 'highCrossoverHz' | 'density' | 'speed' | 'ceilingDb';

  function updateSlop(event: Event) {
    const slop = (event.currentTarget as HTMLInputElement).valueAsNumber;
    update({
      slop,
      customized: false,
      ...mapSlopToParameters(slop)
    });
  }

  function updateAdvanced(event: Event, key: AdvancedKey) {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
    const crossover = key === 'lowCrossoverHz' || key === 'highCrossoverHz';
    update(crossover ? { [key]: value } : { [key]: value, customized: true });
  }

  function resetMapping() {
    update({
      customized: false,
      ...mapSlopToParameters(settings.slop)
    });
  }

  function update(changes: Partial<RafSloptimizerSettings>) {
    rafSettings.updateEffect(settings.id, (effect) => effect.type === 'sloptimizer' ? { ...effect, ...changes } : effect);
  }

  function formatDb(value: number): string {
    return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
  }

  function formatFrequency(value: number): string {
    return value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} kHz` : `${value.toFixed(0)} Hz`;
  }
</script>

<div class="sloptimizer-editor">
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
    <div class="crossover-section">
      <span class="section-label">Crossovers <span>(not Slop-mapped)</span></span>
      <div class="crossover-grid">
        <label><span>Low / mid</span><input type="range" min={SLOPTIMIZER_LOW_CROSSOVER_MIN_HZ} max={SLOPTIMIZER_LOW_CROSSOVER_MAX_HZ} step="5" value={settings.lowCrossoverHz} on:input={(event) => updateAdvanced(event, 'lowCrossoverHz')} aria-label="Low to mid crossover frequency" /><output>{formatFrequency(settings.lowCrossoverHz)}</output></label>
        <label><span>Mid / high</span><input type="range" min={SLOPTIMIZER_HIGH_CROSSOVER_MIN_HZ} max={SLOPTIMIZER_HIGH_CROSSOVER_MAX_HZ} step="100" value={settings.highCrossoverHz} on:input={(event) => updateAdvanced(event, 'highCrossoverHz')} aria-label="Mid to high crossover frequency" /><output>{formatFrequency(settings.highCrossoverHz)}</output></label>
      </div>
    </div>
    <div class="advanced-footer">
      <span>Stock crossovers: 180 Hz / 3 kHz</span>
      <button on:click={resetMapping} disabled={!settings.customized} title="Restore the stock macro mapping at the current Slop value">
        <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span> Reset mapping
      </button>
    </div>
  {/if}
</div>

<style>
  .sloptimizer-editor { display: grid; gap: 8px; padding: 2px; }
  .advanced-footer button { min-height: 24px; padding: 3px 8px; border: 1px solid var(--border-faint); border-radius: 4px; background: transparent; color: var(--muted-strong); }
  .advanced-footer button:hover:not(:disabled) { border-color: var(--accent-strong); background: var(--hover-surface); color: var(--text-strong); }
  .slop-control,
  .advanced-grid label,
  .crossover-grid label { min-width: 0; display: grid; grid-template-columns: 58px minmax(80px, 1fr) 58px; align-items: center; gap: 7px; color: var(--muted); font-size: 10px; }
  .slop-control { grid-template-columns: 35px minmax(100px, 1fr) 42px; }
  input[type='range'] { width: 100%; accent-color: var(--accent-strong); }
  output { color: var(--text-strong); text-align: right; font-variant-numeric: tabular-nums; }
  .control-name { color: var(--text-strong); font-weight: 700; }
  .advanced-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 14px; padding-top: 2px; }
  .crossover-section { display: grid; gap: 6px; padding-top: 3px; border-top: 1px solid var(--border-faint); }
  .section-label { color: var(--text-strong); font-size: 10px; font-weight: 700; }
  .section-label span { color: var(--muted); font-weight: 400; }
  .crossover-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px 14px; }
  .advanced-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--muted); font-size: 9px; }
  .advanced-footer button { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; }
  .advanced-footer button:disabled { opacity: 0.4; }
  .advanced-footer .material-symbols-outlined { font-size: 14px; }
  @container (max-width: 360px) {
    .advanced-grid,
    .crossover-grid { grid-template-columns: 1fr; }
    .advanced-footer { align-items: flex-start; flex-direction: column; }
  }
</style>
