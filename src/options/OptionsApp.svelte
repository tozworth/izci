<script lang="ts">
  import { COLOR_THEME_OPTIONS } from '$lib/services/theme';
  import { appearanceSettings } from '$lib/stores/appearance-settings';
  import { metadataSettings } from '$lib/stores/metadata-settings';
  import {
    DEFAULT_MODULE_PLAYBACK_SETTINGS,
    MODULE_INTERPOLATION_OPTIONS,
    modulePlaybackSettings
  } from '$lib/stores/module-playback-settings';
  import { playbackSettings } from '$lib/stores/playback-settings';
  import type { ColorTheme } from '$lib/types';
  import { OPTIONS_VIEW_GROUPS, OPTIONS_VIEWS, type OptionsViewName } from './views';

  let activeView: OptionsViewName = 'appearance';
  let fieldHintsExpanded = false;
  let treeWidth = 204;
  let resizePointerId: number | null = null;
  let pendingStereoSeparation: number | null = null;
  let pendingPanStrength: number | null = null;

  function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
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

  function handleColorThemeChange(event: Event) {
    appearanceSettings.update({
      colorTheme: (event.currentTarget as HTMLSelectElement).value as ColorTheme
    });
  }

  function handleCompactColumnLayoutToggle(event: Event) {
    appearanceSettings.update({
      keepLibraryColumnsVisibleInNarrowLayout: (event.currentTarget as HTMLInputElement).checked
    });
  }

  function handleLogarithmicVolumeToggle(event: Event) {
    playbackSettings.update({
      logarithmicVolume: (event.currentTarget as HTMLInputElement).checked
    });
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

<div class="options-shell" class:is-resizing={resizePointerId !== null} class:hints-expanded={fieldHintsExpanded}>
  <header class="window-topbar">
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
                on:click={() => (activeView = view.id)}
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
            </div>
          </div>

          <div class="section">
            <h2>Library Layout</h2>
            <div class="field-grid">
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
            </div>
          </div>
        </article>
      {/if}

      {#if activeView === 'about'}
        <article class="view">
          <div class="section-grid">
            <div class="setting-card">
              <h3>Local-first</h3>
              <p>izci runs locally against user-selected files and file handles, with no backend service required.</p>
            </div>
            <div class="setting-card">
              <h3>Offline-capable</h3>
              <p>The installed PWA and production build keep playback and settings available without a network dependency.</p>
            </div>
            <div class="setting-card">
              <h3>Playback split</h3>
              <p>Streamed audio stays on Howler.js while tracker modules stay on Chiptune3.</p>
            </div>
            <div class="setting-card">
              <h3>Window architecture</h3>
              <p>The popup itself now lives in a dedicated entrypoint so the window manager only launches and tracks windows.</p>
            </div>
          </div>
        </article>
      {/if}
    </section>
  </main>
</div>
