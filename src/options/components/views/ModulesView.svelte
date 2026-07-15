<script lang="ts">
  import SettingsField from '../SettingsField.svelte';
  import { DEFAULT_MODULE_PLAYBACK_SETTINGS, MODULE_INTERPOLATION_OPTIONS, modulePlaybackSettings } from '$lib/stores/module-playback-settings';

  let pendingStereoSeparation: number | null = null;
  let pendingPanStrength: number | null = null;
  function formatFactor(value: number) { return `${Math.round(value * 100)}% (${value.toFixed(2)}x)`; }
  function handleRepeatCountChange(event: Event) { modulePlaybackSettings.update({ repeatCount: Number((event.currentTarget as HTMLSelectElement).value) }); }
  function handleInterpolationChange(event: Event) {
    const value = Number((event.currentTarget as HTMLSelectElement).value);
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
  $: interpolationOption = MODULE_INTERPOLATION_OPTIONS.find((option) => option.value === $modulePlaybackSettings.interpolationFilter) ?? MODULE_INTERPOLATION_OPTIONS[0];
  $: repeatCountSelectValue = $modulePlaybackSettings.repeatCount === -1 ? '-1' : '0';
  $: stereoSeparationValue = pendingStereoSeparation ?? $modulePlaybackSettings.stereoSeparation;
  $: panStrengthValue = pendingPanStrength ?? $modulePlaybackSettings.panStrength;
</script>

<article class="view">
  <div class="section">
    <h2>Rendering</h2>
    <div class="field-grid">
      <SettingsField title="Stereo separation (MOD)">
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
        <svelte:fragment slot="hint">Applies to <code>MOD</code> files. 0 = mono, 200 = hard stereo.</svelte:fragment>
      </SettingsField>

      <SettingsField title="Pan strength" hint="Below 100 narrows the image, above 100 widens it.">
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

      <SettingsField title="Interpolation" hint={interpolationOption.hint}>
          <select value={$modulePlaybackSettings.interpolationFilter} on:change={handleInterpolationChange}>
            {#each MODULE_INTERPOLATION_OPTIONS as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
      </SettingsField>
    </div>
  </div>

  <div class="section">
    <h2>Playback</h2>
    <div class="field-grid">
      <SettingsField title="Looping" hint="Maps to libopenmpt repeat count.">
          <select value={repeatCountSelectValue} on:change={handleRepeatCountChange}>
            <option value="0">Play once</option>
            <option value="-1">Loop forever</option>
          </select>
      </SettingsField>

      <SettingsField title="Tempo factor" hint="Changes module playback speed without changing pitch.">
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

      <SettingsField title="Pitch factor" hint="Adjusts playback pitch relative to the module's original tuning.">
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
