<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { t } from 'svelte-i18n';
  import { RAF_EFFECT_DEFINITIONS, RAF_EFFECT_REGISTRY } from '$lib/services/raf-effect-registry';
  import {
    AUTO_AMP_BOOST_MAX_DB,
    AUTO_AMP_GAIN_MAX_DB,
    AUTO_AMP_GAIN_MIN_DB,
    AUTO_AMP_REDUCTION_MAX_DB,
    AUTO_AMP_TARGET_MAX_DB,
    AUTO_AMP_TARGET_MIN_DB
  } from '$lib/services/raf-effects/auto-amp';
  import {
    CRYSTALIZER_FREQUENCIES,
    CRYSTALIZER_INTENSITY_MAX,
    CRYSTALIZER_INTENSITY_MIN
  } from '$lib/services/raf-effects/crystalizer';
  import { GRAPHIC_EQ_FREQUENCIES, RAF_GAIN_MAX_DB, RAF_GAIN_MIN_DB } from '$lib/services/raf-effects/graphic-eq';
  import { STEREO_WIDTH_MAX_DB, STEREO_WIDTH_MIN_DB } from '$lib/services/raf-effects/mid-side';
  import {
    REVERB_DAMPING_MAX_HZ,
    REVERB_DAMPING_MIN_HZ,
    REVERB_DECAY_MAX_SECONDS,
    REVERB_DECAY_MIN_SECONDS,
    REVERB_MIX_MAX,
    REVERB_MIX_MIN,
    REVERB_PRE_DELAY_MAX_MS,
    REVERB_PRE_DELAY_MIN_MS,
    REVERB_ROOM_SIZE_MAX,
    REVERB_ROOM_SIZE_MIN
  } from '$lib/services/raf-effects/reverb';
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
    SLOPTIMIZER_UPWARD_BOOST_MAX_DB,
    SLOPTIMIZER_UPWARD_BOOST_MIN_DB,
    SLOPTIMIZER_UPWARD_RATIO_MAX,
    SLOPTIMIZER_UPWARD_RATIO_MIN,
    SLOPTIMIZER_UPWARD_THRESHOLD_MAX_DB,
    SLOPTIMIZER_UPWARD_THRESHOLD_MIN_DB,
    mapSlopToParameters
  } from '$lib/services/raf-effects/sloptimizer';
  import type {
    RafAutoAmpMode,
    RafAutoAmpSettings,
    RafCrystalizerSettings,
    RafEffectSettings,
    RafEffectType,
    RafGraphicEqSettings,
    RafReverbSettings,
    RafSloptimizerSettings,
    RafStereoWidthSettings
  } from '$lib/types';

  export let busy = false;
  export let previewing = false;
  export let selectionDuration = 0;

  const dispatch = createEventDispatcher<{
    apply: { settings: RafEffectSettings; edgeBlendMs: number };
    preview: { settings: RafEffectSettings; edgeBlendMs: number };
    close: void;
  }>();

  let dialog: HTMLDialogElement;
  let selectedType: RafEffectType = 'graphic-eq';
  let settings: RafEffectSettings = RAF_EFFECT_REGISTRY[selectedType].createDefault('clip-effect');
  let settingsByType = new Map<RafEffectType, RafEffectSettings>();
  let edgeBlendMs = 5;

  function show(type: RafEffectType = selectedType): void {
    selectType(type);
    if (!dialog.open) dialog.showModal();
  }

  function close(): void {
    if (dialog.open) dialog.close();
  }

  function isOpen(): boolean {
    return Boolean(dialog?.open);
  }

  function requestClose(): void {
    if (busy) return;
    dispatch('close');
    close();
  }

  function selectType(type: RafEffectType): void {
    settingsByType.set(selectedType, settings);
    selectedType = type;
    settings = settingsByType.get(type) ?? RAF_EFFECT_REGISTRY[type].createDefault(`clip-effect-${type}`);
  }

  function update(changes: Record<string, unknown>): void {
    settings = { ...settings, ...changes } as RafEffectSettings;
    settingsByType.set(selectedType, settings);
  }

  function updateNumber(event: Event, key: string): void {
    update({ [key]: (event.currentTarget as HTMLInputElement).valueAsNumber });
  }

  function updateEqBand(event: Event, index: number): void {
    if (settings.type !== 'graphic-eq') return;
    const bandGainsDb = [...settings.bandGainsDb];
    bandGainsDb[index] = (event.currentTarget as HTMLInputElement).valueAsNumber;
    update({ bandGainsDb });
  }

  function updateCrystalizerBand(event: Event, index: number): void {
    if (settings.type !== 'crystalizer') return;
    const bandIntensities = [...settings.bandIntensities];
    bandIntensities[index] = (event.currentTarget as HTMLInputElement).valueAsNumber;
    update({ bandIntensities });
  }

  function toggleCrystalizerBand(key: 'bandMuted' | 'bandBypassed', index: number): void {
    if (settings.type !== 'crystalizer') return;
    const values = [...settings[key]];
    values[index] = !values[index];
    update({ [key]: values });
  }

  function updateSlop(event: Event): void {
    const slop = (event.currentTarget as HTMLInputElement).valueAsNumber;
    update({ slop, customized: false, ...mapSlopToParameters(slop) });
  }

  function formatFrequency(value: number): string {
    return value >= 1_000 ? `${Number((value / 1_000).toFixed(1))}k` : `${value}`;
  }

  function formatDb(value: number): string {
    return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
  }

  export { show, close, isOpen };
