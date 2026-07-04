<script lang="ts">
  import { onMount } from 'svelte';
  import { version as appVersion } from '../../package.json';
  import { COLOR_THEME_OPTIONS } from '$lib/services/theme';
  import { windowControlsOverlayState } from '$lib/services/window-controls-overlay';
  import {
    BACKDROP_EFFECT_OPTIONS,
    BACKDROP_ZONE_IDS,
    BACKDROP_ZONE_LABELS,
    appearanceSettings
  } from '$lib/stores/appearance-settings';
  import {
    MAX_PLAY_COUNT_THRESHOLD_SECONDS,
    MIN_PLAY_COUNT_THRESHOLD_SECONDS,
    metadataSettings,
    normalizePlayCountThresholdSeconds
  } from '$lib/stores/metadata-settings';
  import {
    DEFAULT_MODULE_PLAYBACK_SETTINGS,
    MODULE_INTERPOLATION_OPTIONS,
    modulePlaybackSettings
  } from '$lib/stores/module-playback-settings';
  import { playbackSettings } from '$lib/stores/playback-settings';
  import {
    VISUALIZER_COLOR_SOURCE_OPTIONS,
    VISUALIZER_STYLE_OPTIONS,
    visualizerSettings
  } from '$lib/stores/visualizer-settings';
  import type {
    BackdropZoneEffect,
    BackdropZoneId,
    ColorTheme,
    VisualizerColorSource,
    VisualizerSettings,
    VisualizerStyle
  } from '$lib/types';
  import {
    OPTIONS_VIEW_GROUPS,
    OPTIONS_VIEWS,
    buildOptionsWindowPath,
    getOptionsViewFromLocation,
    isOptionsViewName,
    type OptionsViewName
  } from './views';

  let activeView: OptionsViewName = getOptionsViewFromLocation(window.location);
  let fieldHintsExpanded = false;
  let treeWidth = 204;
  let resizePointerId: number | null = null;
  let pendingStereoSeparation: number | null = null;
  let pendingPanStrength: number | null = null;

  type TriangleVisualizerSetting =
    | 'triangleCount'
    | 'triangleMinSize'
    | 'triangleMaxSize'
    | 'triangleBaseSpeed'
    | 'triangleReactiveSpeed'
    | 'triangleBorderWidth';

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  function setActiveView(view: OptionsViewName) {
    activeView = view;

    const nextUrl = buildOptionsWindowPath(view);
    if (`${window.location.pathname}${window.location.search}` !== nextUrl) {
      window.history.replaceState(null, '', nextUrl);
    }
  }

  function formatFactor(value: number): string {
    return `${Math.round(value * 100)}% (${value.toFixed(2)}x)`;
  }

  function formatRepeatCount(value: number): string {
    return value === -1 ? 'Loop forever' : 'Play once';
  }

  function getRepeatCountSelectValue(value: number): string {
    return value === -1 ? '-1' : '0';
  }

  function handleRepeatCountChange(event: Event) {
    const repeatCount = Number((event.currentTarget as HTMLSelectElement).value);
    modulePlaybackSettings.update({ repeatCount });
  }

  function handleInterpolationChange(event: Event) {
    const interpolationFilter = Number((event.currentTarget as HTMLSelectElement).value);
    modulePlaybackSettings.update({
      interpolationFilter:
        interpolationFilter === 1 || interpolationFilter === 2 || interpolationFilter === 4 || interpolationFilter === 8
          ? interpolationFilter
          : DEFAULT_MODULE_PLAYBACK_SETTINGS.interpolationFilter
    });
  }

  function handleRangeSettingChange(
    event: Event,
    key: 'stereoSeparation' | 'panStrength' | 'tempoFactor' | 'pitchFactor'
  ) {
    const input = event.currentTarget as HTMLInputElement;
    const value = input.valueAsNumber;

    modulePlaybackSettings.update(
      key === 'tempoFactor' || key === 'pitchFactor'
        ? { [key]: value / 100 }
        : { [key]: value }
    );
  }

  function handleDeferredRangeInput(event: Event, key: 'stereoSeparation' | 'panStrength') {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber;

    if (key === 'stereoSeparation') {
      pendingStereoSeparation = value;
      return;
    }

    pendingPanStrength = value;
  }

  function commitDeferredRangeSetting(event: Event, key: 'stereoSeparation' | 'panStrength') {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
    const currentSettings = modulePlaybackSettings.getSnapshot();

    if (key === 'stereoSeparation') {
      pendingStereoSeparation = null;

      if (currentSettings.stereoSeparation !== value) {
        modulePlaybackSettings.update({ stereoSeparation: value });
      }

      return;
    }

    pendingPanStrength = null;

    if (currentSettings.panStrength !== value) {
      modulePlaybackSettings.update({ panStrength: value });
    }
  }

  function handleMetadataToggle(event: Event) {
    metadataSettings.update({
      inferFromFilename: (event.currentTarget as HTMLInputElement).checked
    });
  }

  function handlePlayCountThresholdChange(event: Event) {
    metadataSettings.update({
      playCountThresholdSeconds: normalizePlayCountThresholdSeconds(
        (event.currentTarget as HTMLInputElement).value
      )
    });
  }

  function handleColorThemeChange(event: Event) {
    appearanceSettings.update({
      colorTheme: (event.currentTarget as HTMLSelectElement).value as ColorTheme
    });
  }

  function handleArtworkPlayerColorsToggle(event: Event) {
    appearanceSettings.update({
      useArtworkPlayerColors: (event.currentTarget as HTMLInputElement).checked
    });
  }

  function handleCompactColumnLayoutToggle(event: Event) {
    appearanceSettings.update({
      keepLibraryColumnsVisibleInNarrowLayout: (event.currentTarget as HTMLInputElement).checked
    });
  }

  function handleAutoNowPlayingToggle(event: Event) {
    appearanceSettings.update({
      autoNowPlayingOnMaximized: (event.currentTarget as HTMLInputElement).checked
    });
  }

  function handleUseSystemFontToggle(event: Event) {
    appearanceSettings.update({
      useSystemFont: (event.currentTarget as HTMLInputElement).checked
    });
  }

  function handleBackdropZoneChange(event: Event, zone: BackdropZoneId) {
    appearanceSettings.update({
      backdropZones: {
        ...appearanceSettings.getSnapshot().backdropZones,
        [zone]: (event.currentTarget as HTMLSelectElement).value as BackdropZoneEffect
      }
    });
  }

  function handleWindowTitleToggle(event: Event) {
    appearanceSettings.update({
      showTrackTitleInWindowTitle: (event.currentTarget as HTMLInputElement).checked
    });
  }

  function handleLogarithmicVolumeToggle(event: Event) {
    playbackSettings.update({
      logarithmicVolume: (event.currentTarget as HTMLInputElement).checked
    });
  }

  function handleVisualizerStyleChange(event: Event) {
    visualizerSettings.update({
      style: (event.currentTarget as HTMLSelectElement).value as VisualizerStyle
    });
  }

  function handleVisualizerColorSourceChange(event: Event) {
    visualizerSettings.update({
      colorSource: (event.currentTarget as HTMLSelectElement).value as VisualizerColorSource
    });
  }

  function handleVisualizerHeightChange(event: Event) {
    visualizerSettings.update({
      height: (event.currentTarget as HTMLInputElement).valueAsNumber / 100
    });
  }

  function handleVisualizerOpacityChange(event: Event) {
    visualizerSettings.update({
      transparency: (event.currentTarget as HTMLInputElement).valueAsNumber / 100
    });
  }

  function handleVisualizerNormalizationChange(event: Event) {
    visualizerSettings.update({
      normalizationStrength: (event.currentTarget as HTMLInputElement).valueAsNumber / 100
    });
  }

  function handleTriangleVisualizerChange(event: Event, key: TriangleVisualizerSetting, scale = 1) {
    visualizerSettings.update({
      [key]: (event.currentTarget as HTMLInputElement).valueAsNumber / scale
    } as Partial<VisualizerSettings>);
  }

  function resetCurrentView() {
    if (activeView === 'appearance') {
      appearanceSettings.reset();
      return;
    }

    if (activeView === 'playback') {
      playbackSettings.reset();
      return;
    }

    if (activeView === 'visualizer') {
      visualizerSettings.reset();
      return;
    }

    if (activeView === 'modules') {
      modulePlaybackSettings.reset();
      return;
    }

    if (activeView === 'metadata') {
      metadataSettings.reset();
    }
  }

  function handleWindowContextMenu(event: MouseEvent) {
    event.preventDefault();
  }

  function beginResize(event: PointerEvent) {
    resizePointerId = event.pointerId;
    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent) {
    if (resizePointerId === null) {
      return;
    }

    treeWidth = clamp(event.clientX, 156, window.innerWidth - 220);
  }

  function stopResize() {
    resizePointerId = null;
  }

  onMount(() => {
    const syncActiveViewFromLocation = () => {
      activeView = getOptionsViewFromLocation(window.location);
    };
    const wasOpenedByMainWindow = window.opener !== null;
    const closeIfMainWindowClosed = () => {
      if (!wasOpenedByMainWindow) {
        return;
      }

      if (window.opener && !window.opener.closed) {
        return;
      }

      window.close();
    };
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'izci:open-options-view') {
        return;
      }

      if (!isOptionsViewName(event.data.view)) {
        return;
      }

      setActiveView(event.data.view);
    };

    window.addEventListener('popstate', syncActiveViewFromLocation);
    window.addEventListener('message', handleMessage);
    window.addEventListener('focus', closeIfMainWindowClosed);
    document.addEventListener('visibilitychange', closeIfMainWindowClosed);
    const openerCheckInterval = window.setInterval(closeIfMainWindowClosed, 1000);

    return () => {
      window.clearInterval(openerCheckInterval);
      window.removeEventListener('popstate', syncActiveViewFromLocation);
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('focus', closeIfMainWindowClosed);
      document.removeEventListener('visibilitychange', closeIfMainWindowClosed);
    };
  });

  $: overlayState = $windowControlsOverlayState;
  $: overlayRect = overlayState.titlebarAreaRect;
  $: overlayInlineStyle = overlayState.visible
    ? `--window-controls-overlay-x: ${overlayRect.x}px; --window-controls-overlay-y: ${overlayRect.y}px; --window-controls-overlay-width: ${overlayRect.width}px; --window-controls-overlay-height: ${overlayRect.height}px;`
    : '';
  $: activeViewDefinition = OPTIONS_VIEWS[activeView];
  $: breadcrumbs = [activeViewDefinition.parentLabel, activeViewDefinition.label].filter(Boolean);
  $: canResetCurrentView = activeViewDefinition.resettable;
  $: canToggleHints = activeViewDefinition.hasHints;
  $: interpolationOption =
    MODULE_INTERPOLATION_OPTIONS.find(
      (option) => option.value === $modulePlaybackSettings.interpolationFilter
    ) ?? MODULE_INTERPOLATION_OPTIONS[0];
  $: repeatCountSelectValue = getRepeatCountSelectValue($modulePlaybackSettings.repeatCount);
  $: hintToggleLabel = fieldHintsExpanded ? 'Collapse field hints' : 'Expand field hints';
  $: stereoSeparationValue = pendingStereoSeparation ?? $modulePlaybackSettings.stereoSeparation;
  $: panStrengthValue = pendingPanStrength ?? $modulePlaybackSettings.panStrength;
