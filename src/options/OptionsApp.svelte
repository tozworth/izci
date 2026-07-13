<script lang="ts">
  import { onMount } from 'svelte';
  import RafView from './components/raf/RafView.svelte';
  import { version as appVersion } from '../../package.json';
  import { COLOR_THEME_OPTIONS } from '$lib/services/theme';
  import {
    hasLocalFontAccessPermission,
    queryLocalFontFamilies,
    supportsLocalFontAccess
  } from '$lib/services/local-fonts';
  import { windowControlsOverlayState } from '$lib/services/window-controls-overlay';
  import {
    getOptionsWindowState,
    rememberOptionsActiveView,
    rememberOptionsWindowSize
  } from '$lib/services/options-window-state';
  import {
    BACKDROP_EFFECT_OPTIONS,
    BACKDROP_ZONE_IDS,
    BACKDROP_ZONE_LABELS,
    MAX_BACKDROP_ARTWORK_BLUR,
    MAX_BACKDROP_ARTWORK_BRIGHTNESS,
    MIN_BACKDROP_ARTWORK_BLUR,
    MIN_BACKDROP_ARTWORK_BRIGHTNESS,
    LYRICS_FONT_SIZE_LIMITS,
    LYRICS_STYLE_OPTIONS,
    MAX_LYRICS_DOWNTIME_THRESHOLD_SECONDS,
    MIN_LYRICS_DOWNTIME_THRESHOLD_SECONDS,
    MIN_NOW_PLAYING_PANEL_AUTO_HIDE_SECONDS,
    NOW_PLAYING_PANEL_AUTO_HIDE_NEVER_SECONDS,
    SYSTEM_FONT_FAMILY,
    appearanceSettings,
    hasArtworkBackdrop,
    normalizeBackdropZoneArtworkBlur,
    normalizeBackdropZoneArtworkBrightness,
    normalizeLyricsDowntimeThresholdSeconds,
    normalizeLyricsFontSize,
    normalizeNowPlayingPanelAutoHideDelaySeconds
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
  import {
    PLAYBACK_RESTORE_MODE_OPTIONS,
    REPLAY_GAIN_MODE_OPTIONS,
    playbackSettings
  } from '$lib/stores/playback-settings';
  import { rafSettings } from '$lib/stores/raf-settings';
  import { formatDisplayVersion } from '$lib/utils/version';
  import {
    MAX_VISUALIZER_FRAME_RATE_LIMIT,
    MIN_VISUALIZER_FRAME_RATE_LIMIT,
    VISUALIZER_COLOR_SOURCE_OPTIONS,
    VISUALIZER_STYLE_OPTIONS,
    visualizerSettings
  } from '$lib/stores/visualizer-settings';
  import type {
    BackdropZoneEffect,
    BackdropZoneId,
    ColorTheme,
    LyricsDisplayStyle,
    PlaybackRestoreMode,
    ReplayGainMode,
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

  const requestedView = getOptionsViewFromLocation(window.location);
  let activeView: OptionsViewName = window.location.search
    ? requestedView
    : getOptionsWindowState().activeView;
  if (activeView === 'raf' && !playbackSettings.getSnapshot().enableRaf) {
    activeView = 'playback';
  }
  let fieldHintsExpanded = false;
  let pendingStereoSeparation: number | null = null;
  let pendingPanStrength: number | null = null;
  let localFontFamilies: string[] = [];
  let localFontsLoading = false;
  let localFontsError = '';
  let localFontAccessGranted = false;
  const localFontAccessSupported = supportsLocalFontAccess();
  let localFontPermissionChecked = !localFontAccessSupported;
  const displayVersion = formatDisplayVersion(appVersion);

  type TriangleVisualizerSetting =
    | 'triangleCount'
    | 'triangleMinSize'
    | 'triangleMaxSize'
    | 'triangleBaseSpeed'
    | 'triangleReactiveSpeed'
    | 'triangleBorderWidth';

  function setActiveView(view: OptionsViewName) {
    if (view === 'raf' && !playbackSettings.getSnapshot().enableRaf) {
      view = 'playback';
    }
    activeView = view;
    rememberOptionsActiveView(view);

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

  function handleCompactPlayerBarToggle(event: Event) {
    appearanceSettings.update({
      compactPlayerBar: (event.currentTarget as HTMLInputElement).checked
    });
  }

  function handleNowPlayingArtworkPlayerColorsToggle(event: Event) {
    appearanceSettings.update({
      useNowPlayingArtworkPlayerColors: (event.currentTarget as HTMLInputElement).checked
    });
  }

  function handleCompactColumnLayoutToggle(event: Event) {
    appearanceSettings.update({
      keepLibraryColumnsVisibleInNarrowLayout: (event.currentTarget as HTMLInputElement).checked
    });
  }

  function handleEmptyWorkspacePanelsToggle(event: Event) {
    appearanceSettings.update({
      keepEmptyWorkspacePanelsOpen: (event.currentTarget as HTMLInputElement).checked
    });
  }

  function handleIdlePlayerQuipsToggle(event: Event) {
    appearanceSettings.update({
      showIdlePlayerQuips: (event.currentTarget as HTMLInputElement).checked
    });
  }

  function handleAutoNowPlayingToggle(event: Event) {
    appearanceSettings.update({
      autoNowPlayingOnMaximized: (event.currentTarget as HTMLInputElement).checked
    });
  }

  function handleNowPlayingPanelAutoHideChange(event: Event) {
    appearanceSettings.update({
      nowPlayingPanelAutoHideDelaySeconds: normalizeNowPlayingPanelAutoHideDelaySeconds(
        (event.currentTarget as HTMLInputElement).valueAsNumber
      )
    });
  }

  function handleFontFamilyChange(event: Event) {
    appearanceSettings.update({
      fontFamily: (event.currentTarget as HTMLSelectElement).value
    });
  }

  async function loadLocalFonts() {
    localFontsLoading = true;
    localFontsError = '';

    try {
      localFontFamilies = await queryLocalFontFamilies();
      localFontAccessGranted = true;
      if (localFontFamilies.length === 0) {
        localFontsError = 'No local fonts were returned.';
      }
    } catch (error) {
      localFontsError = error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Local font permission was not granted.'
        : 'Local fonts could not be loaded.';
    } finally {
      localFontsLoading = false;
    }
  }

  function handleUseLocalFonts(event: MouseEvent) {
    event.preventDefault();
    void loadLocalFonts();
  }

  function handleBackdropZoneChange(event: Event, zone: BackdropZoneId) {
    appearanceSettings.update({
      backdropZones: {
        ...appearanceSettings.getSnapshot().backdropZones,
        [zone]: (event.currentTarget as HTMLSelectElement).value as BackdropZoneEffect
      }
    });
  }

  function handleBackdropArtworkBlurChange(event: Event, zone: BackdropZoneId) {
    const settings = appearanceSettings.getSnapshot();

    appearanceSettings.update({
      backdropZoneArtwork: {
        ...settings.backdropZoneArtwork,
        [zone]: {
          ...settings.backdropZoneArtwork[zone],
          blur: normalizeBackdropZoneArtworkBlur((event.currentTarget as HTMLInputElement).valueAsNumber)
        }
      }
    });
  }

  function handleBackdropArtworkBrightnessChange(event: Event, zone: BackdropZoneId) {
    const settings = appearanceSettings.getSnapshot();

    appearanceSettings.update({
      backdropZoneArtwork: {
        ...settings.backdropZoneArtwork,
        [zone]: {
          ...settings.backdropZoneArtwork[zone],
          brightness: normalizeBackdropZoneArtworkBrightness(
            (event.currentTarget as HTMLInputElement).valueAsNumber
          )
        }
      }
    });
  }

  function handleWindowTitleToggle(event: Event) {
    appearanceSettings.update({
      showTrackTitleInWindowTitle: (event.currentTarget as HTMLInputElement).checked
    });
  }

  function handleLyricsStyleChange(event: Event) {
    appearanceSettings.update({
      lyrics: {
        ...appearanceSettings.getSnapshot().lyrics,
        displayStyle: (event.currentTarget as HTMLSelectElement).value as LyricsDisplayStyle
      }
    });
  }

  function handleLyricsAutoScrollToggle(event: Event) {
    appearanceSettings.update({
      lyrics: {
        ...appearanceSettings.getSnapshot().lyrics,
        autoScroll: (event.currentTarget as HTMLInputElement).checked
      }
    });
  }

  function handleLyricsFontSizeChange(event: Event) {
    const lyricsSettings = appearanceSettings.getSnapshot().lyrics;
    const displayStyle = lyricsSettings.displayStyle;

    appearanceSettings.update({
      lyrics: {
        ...lyricsSettings,
        fontSizes: {
          ...lyricsSettings.fontSizes,
          [displayStyle]: normalizeLyricsFontSize(
            displayStyle,
            (event.currentTarget as HTMLInputElement).valueAsNumber
          )
        }
      }
    });
  }

  function handleLyricsTheaterDotsToggle(event: Event) {
    appearanceSettings.update({
      lyrics: {
        ...appearanceSettings.getSnapshot().lyrics,
        theaterDowntimeDots: (event.currentTarget as HTMLInputElement).checked
      }
    });
  }

  function handleLyricsDowntimeThresholdChange(event: Event) {
    appearanceSettings.update({
      lyrics: {
        ...appearanceSettings.getSnapshot().lyrics,
        theaterDowntimeThresholdSeconds: normalizeLyricsDowntimeThresholdSeconds(
          (event.currentTarget as HTMLInputElement).valueAsNumber
        )
      }
    });
  }

  function handleLyricsTheaterSmoothScrollToggle(event: Event) {
    appearanceSettings.update({
      lyrics: {
        ...appearanceSettings.getSnapshot().lyrics,
        theaterSmoothScroll: (event.currentTarget as HTMLInputElement).checked
      }
    });
  }

  function handleLyricsOpenPanelToggle(event: Event) {
    appearanceSettings.update({
      lyrics: {
        ...appearanceSettings.getSnapshot().lyrics,
        openPanelForLyrics: (event.currentTarget as HTMLInputElement).checked
      }
    });
  }

  function handleLyricsClosePanelToggle(event: Event) {
    appearanceSettings.update({
      lyrics: {
        ...appearanceSettings.getSnapshot().lyrics,
        closePanelWithoutLyrics: (event.currentTarget as HTMLInputElement).checked
      }
    });
  }

  function handleLyricsAutoTheaterToggle(event: Event) {
    appearanceSettings.update({
      lyrics: {
        ...appearanceSettings.getSnapshot().lyrics,
        autoTheaterInNowPlaying: (event.currentTarget as HTMLInputElement).checked
      }
    });
  }

  function handleLyricsAutoFocusToggle(event: Event) {
    appearanceSettings.update({
      lyrics: {
        ...appearanceSettings.getSnapshot().lyrics,
        autoFocusInNowPlaying: (event.currentTarget as HTMLInputElement).checked
      }
    });
  }

  function handleLogarithmicVolumeToggle(event: Event) {
    playbackSettings.update({
      logarithmicVolume: (event.currentTarget as HTMLInputElement).checked
    });
  }

  function handleReplayGainModeChange(event: Event) {
    playbackSettings.update({
      replayGainMode: (event.currentTarget as HTMLSelectElement).value as ReplayGainMode
    });
  }

  function handlePlaybackRestoreModeChange(event: Event) {
    playbackSettings.update({
      restoreMode: (event.currentTarget as HTMLSelectElement).value as PlaybackRestoreMode
    });
  }

  function handleEnableRafToggle(event: Event) {
    const enableRaf = (event.currentTarget as HTMLInputElement).checked;
    playbackSettings.update({ enableRaf });
    if (!enableRaf && activeView === 'raf') {
      setActiveView('playback');
    }
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

  function handleVisualizerFrameRateLimitChange(event: Event) {
    visualizerSettings.update({
      frameRateLimit: (event.currentTarget as HTMLInputElement).valueAsNumber
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

    if (activeView === 'backdrops' || activeView === 'now-playing' || activeView === 'lyrics') {
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

    if (activeView === 'raf') {
      rafSettings.reset();
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

  onMount(() => {
    rememberOptionsActiveView(activeView);
    const rememberWindowSize = () => {
      rememberOptionsWindowSize(window.outerWidth, window.outerHeight);
    };

    void hasLocalFontAccessPermission().then((granted) => {
      localFontPermissionChecked = true;
      if (granted) {
        localFontAccessGranted = true;
        void loadLocalFonts();
      }
    });

    const syncActiveViewFromLocation = () => setActiveView(getOptionsViewFromLocation(window.location));
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
    window.addEventListener('resize', rememberWindowSize);
    window.addEventListener('focus', closeIfMainWindowClosed);
    document.addEventListener('visibilitychange', closeIfMainWindowClosed);
    const openerCheckInterval = window.setInterval(closeIfMainWindowClosed, 1000);

    return () => {
      window.clearInterval(openerCheckInterval);
      window.removeEventListener('popstate', syncActiveViewFromLocation);
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('resize', rememberWindowSize);
      window.removeEventListener('focus', closeIfMainWindowClosed);
      document.removeEventListener('visibilitychange', closeIfMainWindowClosed);
    };
  });

  $: overlayState = $windowControlsOverlayState;
  $: if (activeView === 'raf' && !$playbackSettings.enableRaf) {
    setActiveView('playback');
  }
  $: overlayRect = overlayState.titlebarAreaRect;
  $: overlayInlineStyle = overlayState.visible
    ? `--window-controls-overlay-x: ${overlayRect.x}px; --window-controls-overlay-y: ${overlayRect.y}px; --window-controls-overlay-width: ${overlayRect.width}px; --window-controls-overlay-height: ${overlayRect.height}px;`
    : '';
  $: activeViewDefinition = OPTIONS_VIEWS[activeView];
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
  $: lyricsFontSizeLimits = LYRICS_FONT_SIZE_LIMITS[$appearanceSettings.lyrics.displayStyle];
  $: lyricsFontSizeValue = $appearanceSettings.lyrics.fontSizes[$appearanceSettings.lyrics.displayStyle];
  $: lyricsFontSizePercent = Math.round(lyricsFontSizeValue * 100);
  $: nowPlayingPanelAutoHideLabel =
    $appearanceSettings.nowPlayingPanelAutoHideDelaySeconds >= NOW_PLAYING_PANEL_AUTO_HIDE_NEVER_SECONDS
      ? 'Never hide'
      : `${$appearanceSettings.nowPlayingPanelAutoHideDelaySeconds}s`;
</script>

<svelte:head>
  <title>izci Options</title>
</svelte:head>

<svelte:window
  on:contextmenu={handleWindowContextMenu}
/>

<div
  class="options-shell"
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
      <span class="material-symbols-outlined window-topbar-separator window-topbar-prefix-separator" aria-hidden="true">
        chevron_right
      </span>
      <span class="window-topbar-breadcrumbs">
        {#if activeViewDefinition.parentLabel}
          <span class="window-topbar-crumb window-topbar-parent">{activeViewDefinition.parentLabel}</span>
          <span class="material-symbols-outlined window-topbar-separator window-topbar-parent-separator" aria-hidden="true">
            chevron_right
          </span>
        {/if}
        <span class="window-topbar-crumb is-current">{activeViewDefinition.label}</span>
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

  <main class="options-main">
    <aside class="tree-panel" aria-label="Options categories">
      <div class="tree" role="tree" aria-label="Options categories">
        {#each OPTIONS_VIEW_GROUPS as group}
          <div class="tree-group" role="none">
            {#each group as view}
              {#if view.id !== 'raf' || $playbackSettings.enableRaf}
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
              {/if}
            {/each}
          </div>
        {/each}
      </div>
    </aside>

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
              <label class="field">
                <div class="field-copy">
                  <span class="field-title">Font</span>
                </div>
                <div class="field-control font-control">
                  <select value={$appearanceSettings.fontFamily} on:change={handleFontFamilyChange}>
                    <option value={SYSTEM_FONT_FAMILY}>System</option>
                    {#if $appearanceSettings.fontFamily !== SYSTEM_FONT_FAMILY && !localFontFamilies.includes($appearanceSettings.fontFamily)}
                      <option value={$appearanceSettings.fontFamily}>{$appearanceSettings.fontFamily}</option>
                    {/if}
                    {#each localFontFamilies as family}
                      <option value={family}>{family}</option>
                    {/each}
                  </select>
                  {#if localFontAccessSupported && localFontPermissionChecked && !localFontAccessGranted}
                    <a href="#local-fonts" on:click={handleUseLocalFonts} aria-disabled={localFontsLoading}>
                      {localFontsLoading ? 'Loading local fonts…' : 'Use local fonts…'}
                    </a>
                  {/if}
                </div>
                <p class="field-hint">
                  {#if localFontsError}
                    {localFontsError}
                  {:else if localFontAccessSupported}
                    Applies the system interface font or a permitted local font across the app.
                  {:else}
                    Local Font Access is not supported by this browser.
                  {/if}
                </p>
              </label>

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
                  <span class="field-title">Compact player bar</span>
                </div>
                <div class="field-control checkbox-control">
                  <input
                    type="checkbox"
                    checked={$appearanceSettings.compactPlayerBar}
                    on:change={handleCompactPlayerBarToggle}
                  />
                </div>
                <p class="field-hint">
                  Fits track information, compact transport controls, seek, and popup volume into one small row.
                </p>
              </label>

              <label class="field checkbox-field">
                <div class="field-copy">
                  <span class="field-title">Keep empty workspace panels open</span>
                </div>
                <div class="field-control checkbox-control">
                  <input
                    type="checkbox"
                    checked={$appearanceSettings.keepEmptyWorkspacePanelsOpen}
                    on:change={handleEmptyWorkspacePanelsToggle}
                  />
                </div>
                <p class="field-hint">
                  Leaves a dock panel in place after its last tab closes instead of letting neighboring panels fill the space.
                </p>
              </label>

              <label class="field checkbox-field">
                <div class="field-copy">
                  <span class="field-title">Show idle player quips</span>
                </div>
                <div class="field-control checkbox-control">
                  <input
                    type="checkbox"
                    checked={$appearanceSettings.showIdlePlayerQuips}
                    on:change={handleIdlePlayerQuipsToggle}
                  />
                </div>
                <p class="field-hint">
                  Shows a randomly chosen quip in the idle player bar when the playlist or library has music.
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

      {#if activeView === 'backdrops'}
        <article class="view">
          <div class="section">
            <h2>Backdrop Zones</h2>
            <div class="field-grid">
              {#each BACKDROP_ZONE_IDS as zone}
                <div class="field backdrop-zone-field">
                  <label class="backdrop-zone-effect-row">
                    <div class="field-copy">
                      <span class="field-title">{BACKDROP_ZONE_LABELS[zone]}</span>
                    </div>
                    <div class="field-control">
                      <select
                        value={$appearanceSettings.backdropZones[zone]}
                        on:change={(event) => handleBackdropZoneChange(event, zone)}
                      >
                        {#each BACKDROP_EFFECT_OPTIONS as option}
                          <option value={option.value}>{option.label}</option>
                        {/each}
                      </select>
                    </div>
                  </label>

                  {#if hasArtworkBackdrop($appearanceSettings.backdropZones[zone])}
                    <label class="backdrop-zone-slider">
                      <span class="backdrop-zone-slider-label">Artwork blur strength</span>
                      <div class="field-control">
                        <input
                          type="range"
                          min={MIN_BACKDROP_ARTWORK_BLUR}
                          max={MAX_BACKDROP_ARTWORK_BLUR}
                          step="1"
                          value={$appearanceSettings.backdropZoneArtwork[zone].blur}
                          on:input={(event) => handleBackdropArtworkBlurChange(event, zone)}
                        />
                        <span class="field-output">{$appearanceSettings.backdropZoneArtwork[zone].blur}px</span>
                      </div>
                    </label>

                    <label class="backdrop-zone-slider">
                      <span class="backdrop-zone-slider-label">Artwork brightness</span>
                      <div class="field-control">
                        <input
                          type="range"
                          min={MIN_BACKDROP_ARTWORK_BRIGHTNESS}
                          max={MAX_BACKDROP_ARTWORK_BRIGHTNESS}
                          step="1"
                          value={$appearanceSettings.backdropZoneArtwork[zone].brightness}
                          aria-valuetext={`${$appearanceSettings.backdropZoneArtwork[zone].brightness}%`}
                          on:input={(event) => handleBackdropArtworkBrightnessChange(event, zone)}
                        />
                        <span class="field-output">{$appearanceSettings.backdropZoneArtwork[zone].brightness}%</span>
                      </div>
                    </label>
                  {/if}
                </div>
              {/each}
            </div>
          </div>
        </article>
      {/if}

      {#if activeView === 'now-playing'}
        <article class="view">
          <div class="section">
            <h2>Now Playing</h2>
            <div class="field-grid">
              <label class="field checkbox-field">
                <div class="field-copy">
                  <span class="field-title">Open when maximized</span>
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

              <label class="field">
                <div class="field-copy">
                  <span class="field-title">Hide side chrome after</span>
                </div>
                <div class="field-control">
                  <input
                    type="range"
                    min={MIN_NOW_PLAYING_PANEL_AUTO_HIDE_SECONDS}
                    max={NOW_PLAYING_PANEL_AUTO_HIDE_NEVER_SECONDS}
                    step="1"
                    value={$appearanceSettings.nowPlayingPanelAutoHideDelaySeconds}
                    on:input={handleNowPlayingPanelAutoHideChange}
                  />
                  <span class="field-output">{nowPlayingPanelAutoHideLabel}</span>
                </div>
                <p class="field-hint">
                  Fades the side tabs, pane fill, and close button after mouse inactivity.
                </p>
              </label>

              <label class="field checkbox-field">
                <div class="field-copy">
                  <span class="field-title">Always use artwork colors</span>
                </div>
                <div class="field-control checkbox-control">
                  <input
                    type="checkbox"
                    checked={$appearanceSettings.useNowPlayingArtworkPlayerColors}
                    on:change={handleNowPlayingArtworkPlayerColorsToggle}
                  />
                </div>
                <p class="field-hint">
                  Forces the focused player controls to use artwork colors. When off, Now Playing follows the main player setting.
                </p>
              </label>

              <label class="field checkbox-field">
                <div class="field-copy">
                  <span class="field-title">Auto switch to Theater</span>
                </div>
                <div class="field-control checkbox-control">
                  <input
                    type="checkbox"
                    checked={$appearanceSettings.lyrics.autoTheaterInNowPlaying}
                    on:change={handleLyricsAutoTheaterToggle}
                  />
                </div>
                <p class="field-hint">
                  Uses the large focused lyrics layout while Now Playing is active.
                </p>
              </label>

              <label class="field checkbox-field">
                <div class="field-copy">
                  <span class="field-title">Auto focus Lyrics tab</span>
                </div>
                <div class="field-control checkbox-control">
                  <input
                    type="checkbox"
                    checked={$appearanceSettings.lyrics.autoFocusInNowPlaying}
                    on:change={handleLyricsAutoFocusToggle}
                  />
                </div>
                <p class="field-hint">
                  Opens Now Playing directly to the lyrics view.
                </p>
              </label>
            </div>
          </div>
        </article>
      {/if}

      {#if activeView === 'lyrics'}
        <article class="view">
          <div class="section">
            <h2>Lyrics</h2>
            <div class="field-grid">
              <label class="field">
                <div class="field-copy">
                  <span class="field-title">Display style</span>
                </div>
                <div class="field-control">
                  <select value={$appearanceSettings.lyrics.displayStyle} on:change={handleLyricsStyleChange}>
                    {#each LYRICS_STYLE_OPTIONS as option}
                      <option value={option.value}>{option.label}</option>
                    {/each}
                  </select>
                </div>
                <p class="field-hint">
                  Chooses how embedded synced lyrics render in the Lyrics panel.
                </p>
              </label>

              <label class="field">
                <div class="field-copy">
                  <span class="field-title">Font size</span>
                </div>
                <div class="field-control">
                  <input
                    type="range"
                    min={lyricsFontSizeLimits.min}
                    max={lyricsFontSizeLimits.max}
                    step={lyricsFontSizeLimits.step}
                    value={lyricsFontSizeValue}
                    on:input={handleLyricsFontSizeChange}
                  />
                  <span class="field-output">{lyricsFontSizePercent}%</span>
                </div>
                <p class="field-hint">
                  Saves a separate size for Plain text, Timestamped rows, and Theater.
                </p>
              </label>

              {#if $appearanceSettings.lyrics.displayStyle !== 'theater'}
                <label class="field checkbox-field">
                  <div class="field-copy">
                    <span class="field-title">Auto scroll to current line</span>
                  </div>
                  <div class="field-control checkbox-control">
                    <input
                      type="checkbox"
                      checked={$appearanceSettings.lyrics.autoScroll}
                      on:change={handleLyricsAutoScrollToggle}
                    />
                  </div>
                  <p class="field-hint">
                    Keeps the highlighted lyric row in view while playback advances.
                  </p>
                </label>
              {:else}
                <label class="field checkbox-field">
                  <div class="field-copy">
                    <span class="field-title">Downtime dots</span>
                  </div>
                  <div class="field-control checkbox-control">
                    <input
                      type="checkbox"
                      checked={$appearanceSettings.lyrics.theaterDowntimeDots}
                      on:change={handleLyricsTheaterDotsToggle}
                    />
                  </div>
                <p class="field-hint">
                  Shows a three-dot break marker during long gaps between synced lines.
                </p>
              </label>

                <label class="field">
                  <div class="field-copy">
                    <span class="field-title">Downtime after</span>
                  </div>
                  <div class="field-control">
                    <input
                      type="range"
                      min={MIN_LYRICS_DOWNTIME_THRESHOLD_SECONDS}
                      max={MAX_LYRICS_DOWNTIME_THRESHOLD_SECONDS}
                      step="1"
                      value={$appearanceSettings.lyrics.theaterDowntimeThresholdSeconds}
                      disabled={!$appearanceSettings.lyrics.theaterDowntimeDots}
                      on:input={handleLyricsDowntimeThresholdChange}
                    />
                    <span class="field-output">{$appearanceSettings.lyrics.theaterDowntimeThresholdSeconds}s</span>
                  </div>
                  <p class="field-hint">
                    Sets how long a synced lyric gap must last before Theater shows the break marker.
                  </p>
                </label>

                <label class="field checkbox-field">
                  <div class="field-copy">
                    <span class="field-title">Smooth Theater scroll</span>
                  </div>
                  <div class="field-control checkbox-control">
                    <input
                      type="checkbox"
                      checked={$appearanceSettings.lyrics.theaterSmoothScroll}
                      on:change={handleLyricsTheaterSmoothScrollToggle}
                    />
                  </div>
                  <p class="field-hint">
                    Animates Theater line changes instead of snapping directly to the active line.
                  </p>
                </label>
              {/if}

              <label class="field checkbox-field">
                <div class="field-copy">
                  <span class="field-title">Open Lyrics when available</span>
                </div>
                <div class="field-control checkbox-control">
                  <input
                    type="checkbox"
                    checked={$appearanceSettings.lyrics.openPanelForLyrics}
                    on:change={handleLyricsOpenPanelToggle}
                  />
                </div>
                <p class="field-hint">
                  Opens the Lyrics panel when the selected track has embedded lyrics.
                </p>
              </label>

              <label class="field checkbox-field">
                <div class="field-copy">
                  <span class="field-title">Close Lyrics when unavailable</span>
                </div>
                <div class="field-control checkbox-control">
                  <input
                    type="checkbox"
                    checked={$appearanceSettings.lyrics.closePanelWithoutLyrics}
                    on:change={handleLyricsClosePanelToggle}
                  />
                </div>
                <p class="field-hint">
                  Falls back to Details when it is open, otherwise closes the right panel.
                </p>
              </label>

            </div>
          </div>
        </article>
      {/if}

      {#if activeView === 'playback'}
        <article class="view">
          <div class="section">
            <h2>Startup</h2>
            <div class="field-grid">
              <label class="field">
                <div class="field-copy">
                  <span class="field-title">Restore playback</span>
                </div>
                <div class="field-control">
                  <select
                    value={$playbackSettings.restoreMode}
                    on:change={handlePlaybackRestoreModeChange}
                  >
                    {#each PLAYBACK_RESTORE_MODE_OPTIONS as option}
                      <option value={option.value}>{option.label}</option>
                    {/each}
                  </select>
                </div>
                <p class="field-hint">
                  Restores the current track and position after a reload. Position and state also resumes playback when Chromium allows it.
                </p>
              </label>
            </div>
          </div>

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

              <label class="field">
                <div class="field-copy">
                  <span class="field-title">ReplayGain</span>
                </div>
                <div class="field-control">
                  <select value={$playbackSettings.replayGainMode} on:change={handleReplayGainModeChange}>
                    {#each REPLAY_GAIN_MODE_OPTIONS as option}
                      <option value={option.value}>{option.label}</option>
                    {/each}
                  </select>
                </div>
                <p class="field-hint">
                  Applies streamed-file ReplayGain tags, preferring track or album gain when both are available.
                </p>
              </label>
            </div>
          </div>

          <div class="section">
            <h2>Effects</h2>
            <div class="field-grid">
              <label class="field checkbox-field">
                <div class="field-copy">
                  <span class="field-title">Enable Raf</span>
                </div>
                <div class="field-control checkbox-control">
                  <input
                    type="checkbox"
                    checked={$playbackSettings.enableRaf}
                    on:change={handleEnableRafToggle}
                  />
                </div>
                <p class="field-hint">
                  Enables the built-in audio effects rack and shows Raf under Playback.
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
      {/if}

      {#if activeView === 'raf'}
        <RafView />
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
                <p class="about-meta">Version {displayVersion}</p>
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