</script>

<dialog bind:this={dialog} class="clip-effect-dialog" on:cancel|preventDefault={requestClose} on:close={() => dispatch('close')}>
  <div class="effect-dialog-shell">
    <header>
      <div>
        <h2>{$t('clipTag.effects.title', { default: 'Apply Raf Effect' })}</h2>
        <p>{$t('clipTag.effects.subtitle', { default: 'Destructively process the selected audio with one effect.' })}</p>
      </div>
      <button class="icon-button" type="button" disabled={busy} aria-label={$t('clipTag.effects.close', { default: 'Close effects' })} on:click={requestClose}>
        <span class="material-symbols-outlined" aria-hidden="true">close</span>
      </button>
    </header>

    <div class="effect-dialog-body">
      <nav aria-label={$t('clipTag.effects.available', { default: 'Available Raf effects' })}>
        {#each RAF_EFFECT_DEFINITIONS as definition}
          <button class:active={selectedType === definition.type} type="button" on:click={() => selectType(definition.type)}>
            <span class="material-symbols-outlined" aria-hidden="true">{definition.icon}</span>
            <span>{definition.name}</span>
          </button>
        {/each}
      </nav>

      <section class="effect-settings" aria-live="polite">
        <div class="effect-heading">
          <span class="material-symbols-outlined" aria-hidden="true">{RAF_EFFECT_REGISTRY[selectedType].icon}</span>
          <div><strong>{RAF_EFFECT_REGISTRY[selectedType].name}</strong><small>{selectionDuration.toFixed(3)} s {$t('clipTag.effects.selection', { default: 'selection' })}</small></div>
          <button class="text-button" type="button" disabled={busy} on:click={() => { settings = RAF_EFFECT_REGISTRY[selectedType].createDefault(`clip-effect-${selectedType}`); settingsByType.set(selectedType, settings); }}>
            <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>{$t('clipTag.effects.defaults', { default: 'Defaults' })}
          </button>
        </div>

        {#if settings.type === 'auto-amp'}
          {@const autoAmp = settings as RafAutoAmpSettings}
          <div class="setting-grid">
            <label class="wide"><span>{$t('clipTag.effects.autoAmp.mode', { default: 'Mode' })}</span><select value={autoAmp.mode} on:change={(event) => update({ mode: event.currentTarget.value as RafAutoAmpMode })}><option value="off">{$t('clipTag.effects.autoAmp.manual', { default: 'Manual gain' })}</option><option value="reduce">{$t('clipTag.effects.autoAmp.reduce', { default: 'Reduce only' })}</option><option value="increase">{$t('clipTag.effects.autoAmp.increase', { default: 'Increase only' })}</option><option value="dynamic">{$t('clipTag.effects.autoAmp.dynamic', { default: 'Reduce or increase' })}</option></select></label>
            {#if autoAmp.mode === 'off'}
              <label><span>{$t('clipTag.effects.autoAmp.gain', { default: 'Gain' })}</span><input type="range" min={AUTO_AMP_GAIN_MIN_DB} max={AUTO_AMP_GAIN_MAX_DB} step="0.1" value={autoAmp.gainDb} on:input={(event) => updateNumber(event, 'gainDb')} /><output>{formatDb(autoAmp.gainDb)}</output></label>
            {:else}
              <label><span>{$t('clipTag.effects.autoAmp.target', { default: 'Target peak' })}</span><input type="range" min={AUTO_AMP_TARGET_MIN_DB} max={AUTO_AMP_TARGET_MAX_DB} step="0.1" value={autoAmp.targetDb} on:input={(event) => updateNumber(event, 'targetDb')} /><output>{formatDb(autoAmp.targetDb)}</output></label>
              {#if autoAmp.mode === 'reduce' || autoAmp.mode === 'dynamic'}<label><span>{$t('clipTag.effects.autoAmp.reduction', { default: 'Max reduction' })}</span><input type="range" min="0" max={AUTO_AMP_REDUCTION_MAX_DB} step="0.5" value={autoAmp.maximumReductionDb} on:input={(event) => updateNumber(event, 'maximumReductionDb')} /><output>−{autoAmp.maximumReductionDb.toFixed(1)} dB</output></label>{/if}
              {#if autoAmp.mode === 'increase' || autoAmp.mode === 'dynamic'}<label><span>{$t('clipTag.effects.autoAmp.boost', { default: 'Max boost' })}</span><input type="range" min="0" max={AUTO_AMP_BOOST_MAX_DB} step="0.5" value={autoAmp.maximumBoostDb} on:input={(event) => updateNumber(event, 'maximumBoostDb')} /><output>+{autoAmp.maximumBoostDb.toFixed(1)} dB</output></label>{/if}
              <p class="effect-note wide">{$t('clipTag.effects.autoAmp.scanNote', { default: 'Offline Auto Amp scans the whole selection and applies one stable gain.' })}</p>
            {/if}
          </div>
        {:else if settings.type === 'graphic-eq'}
          {@const equalizer = settings as RafGraphicEqSettings}
          <div class="vertical-bank equalizer-bank">
            <label><output>{equalizer.preampDb > 0 ? '+' : ''}{equalizer.preampDb.toFixed(1)}</output><input type="range" min={RAF_GAIN_MIN_DB} max={RAF_GAIN_MAX_DB} step="0.5" value={equalizer.preampDb} on:input={(event) => updateNumber(event, 'preampDb')} /><span>Pre</span></label>
            {#each GRAPHIC_EQ_FREQUENCIES as frequency, index}<label><output>{equalizer.bandGainsDb[index] > 0 ? '+' : ''}{equalizer.bandGainsDb[index].toFixed(1)}</output><input type="range" min={RAF_GAIN_MIN_DB} max={RAF_GAIN_MAX_DB} step="0.5" value={equalizer.bandGainsDb[index]} on:input={(event) => updateEqBand(event, index)} /><span>{formatFrequency(frequency)}</span></label>{/each}
          </div>
        {:else if settings.type === 'stereo-width'}
          {@const stereo = settings as RafStereoWidthSettings}
          <div class="setting-grid single"><label><span>{$t('clipTag.effects.stereo.width', { default: 'Stereo width' })}</span><input type="range" min={STEREO_WIDTH_MIN_DB} max={STEREO_WIDTH_MAX_DB} step="0.5" value={stereo.widthDb} on:input={(event) => updateNumber(event, 'widthDb')} /><output>{formatDb(stereo.widthDb)}</output></label></div>
        {:else if settings.type === 'crystalizer'}
          {@const crystalizer = settings as RafCrystalizerSettings}
          <div class="vertical-bank crystalizer-bank">
            {#each CRYSTALIZER_FREQUENCIES as frequency, index}
              <div class="band-control" class:inactive={crystalizer.bandMuted[index] || crystalizer.bandBypassed[index]}>
                <div class="band-switches"><button class:active={crystalizer.bandMuted[index]} type="button" on:click={() => toggleCrystalizerBand('bandMuted', index)} aria-label={$t('options.raf.crystalizer.muteBand', { default: 'Mute {frequency} Hz band', values: { frequency } })}>M</button><button class:active={crystalizer.bandBypassed[index]} type="button" on:click={() => toggleCrystalizerBand('bandBypassed', index)} aria-label={$t('options.raf.crystalizer.bypassBand', { default: 'Bypass {frequency} Hz band', values: { frequency } })}>B</button></div>
                <label><output>{crystalizer.bandIntensities[index] > 0 ? '+' : ''}{crystalizer.bandIntensities[index].toFixed(0)}</output><input type="range" min={CRYSTALIZER_INTENSITY_MIN} max={CRYSTALIZER_INTENSITY_MAX} step="1" value={crystalizer.bandIntensities[index]} disabled={crystalizer.bandMuted[index] || crystalizer.bandBypassed[index]} on:input={(event) => updateCrystalizerBand(event, index)} /><span>{formatFrequency(frequency)}</span></label>
              </div>
            {/each}
          </div>
        {:else if settings.type === 'sloptimizer'}
          {@const sloptimizer = settings as RafSloptimizerSettings}
          <div class="setting-grid">
            <label class="wide"><span>{$t('clipTag.effects.sloptimizer.slop', { default: 'Slop' })}</span><input type="range" min={SLOPTIMIZER_SLOP_MIN} max={SLOPTIMIZER_SLOP_MAX} step="1" value={sloptimizer.slop} on:input={updateSlop} /><output>{sloptimizer.slop.toFixed(0)}%</output></label>
            <label class="advanced-toggle wide"><span>{$t('clipTag.effects.sloptimizer.advanced', { default: 'Advanced controls' })}</span><input type="checkbox" checked={sloptimizer.advanced} on:change={(event) => update({ advanced: event.currentTarget.checked })} /></label>
            {#if sloptimizer.advanced}
              <label><span>{$t('clipTag.effects.sloptimizer.low', { default: 'Low lift' })}</span><input type="range" min={SLOPTIMIZER_LIFT_MIN_DB} max={SLOPTIMIZER_LIFT_MAX_DB} step="0.1" value={sloptimizer.lowLiftDb} on:input={(event) => updateNumber(event, 'lowLiftDb')} /><output>{formatDb(sloptimizer.lowLiftDb)}</output></label>
              <label><span>{$t('clipTag.effects.sloptimizer.mid', { default: 'Mid lift' })}</span><input type="range" min={SLOPTIMIZER_LIFT_MIN_DB} max={SLOPTIMIZER_LIFT_MAX_DB} step="0.1" value={sloptimizer.midLiftDb} on:input={(event) => updateNumber(event, 'midLiftDb')} /><output>{formatDb(sloptimizer.midLiftDb)}</output></label>
              <label><span>{$t('clipTag.effects.sloptimizer.high', { default: 'High lift' })}</span><input type="range" min={SLOPTIMIZER_LIFT_MIN_DB} max={SLOPTIMIZER_LIFT_MAX_DB} step="0.1" value={sloptimizer.highLiftDb} on:input={(event) => updateNumber(event, 'highLiftDb')} /><output>{formatDb(sloptimizer.highLiftDb)}</output></label>
              <label><span>{$t('clipTag.effects.sloptimizer.density', { default: 'Density' })}</span><input type="range" min={SLOPTIMIZER_DENSITY_MIN} max={SLOPTIMIZER_DENSITY_MAX} step="1" value={sloptimizer.density} on:input={(event) => updateNumber(event, 'density')} /><output>{sloptimizer.density.toFixed(0)}%</output></label>
              <label><span>{$t('clipTag.effects.sloptimizer.speed', { default: 'Speed' })}</span><input type="range" min={SLOPTIMIZER_SPEED_MIN} max={SLOPTIMIZER_SPEED_MAX} step="1" value={sloptimizer.speed} on:input={(event) => updateNumber(event, 'speed')} /><output>{sloptimizer.speed.toFixed(0)}%</output></label>
              <label><span>{$t('clipTag.effects.sloptimizer.upwardRatio', { default: 'Upward ratio' })}</span><input type="range" min={SLOPTIMIZER_UPWARD_RATIO_MIN} max={SLOPTIMIZER_UPWARD_RATIO_MAX} step="0.1" value={sloptimizer.upwardRatio} on:input={(event) => updateNumber(event, 'upwardRatio')} /><output>{sloptimizer.upwardRatio.toFixed(1)}:1</output></label>
              <label><span>{$t('clipTag.effects.sloptimizer.upwardThreshold', { default: 'Upward threshold' })}</span><input type="range" min={SLOPTIMIZER_UPWARD_THRESHOLD_MIN_DB} max={SLOPTIMIZER_UPWARD_THRESHOLD_MAX_DB} step="0.5" value={sloptimizer.upwardThresholdDb} on:input={(event) => updateNumber(event, 'upwardThresholdDb')} /><output>{formatDb(sloptimizer.upwardThresholdDb)}</output></label>
              <label><span>{$t('clipTag.effects.sloptimizer.upwardRange', { default: 'Upward range' })}</span><input type="range" min={SLOPTIMIZER_UPWARD_BOOST_MIN_DB} max={SLOPTIMIZER_UPWARD_BOOST_MAX_DB} step="0.5" value={sloptimizer.upwardMaximumBoostDb} on:input={(event) => updateNumber(event, 'upwardMaximumBoostDb')} /><output>{formatDb(sloptimizer.upwardMaximumBoostDb)}</output></label>
              <label><span>{$t('clipTag.effects.sloptimizer.ceiling', { default: 'Ceiling' })}</span><input type="range" min={SLOPTIMIZER_CEILING_MIN_DB} max={SLOPTIMIZER_CEILING_MAX_DB} step="0.1" value={sloptimizer.ceilingDb} on:input={(event) => updateNumber(event, 'ceilingDb')} /><output>{formatDb(sloptimizer.ceilingDb)}</output></label>
              <label><span>{$t('clipTag.effects.sloptimizer.lowCrossover', { default: 'Low crossover' })}</span><input type="range" min={SLOPTIMIZER_LOW_CROSSOVER_MIN_HZ} max={SLOPTIMIZER_LOW_CROSSOVER_MAX_HZ} step="5" value={sloptimizer.lowCrossoverHz} on:input={(event) => updateNumber(event, 'lowCrossoverHz')} /><output>{formatFrequency(sloptimizer.lowCrossoverHz)} Hz</output></label>
              <label><span>{$t('clipTag.effects.sloptimizer.highCrossover', { default: 'High crossover' })}</span><input type="range" min={SLOPTIMIZER_HIGH_CROSSOVER_MIN_HZ} max={SLOPTIMIZER_HIGH_CROSSOVER_MAX_HZ} step="100" value={sloptimizer.highCrossoverHz} on:input={(event) => updateNumber(event, 'highCrossoverHz')} /><output>{formatFrequency(sloptimizer.highCrossoverHz)} Hz</output></label>
            {/if}
          </div>
        {:else}
          {@const reverb = settings as RafReverbSettings}
          <div class="setting-grid">
            <label><span>{$t('clipTag.effects.reverb.mix', { default: 'Mix' })}</span><input type="range" min={REVERB_MIX_MIN} max={REVERB_MIX_MAX} step="1" value={reverb.mix} on:input={(event) => updateNumber(event, 'mix')} /><output>{reverb.mix.toFixed(0)}%</output></label>
            <label><span>{$t('clipTag.effects.reverb.room', { default: 'Room size' })}</span><input type="range" min={REVERB_ROOM_SIZE_MIN} max={REVERB_ROOM_SIZE_MAX} step="1" value={reverb.roomSize} on:input={(event) => updateNumber(event, 'roomSize')} /><output>{reverb.roomSize.toFixed(0)}%</output></label>
            <label><span>{$t('clipTag.effects.reverb.decay', { default: 'Decay' })}</span><input type="range" min={REVERB_DECAY_MIN_SECONDS} max={REVERB_DECAY_MAX_SECONDS} step="0.1" value={reverb.decaySeconds} on:input={(event) => updateNumber(event, 'decaySeconds')} /><output>{reverb.decaySeconds.toFixed(1)} s</output></label>
            <label><span>{$t('clipTag.effects.reverb.preDelay', { default: 'Pre-delay' })}</span><input type="range" min={REVERB_PRE_DELAY_MIN_MS} max={REVERB_PRE_DELAY_MAX_MS} step="1" value={reverb.preDelayMs} on:input={(event) => updateNumber(event, 'preDelayMs')} /><output>{reverb.preDelayMs.toFixed(0)} ms</output></label>
            <label><span>{$t('clipTag.effects.reverb.damping', { default: 'Damping' })}</span><input type="range" min={REVERB_DAMPING_MIN_HZ} max={REVERB_DAMPING_MAX_HZ} step="100" value={reverb.dampingHz} on:input={(event) => updateNumber(event, 'dampingHz')} /><output>{formatFrequency(reverb.dampingHz)} Hz</output></label>
          </div>
        {/if}

        <div class="render-options">
          <label><span>{$t('clipTag.effects.edgeBlend', { default: 'Edge blend' })}</span><input type="range" min="0" max="50" step="1" bind:value={edgeBlendMs} /><output>{edgeBlendMs} ms</output></label>
          <p>{$t('clipTag.effects.edgeBlendHint', { default: 'Crossfades the processed region at edit boundaries to prevent clicks.' })}</p>
        </div>
      </section>
    </div>

    <footer>
      <span class="processing-status" aria-live="polite">{busy ? $t('clipTag.effects.rendering', { default: 'Rendering selection...' }) : ''}</span>
      <button class="text-button" type="button" disabled={busy} on:click={() => dispatch('preview', { settings, edgeBlendMs })}><span class="material-symbols-outlined" aria-hidden="true">{previewing ? 'stop' : 'play_arrow'}</span>{previewing ? $t('clipTag.effects.stop', { default: 'Stop' }) : $t('clipTag.effects.preview', { default: 'Preview' })}</button>
      <button class="text-button" type="button" disabled={busy} on:click={requestClose}>{$t('clipTag.effects.cancel', { default: 'Cancel' })}</button>
      <button class="text-button primary" type="button" disabled={busy || selectionDuration <= 0} on:click={() => dispatch('apply', { settings, edgeBlendMs })}><span class="material-symbols-outlined" aria-hidden="true">auto_fix_high</span>{$t('clipTag.effects.apply', { default: 'Apply' })}</button>
    </footer>
  </div>
</dialog>

<style>
  .clip-effect-dialog { width: min(54rem, calc(100vw - 2rem)); max-width: none; height: min(35rem, calc(100vh - 2rem)); max-height: none; padding: 0; overflow: hidden; border: 1px solid var(--border-strong); border-radius: 0.38rem; background: var(--bg-elevated); box-shadow: 0 1.2rem 3.5rem rgb(0 0 0 / 48%); color: var(--text); }
  .clip-effect-dialog::backdrop { background: rgb(0 0 0 / 60%); backdrop-filter: blur(1.5px); }
  .effect-dialog-shell { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; height: 100%; }
  header, footer { display: flex; align-items: center; gap: 0.35rem; padding: 0.48rem 0.6rem; background: var(--window-topbar-bg); }
  header { justify-content: space-between; border-bottom: 1px solid var(--border-soft); }
  h2, p { margin: 0; }
  h2 { color: var(--text-strong); font-size: 0.92rem; font-weight: 650; }
  header p { margin-top: 0.16rem; color: var(--muted); font-size: 0.68rem; }
  .effect-dialog-body { display: grid; grid-template-columns: 10.5rem minmax(0, 1fr); min-height: 0; }
  nav { display: flex; flex-direction: column; gap: 0.08rem; padding: 0.3rem; overflow-y: auto; border-right: 1px solid var(--border-soft); background: color-mix(in srgb, var(--bg-soft) 74%, var(--bg-base)); }
  nav button { display: flex; align-items: center; gap: 0.4rem; min-height: 1.8rem; padding: 0.25rem 0.38rem; border: 1px solid transparent; border-radius: 0.24rem; background: transparent; color: var(--muted); text-align: left; }
  nav button:hover { background: var(--hover-surface); color: var(--text); }
  nav button.active { border-color: var(--accent-focus-border); background: color-mix(in srgb, var(--accent-strong) 10%, var(--bg-soft)); color: var(--text-strong); }
  nav .material-symbols-outlined { font-size: 1.05rem; color: var(--accent-strong); }
  .effect-settings { min-width: 0; min-height: 0; padding: 0.55rem; overflow: auto; background: color-mix(in srgb, var(--bg-elevated) 80%, var(--bg-base)); }
  .effect-heading { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 0.42rem; padding-bottom: 0.48rem; margin-bottom: 0.55rem; border-bottom: 1px solid var(--border-soft); }
  .effect-heading > .material-symbols-outlined { font-size: 1.25rem; color: var(--accent-strong); }
  .effect-heading div { display: grid; gap: 0.1rem; }
  .effect-heading strong { color: var(--text-strong); font-size: 0.8rem; }
  .effect-heading small { color: var(--muted); font-size: 0.64rem; }
  .setting-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; gap: 0.55rem 0.8rem; }
  .setting-grid.single { grid-template-columns: minmax(0, 1fr); }
  .setting-grid label, .render-options label { display: grid; grid-template-columns: 5.8rem minmax(5rem, 1fr) 4.5rem; align-items: center; gap: 0.45rem; color: var(--muted); font-size: 0.68rem; }
  .setting-grid label.wide, .setting-grid .wide { grid-column: 1 / -1; }
  select { min-height: 1.8rem; padding: 0.2rem 0.35rem; border: 1px solid var(--border-soft); border-radius: 0.22rem; background: var(--bg-input); color: var(--text); }
  input[type='range'] { width: 100%; min-width: 0; accent-color: var(--accent-strong); }
  output { color: var(--text-strong); font-size: 0.66rem; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .effect-note { padding: 0.45rem 0.5rem; border: 1px solid var(--border-soft); background: var(--bg-soft); color: var(--muted); font-size: 0.66rem; line-height: 1.35; }
  .vertical-bank { display: grid; gap: 0.18rem; min-width: 0; padding: 0.3rem 0 0.2rem; overflow-x: auto; }
  .equalizer-bank { grid-template-columns: repeat(11, minmax(40px, 1fr)); }
  .crystalizer-bank { grid-template-columns: repeat(13, minmax(40px, 1fr)); }
  .vertical-bank label { display: grid; grid-template-rows: auto 8.5rem auto; justify-items: center; gap: 0.2rem; min-width: 40px; color: var(--muted); font-size: 0.64rem; }
  .vertical-bank input { width: 8.5rem; height: 1rem; margin: 3.75rem -3.75rem; transform: rotate(-90deg); }
  .vertical-bank output { font-size: 0.61rem; }
  .vertical-bank span { font-weight: 600; }
  .band-control { display: grid; grid-template-rows: 1.25rem auto; justify-items: center; min-width: 40px; transition: opacity 120ms ease; }
  .band-control.inactive { opacity: 0.56; }
  .band-switches { display: flex; gap: 0.12rem; }
  .band-switches button { width: 1.05rem; height: 1.05rem; padding: 0; border: 1px solid var(--border-soft); border-radius: 0.18rem; background: transparent; color: var(--muted); font-size: 0.52rem; font-weight: 700; }
  .band-switches button:hover, .band-switches button.active { border-color: var(--accent-strong); background: var(--hover-surface); color: var(--accent-strong); }
  .setting-grid .advanced-toggle { grid-template-columns: 7rem auto; justify-content: start; }
  .advanced-toggle input { width: auto; margin: 0; accent-color: var(--accent-strong); }
  .render-options { display: grid; grid-template-columns: minmax(15rem, 1fr) minmax(12rem, 1fr); align-items: center; gap: 0.65rem; margin-top: 0.7rem; padding: 0.48rem; border: 1px solid var(--border-soft); background: color-mix(in srgb, var(--bg-soft) 72%, transparent); }
  .render-options p { color: var(--muted); font-size: 0.64rem; line-height: 1.35; }
  footer { justify-content: flex-end; border-top: 1px solid var(--border-soft); }
  .processing-status { flex: 1; color: var(--muted); font-size: 0.68rem; }
  .icon-button, .text-button { display: inline-flex; align-items: center; justify-content: center; gap: 0.3rem; min-height: var(--tool-control-height); padding: 0.22rem 0.45rem; border: 1px solid transparent; border-radius: 0.26rem; background: transparent; color: var(--text); }
  .icon-button { width: 1.78rem; padding: 0; }
  .icon-button:hover:not(:disabled), .text-button:hover:not(:disabled) { border-color: var(--border-soft); background: var(--hover-surface); }
  .text-button.primary { border-color: var(--accent-focus-border); background: color-mix(in srgb, var(--accent-strong) 15%, var(--bg-soft)); color: var(--text-strong); }
  button:disabled { opacity: 0.42; }
  .material-symbols-outlined { font-size: 1rem; }
  @media (max-width: 650px) { .effect-dialog-body { grid-template-columns: 7.5rem minmax(0, 1fr); } nav button { font-size: 0.68rem; } .setting-grid { grid-template-columns: 1fr; } .setting-grid label.wide, .setting-grid .wide { grid-column: auto; } .render-options { grid-template-columns: 1fr; } }
</style>
