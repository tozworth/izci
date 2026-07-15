<script lang="ts">
  import {
    MAX_VISUALIZER_FRAME_RATE_LIMIT, MIN_VISUALIZER_FRAME_RATE_LIMIT,
    VISUALIZER_COLOR_SOURCE_OPTIONS, VISUALIZER_STYLE_OPTIONS, visualizerSettings
  } from '$lib/stores/visualizer-settings';
  import type { VisualizerSettings } from '$lib/types';

  type SelectSetting = 'style' | 'colorSource';
  type RangeSetting = Exclude<keyof VisualizerSettings, SelectSetting>;
  type Visibility = 'always' | 'standard' | 'triangles';
  interface SelectDescriptor {
    key: SelectSetting;
    title: string;
    hint: string;
    options: ReadonlyArray<{ value: string; label: string }>;
  }
  interface RangeDescriptor {
    key: RangeSetting;
    title: string;
    hint: string;
    min: number;
    max: number;
    step: number;
    scale?: number;
    preserveFraction?: boolean;
    visibility?: Visibility;
    format: (value: number) => string;
  }

  const SELECT_SETTINGS: SelectDescriptor[] = [
    {
      key: 'style', title: 'Style', options: VISUALIZER_STYLE_OPTIONS,
      hint: 'Controls how the spectrum analyzer is drawn behind the full player bar.'
    },
    {
      key: 'colorSource', title: 'Color source', options: VISUALIZER_COLOR_SOURCE_OPTIONS,
      hint: 'Uses the current artwork palette when available, otherwise falls back to the active theme.'
    }
  ];
  const RANGE_SETTINGS: RangeDescriptor[] = [
    {
      key: 'height', title: 'Height', min: 22, max: 100, step: 1, scale: 100,
      format: (value) => `${Math.round(value * 100)}%`,
      hint: 'Sets how far the analyzer can rise through the player background.'
    },
    {
      key: 'transparency', title: 'Opacity', min: 0, max: 85, step: 1, scale: 100,
      format: (value) => `${Math.round(value * 100)}%`,
      hint: 'Sets how strongly the analyzer appears behind text, controls, and artwork.'
    },
    {
      key: 'frameRateLimit', title: 'Frame cap', min: MIN_VISUALIZER_FRAME_RATE_LIMIT,
      max: MAX_VISUALIZER_FRAME_RATE_LIMIT, step: 1,
      format: (value) => `${Math.round(value)} fps`,
      hint: 'Limits how often every visualizer style redraws, from battery-friendlier motion to high-refresh displays.'
    },
    {
      key: 'normalizationStrength', title: 'Normalization', min: 0, max: 100, step: 1,
      scale: 100, visibility: 'standard', format: (value) => `${Math.round(value * 100)}%`,
      hint: 'Balances low, mid, and high frequency bands so bass-heavy or bright tracks still use the full visual range.'
    },
    {
      key: 'triangleCount', title: 'Triangle count', min: 8, max: 160, step: 1,
      visibility: 'triangles', format: (value) => `${Math.round(value)}`,
      hint: 'Sets how many triangle shapes are kept active in the player background.'
    },
    {
      key: 'triangleMinSize', title: 'Minimum triangle size', min: 4, max: 80, step: 1,
      scale: 100, visibility: 'triangles', format: (value) => `${Math.round(value * 100)}%`,
      hint: 'Sets the smallest triangle size as a percentage of the player bar height.'
    },
    {
      key: 'triangleMaxSize', title: 'Maximum triangle size', min: 8, max: 120, step: 1,
      scale: 100, visibility: 'triangles', format: (value) => `${Math.round(value * 100)}%`,
      hint: 'Sets the largest triangle size as a percentage of the player bar height.'
    },
    {
      key: 'triangleBaseSpeed', title: 'Base rise speed', min: 20, max: 300, step: 1,
      scale: 100, visibility: 'triangles', format: formatFactor,
      hint: 'Multiplies the baseline upward movement before rhythm response is applied.'
    },
    {
      key: 'triangleReactiveSpeed', title: 'Reactive rise speed', min: 0, max: 300, step: 1,
      scale: 100, visibility: 'triangles', format: formatFactor,
      hint: 'Multiplies the extra upward speed added by amplitude and beat pulses.'
    },
    {
      key: 'triangleBorderWidth', title: 'Border thickness', min: 0, max: 12, step: 0.25,
      preserveFraction: true, visibility: 'triangles', format: (value) => `${value.toFixed(2)}px`,
      hint: 'Sets a fixed outline width shared by every triangle, regardless of size.'
    }
  ];

  function formatFactor(value: number) { return `${Math.round(value * 100)}% (${value.toFixed(2)}x)`; }
  function handleSelectChange(event: Event, key: SelectSetting) {
    visualizerSettings.update({ [key]: (event.currentTarget as HTMLSelectElement).value } as Partial<VisualizerSettings>);
  }
  function handleRangeChange(event: Event, setting: RangeDescriptor) {
    visualizerSettings.update({
      [setting.key]: (event.currentTarget as HTMLInputElement).valueAsNumber / (setting.scale ?? 1)
    } as Partial<VisualizerSettings>);
  }
  function getInputValue(setting: RangeDescriptor): number {
    const value = $visualizerSettings[setting.key] * (setting.scale ?? 1);
    return setting.preserveFraction ? value : Math.round(value);
  }

  $: visibleRangeSettings = RANGE_SETTINGS.filter(({ visibility = 'always' }) =>
    visibility === 'always' || (visibility === 'triangles') === ($visualizerSettings.style === 'triangles')
  );
</script>

<article class="view">
  <div class="section">
    <h2>Player Background</h2>
    <div class="field-grid">
      {#each SELECT_SETTINGS as setting (setting.key)}
        <label class="field">
          <div class="field-copy">
            <span class="field-title">{setting.title}</span>
          </div>
          <div class="field-control">
            <select value={$visualizerSettings[setting.key]} on:change={(event) => handleSelectChange(event, setting.key)}>
              {#each setting.options as option}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </div>
          <p class="field-hint">{setting.hint}</p>
        </label>
      {/each}

      {#each visibleRangeSettings as setting (setting.key)}
        <label class="field">
          <div class="field-copy">
            <span class="field-title">{setting.title}</span>
          </div>
          <div class="field-control">
            <input
              type="range"
              min={setting.min}
              max={setting.max}
              step={setting.step}
              value={getInputValue(setting)}
              on:input={(event) => handleRangeChange(event, setting)}
            />
            <span class="field-output">{setting.format($visualizerSettings[setting.key])}</span>
          </div>
          <p class="field-hint">{setting.hint}</p>
        </label>
      {/each}
    </div>
  </div>
</article>