</script>

<svelte:head>
  <title>izci Options</title>
</svelte:head>

<svelte:window
  on:contextmenu={handleWindowContextMenu}
  on:pointermove={handlePointerMove}
  on:pointerup={stopResize}
  on:pointercancel={stopResize}
/>

<div
  class="options-shell"
  class:is-resizing={resizePointerId !== null}
  class:hints-expanded={fieldHintsExpanded}
  class:window-controls-overlay-active={overlayState.visible}
>
  <header
    class="window-topbar"
    class:window-controls-overlay-active={overlayState.visible}
    style={overlayInlineStyle}
  >
    <div class="window-topbar-title" aria-live="polite">
      <span class="window-topbar-prefix">izci Options</span>
      <span class="window-topbar-breadcrumbs">
        {#each breadcrumbs as crumb}
          <span class="material-symbols-outlined window-topbar-separator" aria-hidden="true">
            chevron_right
          </span>
          <span class="window-topbar-crumb" class:is-current={crumb === activeViewDefinition.label}>
            {crumb}
          </span>
        {/each}
      </span>
    </div>

    <div class="window-topbar-tools" aria-label="Page tools">
      <button
        class="tool-button"
        type="button"
        aria-label={hintToggleLabel}
        title={hintToggleLabel}
        disabled={!canToggleHints}
        on:click={() => (fieldHintsExpanded = !fieldHintsExpanded)}
      >
        <span class="material-symbols-outlined" aria-hidden="true">
          {fieldHintsExpanded ? 'unfold_less' : 'unfold_more'}
        </span>
      </button>

      <button
        class="tool-button"
        type="button"
        aria-label="Reset current page to defaults"
        title="Reset current page to defaults"
        disabled={!canResetCurrentView}
        on:click={resetCurrentView}
      >
        <span class="material-symbols-outlined" aria-hidden="true">restart_alt</span>
      </button>
    </div>
  </header>

  <main class="options-main" style={`--tree-width: ${treeWidth}px;`}>
    <aside class="tree-panel" aria-label="Options categories">
      <div class="tree" role="tree" aria-label="Options categories">
        {#each OPTIONS_VIEW_GROUPS as group}
          <div class="tree-group" role="none">
            {#each group as view}
              <button
                class="tree-item"
                class:child={view.parentLabel !== ''}
                type="button"
                role="treeitem"
                aria-selected={activeView === view.id}
                on:click={() => setActiveView(view.id)}
              >
                <span class="material-symbols-outlined" aria-hidden="true">{view.icon}</span>
                <span class="tree-label">{view.label}</span>
              </button>
            {/each}
          </div>
        {/each}
      </div>
    </aside>

    <div
      class="resizer"
      class:is-active={resizePointerId !== null}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panels"
      on:pointerdown={beginResize}
    ></div>

    <section class="content-panel" aria-live="polite">
      {#if activeView === 'appearance'}
        <article class="view">
          <div class="section">
            <h2>Window Theme</h2>
            <div class="field-grid">
              <label class="field">
                <div class="field-copy">
                  <span class="field-title">Color theme</span>
                </div>
                <div class="field-control">
                  <select value={$appearanceSettings.colorTheme} on:change={handleColorThemeChange}>
                    {#each COLOR_THEME_OPTIONS as option}
                      <option value={option.value}>{option.label}</option>
                    {/each}
                  </select>
                </div>
                <p class="field-hint">
                  Sets the global color theme.
                </p>
              </label>

              <label class="field checkbox-field">
                <div class="field-copy">
                  <span class="field-title">Use artwork colors for player</span>
                </div>
                <div class="field-control checkbox-control">
                  <input
                    type="checkbox"
                    checked={$appearanceSettings.useArtworkPlayerColors}
                    on:change={handleArtworkPlayerColorsToggle}
                  />
                </div>
                <p class="field-hint">
                  Tints the player bar from the current artwork, with the selected theme as fallback.
                </p>
              </label>
            </div>
          </div>

          <div class="section">
            <h2>Interface</h2>
            <div class="field-grid">
              <label class="field checkbox-field">
                <div class="field-copy">
                  <span class="field-title">Use system font</span>
                </div>
                <div class="field-control checkbox-control">
                  <input
                    type="checkbox"
                    checked={$appearanceSettings.useSystemFont}
                    on:change={handleUseSystemFontToggle}
                  />
                </div>
                <p class="field-hint">
                  Replaces the default UI font with your system interface font across the main app and Options window.
                </p>
              </label>

              <div class="field backdrop-zone-field">
                <div class="field-copy">
                  <span class="field-title">Background zones</span>
                </div>
                <div class="backdrop-zone-grid">
                  {#each BACKDROP_ZONE_IDS as zone}
                    <label class="backdrop-zone-row">
                      <span>{BACKDROP_ZONE_LABELS[zone]}</span>
                      <select
                        value={$appearanceSettings.backdropZones[zone]}
                        on:change={(event) => handleBackdropZoneChange(event, zone)}
                      >
                        {#each BACKDROP_EFFECT_OPTIONS as option}
                          <option value={option.value}>{option.label}</option>
                        {/each}
                      </select>
                    </label>
                  {/each}
                </div>
                <p class="field-hint">
                  Chooses whether each pane and the player bar render album artwork, the visualizer, both, or neither.
                </p>
              </div>

              <label class="field checkbox-field">
                <div class="field-copy">
                  <span class="field-title">Keep columns visible in narrow library panels</span>
                </div>
                <div class="field-control checkbox-control">
                  <input
                    type="checkbox"
                    checked={$appearanceSettings.keepLibraryColumnsVisibleInNarrowLayout}
                    on:change={handleCompactColumnLayoutToggle}
                  />
                </div>
                <p class="field-hint">
                  Prevents the slim-window library view from collapsing to title-only rows.
                </p>
              </label>

              <label class="field checkbox-field">
                <div class="field-copy">
                  <span class="field-title">Open Now Playing when maximized</span>
                </div>
                <div class="field-control checkbox-control">
                  <input
                    type="checkbox"
                    checked={$appearanceSettings.autoNowPlayingOnMaximized}
                    on:change={handleAutoNowPlayingToggle}
                  />
                </div>
                <p class="field-hint">
                  Switches the main window to Now Playing while it is maximized or fullscreen.
                </p>
              </label>

              <label class="field checkbox-field">
                <div class="field-copy">
                  <span class="field-title">Show track title in window title</span>
                </div>
                <div class="field-control checkbox-control">
                  <input
                    type="checkbox"
                    checked={$appearanceSettings.showTrackTitleInWindowTitle}
                    on:change={handleWindowTitleToggle}
                  />
                </div>
                <p class="field-hint">
                  Shows the current track title in the main app window title. Turn it off to always show only "izci".
                </p>
              </label>
            </div>
          </div>
        </article>
      {/if}

      {#if activeView === 'playback'}
        <article class="view">
          <div class="section">
            <h2>Volume</h2>
            <div class="field-grid">
              <label class="field checkbox-field">
                <div class="field-copy">
                  <span class="field-title">Logarithmic volume</span>
                </div>
                <div class="field-control checkbox-control">
                  <input
                    type="checkbox"
                    checked={$playbackSettings.logarithmicVolume}
                    on:change={handleLogarithmicVolumeToggle}
                  />
                </div>
                <p class="field-hint">
                  Shapes the volume slider for gentler low-end changes.
                </p>
              </label>
            </div>
          </div>
        </article>
      {/if}

      {#if activeView === 'visualizer'}
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
      {/if}

      {#if activeView === 'modules'}
        <article class="view">
          <div class="section">
            <h2>Rendering</h2>
            <div class="field-grid">
              <label class="field">
                <div class="field-copy">
                  <span class="field-title">Stereo separation (MOD)</span>
                </div>
                <div class="field-control">
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
                </div>
                <p class="field-hint">Applies to <code>MOD</code> files. 0 = mono, 200 = hard stereo.</p>
              </label>

              <label class="field">
                <div class="field-copy">
                  <span class="field-title">Pan strength</span>
                </div>
                <div class="field-control">
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
                </div>
                <p class="field-hint">Below 100 narrows the image, above 100 widens it.</p>
              </label>

              <label class="field">
                <div class="field-copy">
                  <span class="field-title">Interpolation</span>
                </div>
                <div class="field-control">
                  <select value={$modulePlaybackSettings.interpolationFilter} on:change={handleInterpolationChange}>
                    {#each MODULE_INTERPOLATION_OPTIONS as option}
                      <option value={option.value}>{option.label}</option>
                    {/each}
                  </select>
                </div>
                <p class="field-hint">{interpolationOption.hint}</p>
              </label>
            </div>
          </div>

          <div class="section">
            <h2>Playback</h2>
            <div class="field-grid">
              <label class="field">
                <div class="field-copy">
                  <span class="field-title">Looping</span>
                </div>
                <div class="field-control">
                  <select value={repeatCountSelectValue} on:change={handleRepeatCountChange}>
                    <option value="0">Play once</option>
                    <option value="-1">Loop forever</option>
                  </select>
                </div>
                <p class="field-hint">Maps to libopenmpt repeat count.</p>
              </label>

              <label class="field">
                <div class="field-copy">
                  <span class="field-title">Tempo factor</span>
                </div>
                <div class="field-control">
                  <input
                    type="range"
                    min="25"
                    max="400"
                    step="1"
                    value={Math.round($modulePlaybackSettings.tempoFactor * 100)}
                    on:input={(event) => handleRangeSettingChange(event, 'tempoFactor')}
                  />
                  <span class="field-output">{formatFactor($modulePlaybackSettings.tempoFactor)}</span>
                </div>
                <p class="field-hint">Changes module playback speed without changing pitch.</p>
              </label>

              <label class="field">
                <div class="field-copy">
                  <span class="field-title">Pitch factor</span>
                </div>
                <div class="field-control">
                  <input
                    type="range"
                    min="25"
                    max="400"
                    step="1"
                    value={Math.round($modulePlaybackSettings.pitchFactor * 100)}
                    on:input={(event) => handleRangeSettingChange(event, 'pitchFactor')}
                  />
                  <span class="field-output">{formatFactor($modulePlaybackSettings.pitchFactor)}</span>
                </div>
                <p class="field-hint">Adjusts playback pitch relative to the module's original tuning.</p>
              </label>
            </div>
          </div>
        </article>
      {/if}

      {#if activeView === 'metadata'}
        <article class="view">
          <div class="section">
            <h2>Metadata Behavior</h2>
            <div class="field-grid">
              <label class="field checkbox-field">
                <div class="field-copy">
                  <span class="field-title">Infer artist/title from filename</span>
                </div>
                <div class="field-control field-control-checkbox">
                  <input
                    type="checkbox"
                    checked={$metadataSettings.inferFromFilename}
                    on:change={handleMetadataToggle}
                  />
                </div>
                <p class="field-hint">When enabled, izci parses filenames like <code>Artist - Title.ext</code> into metadata fields.</p>
              </label>

              <label class="field">
                <div class="field-copy">
                  <span class="field-title">Count track as played after (seconds)</span>
                  <p class="field-hint">Only tracks that are in the library update their play count.</p>
                </div>
                <div class="field-control">
                  <input
                    type="number"
                    min={MIN_PLAY_COUNT_THRESHOLD_SECONDS}
                    max={MAX_PLAY_COUNT_THRESHOLD_SECONDS}
                    step="1"
                    value={$metadataSettings.playCountThresholdSeconds}
                    on:change={handlePlayCountThresholdChange}
                  />
                </div>
              </label>
            </div>
          </div>
        </article>
      {/if}

      {#if activeView === 'about'}
        <article class="view">
          <div class="section about-section">
            <h2>About</h2>
            <div class="about-hero">
              <img class="about-logo" src="/icons/izci-icon.svg" alt="izci logo" />
              <div class="about-copy">
                <h3 class="about-name">izci</h3>
                <p class="about-tagline">PWA music player</p>
                <p class="about-meta">Version {appVersion}</p>
                <p class="about-meta">Toz, 2026</p>
              </div>
            </div>
          </div>

          <div class="section">
            <h2>Features</h2>
            <ul class="feature-list">
              <li>Support for common streamed formats and tracker modules</li>
              <li>Offline PWA with desktop integration and file associations</li>
              <li>An easy-to-manage, persistent library</li>
              <li>Low CPU usage</li>
              <li>Did I mention it plays tracker modules?</li>
              <li>izci plays tracker modules</li>
              <li>"izci" is "tracker" in Turkish; though it's closer to "scout" but i kept it cuz it's cute</li>
            </ul>
          </div>
        </article>
      {/if}
    </section>
  </main>
</div>
