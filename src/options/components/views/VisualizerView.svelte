<script lang="ts">
  import {
    MAX_VISUALIZER_FRAME_RATE_LIMIT, MIN_VISUALIZER_FRAME_RATE_LIMIT,
    VISUALIZER_COLOR_SOURCE_OPTIONS, VISUALIZER_STYLE_OPTIONS, visualizerSettings
  } from '$lib/stores/visualizer-settings';
  import type { VisualizerColorSource, VisualizerSettings, VisualizerStyle } from '$lib/types';

  type TriangleVisualizerSetting = 'triangleCount' | 'triangleMinSize' | 'triangleMaxSize' | 'triangleBaseSpeed' | 'triangleReactiveSpeed' | 'triangleBorderWidth';
  function formatFactor(value: number) { return `${Math.round(value * 100)}% (${value.toFixed(2)}x)`; }
  function handleVisualizerStyleChange(event: Event) { visualizerSettings.update({ style: (event.currentTarget as HTMLSelectElement).value as VisualizerStyle }); }
  function handleVisualizerColorSourceChange(event: Event) { visualizerSettings.update({ colorSource: (event.currentTarget as HTMLSelectElement).value as VisualizerColorSource }); }
  function handleVisualizerHeightChange(event: Event) { visualizerSettings.update({ height: (event.currentTarget as HTMLInputElement).valueAsNumber / 100 }); }
  function handleVisualizerOpacityChange(event: Event) { visualizerSettings.update({ transparency: (event.currentTarget as HTMLInputElement).valueAsNumber / 100 }); }
  function handleVisualizerFrameRateLimitChange(event: Event) { visualizerSettings.update({ frameRateLimit: (event.currentTarget as HTMLInputElement).valueAsNumber }); }
  function handleVisualizerNormalizationChange(event: Event) { visualizerSettings.update({ normalizationStrength: (event.currentTarget as HTMLInputElement).valueAsNumber / 100 }); }
  function handleTriangleVisualizerChange(event: Event, key: TriangleVisualizerSetting, scale = 1) {
    visualizerSettings.update({ [key]: (event.currentTarget as HTMLInputElement).valueAsNumber / scale } as Partial<VisualizerSettings>);
  }
</script>

