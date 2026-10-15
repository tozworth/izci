<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import ThemedSelect from '$lib/components/options/ThemedSelect.svelte';
  import { DEFAULT_MODULE_PLAYBACK_SETTINGS, MODULE_INTERPOLATION_OPTIONS, MODULE_RAMPING_OPTIONS, modulePlaybackSettings } from '$lib/stores/module-playback-settings';

  let pendingStereoSeparation: number | null = null;
  let pendingPanStrength: number | null = null;
  function formatFactor(value: number) { return `${Math.round(value * 100)}% (${value.toFixed(2)}x)`; }
  function handleRepeatCountChange(event: CustomEvent<string>) { modulePlaybackSettings.update({ repeatCount: Number(event.detail) }); }
  function handleRampingChange(event: CustomEvent<string>) {
    const ramping = MODULE_RAMPING_OPTIONS.find((value) => value === event.detail);
    if (ramping) modulePlaybackSettings.update({ ramping });
  }
  function handleRampingDurationChange(event: Event) {
    modulePlaybackSettings.update({ hivelyRampingMs: (event.currentTarget as HTMLInputElement).valueAsNumber });
  }
  function rampingLabel(value: string): string {
    if (value === 'off') return $t('options.modules.ramping.options.off', { default: 'Off' });
    if (value === 'short') return $t('options.modules.ramping.options.short', { default: 'Short' });
    if (value === 'long') return $t('options.modules.ramping.options.long', { default: 'Long' });
    return $t('options.modules.ramping.options.normal', { default: 'Normal' });
  }
  function handleInterpolationChange(event: CustomEvent<string>) {
    const value = Number(event.detail);
    modulePlaybackSettings.update({ interpolationFilter: value === 1 || value === 2 || value === 4 || value === 8 ? value : DEFAULT_MODULE_PLAYBACK_SETTINGS.interpolationFilter });
  }
  function handleRangeSettingChange(event: Event, key: 'tempoFactor' | 'pitchFactor') {
    modulePlaybackSettings.update({ [key]: (event.currentTarget as HTMLInputElement).valueAsNumber / 100 });
  }
  function handleDeferredRangeInput(event: Event, key: 'stereoSeparation' | 'panStrength') {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
    if (key === 'stereoSeparation') pendingStereoSeparation = value; else pendingPanStrength = value;
  }
  function commitDeferredRangeSetting(event: Event, key: 'stereoSeparation' | 'panStrength') {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
    if (key === 'stereoSeparation') pendingStereoSeparation = null; else pendingPanStrength = null;
    if (modulePlaybackSettings.getSnapshot()[key] !== value) modulePlaybackSettings.update({ [key]: value });
  }
  function interpolationLabel(value: number): string {
    if (value === 1) return $t('options.modules.interpolation.options.oneTap', { default: '1-tap (minimal)' });
    if (value === 2) return $t('options.modules.interpolation.options.twoTap', { default: '2-tap (soft)' });
    if (value === 4) return $t('options.modules.interpolation.options.fourTap', { default: '4-tap (medium)' });
    return $t('options.modules.interpolation.options.eightTap', { default: '8-tap (high)' });
  }
  function interpolationHint(value: number): string {
    if (value === 1) return $t('options.modules.interpolation.hints.oneTap', { default: 'Minimal smoothing (sharper, more artifacts)' });
    if (value === 2) return $t('options.modules.interpolation.hints.twoTap', { default: 'Soft smoothing.' });
    if (value === 4) return $t('options.modules.interpolation.hints.fourTap', { default: 'Medium smoothing.' });
    return $t('options.modules.interpolation.hints.eightTap', { default: 'High smoothing (blurry, less artifacts)' });
  }
  $: interpolationOption = MODULE_INTERPOLATION_OPTIONS.find((option) => option.value === $modulePlaybackSettings.interpolationFilter) ?? MODULE_INTERPOLATION_OPTIONS[0];
  $: repeatCountSelectValue = $modulePlaybackSettings.repeatCount === -1 ? '-1' : '0';
  $: stereoSeparationValue = pendingStereoSeparation ?? $modulePlaybackSettings.stereoSeparation;
  $: panStrengthValue = pendingPanStrength ?? $modulePlaybackSettings.panStrength;
</script>

