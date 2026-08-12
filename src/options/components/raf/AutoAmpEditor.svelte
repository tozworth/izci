<script lang="ts">
  import { t } from 'svelte-i18n';
  import { rafAutoAmpGains } from '$lib/services/raf-auto-amp-meter';
  import {
    AUTO_AMP_BOOST_MAX_DB,
    AUTO_AMP_GAIN_MAX_DB,
    AUTO_AMP_GAIN_MIN_DB,
    AUTO_AMP_LOOKAHEAD_MAX_MS,
    AUTO_AMP_LOOKAHEAD_MIN_MS,
    AUTO_AMP_PEAK_HOLD_MAX_SECONDS,
    AUTO_AMP_RECOVERY_MAX_DB_PER_SECOND,
    AUTO_AMP_RECOVERY_MIN_DB_PER_SECOND,
    AUTO_AMP_REDUCTION_MAX_DB,
    AUTO_AMP_TARGET_MAX_DB,
    AUTO_AMP_TARGET_MIN_DB
  } from '$lib/services/raf-effects/auto-amp';
  import { rafSettings } from '$lib/stores/raf-settings';
  import type { RafAutoAmpMode, RafAutoAmpSettings } from '$lib/contracts/raf';

  export let settings: RafAutoAmpSettings;

  type NumericKey =
    | 'gainDb'
    | 'targetDb'
    | 'maximumReductionDb'
    | 'maximumBoostDb'
    | 'peakHoldSeconds'
    | 'recoveryDbPerSecond'
    | 'lookaheadMs';

  function update(changes: Partial<RafAutoAmpSettings>) {
    rafSettings.updateEffect(settings.id, (effect) => effect.type === 'auto-amp' ? { ...effect, ...changes } : effect);
  }

  function updateMode(mode: RafAutoAmpMode) {
    update({ mode });
  }

  function updateNumber(event: Event, key: NumericKey) {
    update({ [key]: (event.currentTarget as HTMLInputElement).valueAsNumber });
  }

  function formatDb(value: number): string {
    return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
  }

  $: automatic = settings.mode !== 'off';
  $: appliedGainDb = automatic ? ($rafAutoAmpGains[settings.id] ?? 0) : settings.gainDb;
</script>

