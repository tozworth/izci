<script lang="ts">
  import { onMount } from 'svelte';
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import ThemedSelect from '$lib/components/options/ThemedSelect.svelte';
  import { loadMilkDropPresets } from '$lib/services/milkdrop-presets';
  import { visualizerSettings } from '$lib/stores/visualizer-settings';

  let presetNames: string[] = [];
  let loading = true;
  let failed = false;

  onMount(() => {
    let cancelled = false;
    void loadMilkDropPresets().then((catalog) => {
      if (!cancelled) presetNames = Object.keys(catalog).sort();
    }).catch(() => {
      if (!cancelled) failed = true;
    }).finally(() => {
      if (!cancelled) loading = false;
    });
    return () => { cancelled = true; };
  });

  function rangeValue(event: Event): number {
    return (event.currentTarget as HTMLInputElement).valueAsNumber;
  }

  $: presetOptions = [
    { value: '', label: $t('options.visualizer.milkdrop.randomPreset', { default: 'Random initial preset' }) },
    ...presetNames.map((name) => ({ value: name, label: name }))
  ];
</script>

<div class="section">
  <h2>{$t('options.visualizer.options.milkdrop', { default: 'MilkDrop' })}</h2>
  <div class="field-grid">
    <SettingsField
      title={$t('options.visualizer.milkdrop.preset.title', { default: 'Preset' })}
      hint={$t('options.visualizer.milkdrop.preset.hint', { default: 'Selects a bundled MilkDrop preset. Presets provide their own colors and remain available offline.' })}
    >
      <ThemedSelect
        value={$visualizerSettings.milkDropPreset}
        options={presetOptions}
        maxWidth="320px"
        disabled={loading || failed}
        label={$t('options.visualizer.milkdrop.preset.title', { default: 'Preset' })}
        on:change={(event) => visualizerSettings.update({ milkDropPreset: event.detail })}
      />
    </SettingsField>
    <SettingsField
      title={$t('options.visualizer.milkdrop.cycle.title', { default: 'Cycle presets' })}
      hint={$t('options.visualizer.milkdrop.cycle.hint', { default: 'Automatically switches to another random preset. Turn off to keep the current preset.' })}
      checkbox
    >
      <input type="checkbox" checked={$visualizerSettings.milkDropCyclePresets}
        on:change={(event) => visualizerSettings.update({ milkDropCyclePresets: event.currentTarget.checked })} />
    </SettingsField>
    {#if $visualizerSettings.milkDropCyclePresets}
      <SettingsField
        title={$t('options.visualizer.milkdrop.interval.title', { default: 'Preset duration' })}
        hint={$t('options.visualizer.milkdrop.interval.hint', { default: 'Sets how many seconds each preset runs before the next transition.' })}
      >
        <input type="range" min="5" max="300" step="1" value={$visualizerSettings.milkDropCycleSeconds}
          on:input={(event) => visualizerSettings.update({ milkDropCycleSeconds: rangeValue(event) })} />
        <span class="field-output">{Math.round($visualizerSettings.milkDropCycleSeconds)}s</span>
      </SettingsField>
    {/if}
    <SettingsField
      title={$t('options.visualizer.milkdrop.blend.title', { default: 'Preset blend time' })}
      hint={$t('options.visualizer.milkdrop.blend.hint', { default: 'Sets the crossfade duration between MilkDrop presets; zero switches immediately.' })}
      advanced
    >
      <input type="range" min="0" max="10" step="0.25" value={$visualizerSettings.milkDropBlendSeconds}
        on:input={(event) => visualizerSettings.update({ milkDropBlendSeconds: rangeValue(event) })} />
      <span class="field-output">{$visualizerSettings.milkDropBlendSeconds.toFixed(2)}s</span>
    </SettingsField>
    <SettingsField
      title={$t('options.visualizer.milkdrop.resolution.title', { default: 'Render resolution' })}
      hint={$t('options.visualizer.milkdrop.resolution.hint', { default: 'Scales MilkDrop resolution relative to the display, within a one-megapixel limit. Lower values reduce GPU load.' })}
      advanced
    >
      <input type="range" min="25" max="200" step="5" value={Math.round($visualizerSettings.milkDropResolution * 100)}
        on:input={(event) => visualizerSettings.update({ milkDropResolution: rangeValue(event) / 100 })} />
      <span class="field-output">{Math.round($visualizerSettings.milkDropResolution * 100)}%</span>
    </SettingsField>
  </div>
  {#if failed}
    <p class="field-hint" role="status">{$t('options.visualizer.milkdrop.loadFailed', { default: 'MilkDrop presets could not be loaded.' })}</p>
  {/if}
</div>