<article class="view">
  <div class="section">
    <h2>{$t('options.modules.rendering.heading', { default: 'Rendering' })}</h2>
    <div class="field-grid">
      <SettingsField title={$t('options.modules.stereoSeparation.title', { default: 'Stereo separation (MOD)' })}>
          <input
            type="range"
            min="0"
            max="200"
            step="1"
            value={stereoSeparationValue}
            on:input={(event) => handleDeferredRangeInput(event, 'stereoSeparation')}
            on:change={(event) => commitDeferredRangeSetting(event, 'stereoSeparation')}
            on:blur={(event) => commitDeferredRangeSetting(event, 'stereoSeparation')}
          />
          <span class="field-output">{stereoSeparationValue}%</span>
        <svelte:fragment slot="hint">{$t('options.modules.stereoSeparation.hintBeforeFormat', { default: 'Applies to' })} <code>MOD</code> {$t('options.modules.stereoSeparation.hintAfterFormat', { default: 'files. 0 = mono, 200 = hard stereo.' })}</svelte:fragment>
      </SettingsField>

      <SettingsField title={$t('options.modules.panStrength.title', { default: 'Pan strength' })} hint={$t('options.modules.panStrength.hint', { default: 'Below 100 narrows the image, above 100 widens it.' })}>
          <input
            type="range"
            min="0"
            max="200"
            step="1"
            value={panStrengthValue}
            on:input={(event) => handleDeferredRangeInput(event, 'panStrength')}
            on:change={(event) => commitDeferredRangeSetting(event, 'panStrength')}
            on:blur={(event) => commitDeferredRangeSetting(event, 'panStrength')}
          />
          <span class="field-output">{panStrengthValue}%</span>
      </SettingsField>

      <SettingsField title={$t('options.modules.interpolation.title', { default: 'Interpolation' })} hint={interpolationHint(interpolationOption.value)}>
          <ThemedSelect
            value={String($modulePlaybackSettings.interpolationFilter)}
            options={MODULE_INTERPOLATION_OPTIONS.map((option) => ({ value: String(option.value), label: interpolationLabel(option.value) }))}
            label={$t('options.modules.interpolation.title', { default: 'Interpolation' })}
            on:change={handleInterpolationChange}
          />
      </SettingsField>

      <SettingsField title={$t('options.modules.ramping.title', { default: 'Ramping' })} hint={$t('options.modules.ramping.hint', { default: 'Smooths abrupt note, volume, and panning transitions. Longer ramps soften attacks; timing varies by decoder.' })}>
        <ThemedSelect
          value={$modulePlaybackSettings.ramping}
          options={MODULE_RAMPING_OPTIONS.map((value) => ({ value, label: rampingLabel(value) }))}
          label={$t('options.modules.ramping.title', { default: 'Ramping' })}
          on:change={handleRampingChange}
        />
      </SettingsField>

      <SettingsField title={$t('options.modules.hivelyRampingMs.title', { default: 'Hively ramp duration (ms)' })} hint={$t('options.modules.hivelyRampingMs.hint', { default: 'AHX/HVL duration at Normal ramping, independent of tempo. Short halves it; Long doubles it.' })} advanced>
        <input type="range" min="1" max="20" step="0.1" value={$modulePlaybackSettings.hivelyRampingMs} disabled={$modulePlaybackSettings.ramping === 'off'} on:input={handleRampingDurationChange} />
        <span class="field-output">{$modulePlaybackSettings.hivelyRampingMs.toFixed(1)} ms</span>
      </SettingsField>
    </div>
  </div>

  <div class="section">
    <h2>{$t('options.modules.playback.heading', { default: 'Playback' })}</h2>
    <div class="field-grid">
      <SettingsField title={$t('options.modules.looping.title', { default: 'Looping' })} hint={$t('options.modules.looping.hint', { default: 'Maps to libopenmpt repeat count.' })}>
          <ThemedSelect
            value={repeatCountSelectValue}
            options={[
              { value: '0', label: $t('options.modules.looping.once', { default: 'Play once' }) },
              { value: '-1', label: $t('options.modules.looping.forever', { default: 'Loop forever' }) }
            ]}
            label={$t('options.modules.looping.title', { default: 'Looping' })}
            on:change={handleRepeatCountChange}
          />
      </SettingsField>

      <SettingsField title={$t('options.modules.tempoFactor.title', { default: 'Tempo factor' })} hint={$t('options.modules.tempoFactor.hint', { default: 'Changes module playback speed without changing pitch, including AHX and HivelyTracker.' })}>
          <input
            type="range"
            min="25"
            max="400"
            step="1"
            value={Math.round($modulePlaybackSettings.tempoFactor * 100)}
            on:input={(event) => handleRangeSettingChange(event, 'tempoFactor')}
          />
          <span class="field-output">{formatFactor($modulePlaybackSettings.tempoFactor)}</span>
      </SettingsField>

      <SettingsField title={$t('options.modules.pitchFactor.title', { default: 'Pitch factor' })} hint={$t('options.modules.pitchFactor.hint', { default: "Adjusts playback pitch relative to the module's original tuning, including AHX and HivelyTracker." })}>
          <input
            type="range"
            min="25"
            max="400"
            step="1"
            value={Math.round($modulePlaybackSettings.pitchFactor * 100)}
            on:input={(event) => handleRangeSettingChange(event, 'pitchFactor')}
          />
          <span class="field-output">{formatFactor($modulePlaybackSettings.pitchFactor)}</span>
      </SettingsField>
    </div>
  </div>
</article>