<article class="view">
  <div class="section">
    <h2>Player Background</h2>
    <div class="field-grid">
      <label class="field">
        <div class="field-copy">
          <span class="field-title">Style</span>
        </div>
        <div class="field-control">
          <select value={$visualizerSettings.style} on:change={handleVisualizerStyleChange}>
            {#each VISUALIZER_STYLE_OPTIONS as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>
        <p class="field-hint">
          Controls how the spectrum analyzer is drawn behind the full player bar.
        </p>
      </label>

      <label class="field">
        <div class="field-copy">
          <span class="field-title">Color source</span>
        </div>
        <div class="field-control">
          <select value={$visualizerSettings.colorSource} on:change={handleVisualizerColorSourceChange}>
            {#each VISUALIZER_COLOR_SOURCE_OPTIONS as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>
        <p class="field-hint">
          Uses the current artwork palette when available, otherwise falls back to the active theme.
        </p>
      </label>

      <label class="field">
        <div class="field-copy">
          <span class="field-title">Height</span>
        </div>
        <div class="field-control">
          <input
            type="range"
            min="22"
            max="100"
            step="1"
            value={Math.round($visualizerSettings.height * 100)}
            on:input={handleVisualizerHeightChange}
          />
          <span class="field-output">{Math.round($visualizerSettings.height * 100)}%</span>
        </div>
        <p class="field-hint">
          Sets how far the analyzer can rise through the player background.
        </p>
      </label>

      <label class="field">
        <div class="field-copy">
          <span class="field-title">Opacity</span>
        </div>
        <div class="field-control">
          <input
            type="range"
            min="0"
            max="85"
            step="1"
            value={Math.round($visualizerSettings.transparency * 100)}
            on:input={handleVisualizerOpacityChange}
          />
          <span class="field-output">{Math.round($visualizerSettings.transparency * 100)}%</span>
        </div>
        <p class="field-hint">
          Sets how strongly the analyzer appears behind text, controls, and artwork.
        </p>
      </label>

      <label class="field">
        <div class="field-copy">
          <span class="field-title">Frame cap</span>
        </div>
        <div class="field-control">
          <input
            type="range"
            min={MIN_VISUALIZER_FRAME_RATE_LIMIT}
            max={MAX_VISUALIZER_FRAME_RATE_LIMIT}
            step="1"
            value={$visualizerSettings.frameRateLimit}
            on:input={handleVisualizerFrameRateLimitChange}
          />
          <span class="field-output">{Math.round($visualizerSettings.frameRateLimit)} fps</span>
        </div>
        <p class="field-hint">
          Limits how often every visualizer style redraws, from battery-friendlier motion to high-refresh displays.
        </p>
      </label>

      {#if $visualizerSettings.style !== 'triangles'}
        <label class="field">
          <div class="field-copy">
            <span class="field-title">Normalization</span>
          </div>
          <div class="field-control">
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.round($visualizerSettings.normalizationStrength * 100)}
              on:input={handleVisualizerNormalizationChange}
            />
            <span class="field-output">{Math.round($visualizerSettings.normalizationStrength * 100)}%</span>
          </div>
          <p class="field-hint">
            Balances low, mid, and high frequency bands so bass-heavy or bright tracks still use the full visual range.
          </p>
        </label>
      {/if}

      {#if $visualizerSettings.style === 'triangles'}
        <label class="field">
          <div class="field-copy">
            <span class="field-title">Triangle count</span>
          </div>
          <div class="field-control">
            <input
              type="range"
              min="8"
              max="160"
              step="1"
              value={$visualizerSettings.triangleCount}
              on:input={(event) => handleTriangleVisualizerChange(event, 'triangleCount')}
            />
            <span class="field-output">{Math.round($visualizerSettings.triangleCount)}</span>
          </div>
          <p class="field-hint">
            Sets how many triangle shapes are kept active in the player background.
          </p>
        </label>

        <label class="field">
          <div class="field-copy">
            <span class="field-title">Minimum triangle size</span>
          </div>
          <div class="field-control">
            <input
              type="range"
              min="4"
              max="80"
              step="1"
              value={Math.round($visualizerSettings.triangleMinSize * 100)}
              on:input={(event) => handleTriangleVisualizerChange(event, 'triangleMinSize', 100)}
            />
            <span class="field-output">{Math.round($visualizerSettings.triangleMinSize * 100)}%</span>
          </div>
          <p class="field-hint">
            Sets the smallest triangle size as a percentage of the player bar height.
          </p>
        </label>

        <label class="field">
          <div class="field-copy">
            <span class="field-title">Maximum triangle size</span>
          </div>
          <div class="field-control">
            <input
              type="range"
              min="8"
              max="120"
              step="1"
              value={Math.round($visualizerSettings.triangleMaxSize * 100)}
              on:input={(event) => handleTriangleVisualizerChange(event, 'triangleMaxSize', 100)}
            />
            <span class="field-output">{Math.round($visualizerSettings.triangleMaxSize * 100)}%</span>
          </div>
          <p class="field-hint">
            Sets the largest triangle size as a percentage of the player bar height.
          </p>
        </label>

        <label class="field">
          <div class="field-copy">
            <span class="field-title">Base rise speed</span>
          </div>
          <div class="field-control">
            <input
              type="range"
              min="20"
              max="300"
              step="1"
              value={Math.round($visualizerSettings.triangleBaseSpeed * 100)}
              on:input={(event) => handleTriangleVisualizerChange(event, 'triangleBaseSpeed', 100)}
            />
            <span class="field-output">{formatFactor($visualizerSettings.triangleBaseSpeed)}</span>
          </div>
          <p class="field-hint">
            Multiplies the baseline upward movement before rhythm response is applied.
          </p>
        </label>

        <label class="field">
          <div class="field-copy">
            <span class="field-title">Reactive rise speed</span>
          </div>
          <div class="field-control">
            <input
              type="range"
              min="0"
              max="300"
              step="1"
              value={Math.round($visualizerSettings.triangleReactiveSpeed * 100)}
              on:input={(event) => handleTriangleVisualizerChange(event, 'triangleReactiveSpeed', 100)}
            />
            <span class="field-output">{formatFactor($visualizerSettings.triangleReactiveSpeed)}</span>
          </div>
          <p class="field-hint">
            Multiplies the extra upward speed added by amplitude and beat pulses.
          </p>
        </label>

        <label class="field">
          <div class="field-copy">
            <span class="field-title">Border thickness</span>
          </div>
          <div class="field-control">
            <input
              type="range"
              min="0"
              max="12"
              step="0.25"
              value={$visualizerSettings.triangleBorderWidth}
              on:input={(event) => handleTriangleVisualizerChange(event, 'triangleBorderWidth')}
            />
            <span class="field-output">{$visualizerSettings.triangleBorderWidth.toFixed(2)}px</span>
          </div>
          <p class="field-hint">
            Sets a fixed outline width shared by every triangle, regardless of size.
          </p>
        </label>
      {/if}
    </div>
  </div>
</article>