<div class="auto-amp-editor">
  <div class="primary-controls">
    <div class="mode-control">
      <span>{$t('options.raf.autoAmp.mode', { default: 'Auto' })}</span>
      <div class="mode-switch" role="group" aria-label={$t('options.raf.autoAmp.mode', { default: 'Auto' })}>
        <button class:active={settings.mode === 'off'} aria-pressed={settings.mode === 'off'} on:click={() => updateMode('off')}>{$t('options.raf.autoAmp.modes.off', { default: 'Off' })}</button>
        <button class:active={settings.mode === 'reduce'} aria-pressed={settings.mode === 'reduce'} on:click={() => updateMode('reduce')}>{$t('options.raf.autoAmp.modes.reduce', { default: 'Reduce' })}</button>
        <button class:active={settings.mode === 'increase'} aria-pressed={settings.mode === 'increase'} on:click={() => updateMode('increase')}>{$t('options.raf.autoAmp.modes.increase', { default: 'Increase' })}</button>
        <button class:active={settings.mode === 'dynamic'} aria-pressed={settings.mode === 'dynamic'} on:click={() => updateMode('dynamic')}>{$t('options.raf.autoAmp.modes.dynamic', { default: 'Dynamic' })}</button>
      </div>
    </div>

    <label class="gain-control">
      <span>{automatic ? $t('options.raf.autoAmp.appliedGain', { default: 'Applied gain' }) : $t('options.raf.autoAmp.gain', { default: 'Gain' })}</span>
      <input
        type="range"
        min={AUTO_AMP_GAIN_MIN_DB}
        max={AUTO_AMP_GAIN_MAX_DB}
        step="0.1"
        value={appliedGainDb}
        disabled={automatic}
        on:input={(event) => updateNumber(event, 'gainDb')}
      />
      <output>{formatDb(appliedGainDb)}</output>
    </label>
  </div>

  {#if automatic}
    <div class="automatic-controls">
      <label>
        <span>{$t('options.raf.autoAmp.targetPeak', { default: 'Target peak' })}</span>
        <input type="range" min={AUTO_AMP_TARGET_MIN_DB} max={AUTO_AMP_TARGET_MAX_DB} step="0.1" value={settings.targetDb} on:input={(event) => updateNumber(event, 'targetDb')} />
        <output>{formatDb(settings.targetDb)}</output>
      </label>
      {#if settings.mode === 'reduce' || settings.mode === 'dynamic'}
        <label>
          <span>{$t('options.raf.autoAmp.maxReduction', { default: 'Max reduction' })}</span>
          <input type="range" min="0" max={AUTO_AMP_REDUCTION_MAX_DB} step="0.5" value={settings.maximumReductionDb} on:input={(event) => updateNumber(event, 'maximumReductionDb')} />
          <output>−{settings.maximumReductionDb.toFixed(1)} dB</output>
        </label>
      {/if}
      {#if settings.mode === 'increase' || settings.mode === 'dynamic'}
        <label>
          <span>{$t('options.raf.autoAmp.maxBoost', { default: 'Max boost' })}</span>
          <input type="range" min="0" max={AUTO_AMP_BOOST_MAX_DB} step="0.5" value={settings.maximumBoostDb} on:input={(event) => updateNumber(event, 'maximumBoostDb')} />
          <output>+{settings.maximumBoostDb.toFixed(1)} dB</output>
        </label>
      {/if}
      <label>
        <span>{$t('options.raf.autoAmp.peakHold', { default: 'Peak hold' })}</span>
        <input type="range" min="0" max={AUTO_AMP_PEAK_HOLD_MAX_SECONDS} step="0.25" value={settings.peakHoldSeconds} on:input={(event) => updateNumber(event, 'peakHoldSeconds')} />
        <output>{settings.peakHoldSeconds.toFixed(2)} s</output>
      </label>
      <label>
        <span>{$t('options.raf.autoAmp.recovery', { default: 'Recovery' })}</span>
        <input type="range" min={AUTO_AMP_RECOVERY_MIN_DB_PER_SECOND} max={AUTO_AMP_RECOVERY_MAX_DB_PER_SECOND} step="0.25" value={settings.recoveryDbPerSecond} on:input={(event) => updateNumber(event, 'recoveryDbPerSecond')} />
        <output>{settings.recoveryDbPerSecond.toFixed(2)} dB/s</output>
      </label>
      <label>
        <span>{$t('options.raf.autoAmp.lookahead', { default: 'Lookahead' })}</span>
        <input type="range" min={AUTO_AMP_LOOKAHEAD_MIN_MS} max={AUTO_AMP_LOOKAHEAD_MAX_MS} step="10" value={settings.lookaheadMs} on:input={(event) => updateNumber(event, 'lookaheadMs')} />
        <output>{settings.lookaheadMs.toFixed(0)} ms</output>
      </label>
    </div>
  {/if}
</div>

<style>
  .auto-amp-editor { display: grid; gap: 12px; padding: 2px; }
  .primary-controls { display: grid; grid-template-columns: minmax(260px, 0.8fr) minmax(220px, 1fr); gap: 14px; align-items: end; }
  .mode-control { display: grid; grid-template-columns: 42px minmax(200px, 1fr); align-items: center; gap: 7px; }
  .mode-control span,
  .gain-control > span,
  .automatic-controls label > span { color: var(--text-strong); font-size: 10px; font-weight: 700; }
  .mode-switch { min-width: 0; display: inline-flex; border: 1px solid var(--border-faint); border-radius: 999px; overflow: hidden; }
  .mode-switch button { min-width: 0; min-height: 24px; padding: 2px 8px; flex: 1 1 auto; border-radius: 0; background: transparent; color: var(--muted-strong); font-size: 10px; white-space: nowrap; }
  .mode-switch button + button { border-left: 1px solid var(--border-faint); }
  .mode-switch button.active { background: var(--accent); color: var(--accent-text, #fff); }
  .mode-switch button:hover:not(.active) { background: var(--hover-surface); color: var(--text-strong); }
  .gain-control,
  .automatic-controls label { min-width: 0; display: grid; grid-template-columns: 76px minmax(80px, 1fr) 68px; align-items: center; gap: 7px; }
  .automatic-controls { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px 14px; padding-top: 11px; border-top: 1px solid var(--border-faint); }
  input[type='range'] { width: 100%; min-width: 0; accent-color: var(--accent-strong); }
  input[type='range']:disabled { opacity: 0.72; }
  output { color: var(--text-strong); font-size: 10px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  @container (max-width: 600px) {
    .primary-controls,
    .automatic-controls { grid-template-columns: 1fr; }
  }
</style>
