<script lang="ts">
  import { onMount } from 'svelte';
  import { PlatformAppearanceSettings } from '$platform';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import ThemedSelect from '$lib/components/options/ThemedSelect.svelte';
  import { COLOR_THEME_DEFINITIONS, systemColorScheme } from '$lib/services/theme';
  import { t } from 'svelte-i18n';
  import { APP_LOCALE_OPTIONS, appLocale } from '$lib/i18n';
  import { hasLocalFontAccessPermission, queryLocalFontFamilies, supportsLocalFontAccess } from '$lib/services/local-fonts';
  import {
    CONTEXTUAL_TAB_AUTOMATION_OPTIONS,
    MAX_COLOR_HUE,
    MAX_COLOR_SATURATION,
    MIN_COLOR_HUE,
    MIN_COLOR_SATURATION,
    MAX_SYNTHWAVE_BACKGROUND_BRIGHTNESS,
    MIN_SYNTHWAVE_BACKGROUND_BRIGHTNESS,
    SYSTEM_FONT_FAMILY,
    appearanceSettings
  } from '$lib/stores/appearance-settings';
  import type { ColorTheme, ColorThemeMode, ContextualTabAutomation, ContextualWorkspaceTab, LibraryNavigationStyle } from '$lib/types';

  type BooleanAppearanceSetting =
    | 'useArtworkPlayerColors'
    | 'compactPlayerBar'
    | 'keepLibraryColumnsVisibleInNarrowLayout'
    | 'keepEmptyWorkspacePanelsOpen'
    | 'collapseSingleTabWorkspaceBar'
    | 'alwaysShowUpNext'
    | 'showLibraryAlbumArtworkBackdrop'
    | 'showIdlePlayerQuips'
    | 'showTrackTitleInWindowTitle';
  type FontFamilyOption = { value: string; label: string };
  const INTERFACE_TOGGLES: Array<{ key: BooleanAppearanceSetting; title: string; hint: string }> = [
    { key: 'keepLibraryColumnsVisibleInNarrowLayout', title: 'Keep columns visible in narrow library panels', hint: 'Prevents the slim-window library view from collapsing to title-only rows.' },
    { key: 'showLibraryAlbumArtworkBackdrop', title: 'Show album artwork backdrop in Library', hint: 'Shows a blurred album cover behind its songs after you open an album.' },
    { key: 'compactPlayerBar', title: 'Compact player bar', hint: 'Fits track information, compact transport controls, seek, and popup volume into one small row.' },
    { key: 'keepEmptyWorkspacePanelsOpen', title: 'Keep empty workspace panels open', hint: 'Leaves a dock panel in place after its last tab closes instead of letting neighboring panels fill the space.' },
    { key: 'collapseSingleTabWorkspaceBar', title: 'Collapse tab bar when a pane has a single tab', hint: 'Hides the tab strip in panes with only one tab so media covers the full pane.' },
    { key: 'alwaysShowUpNext', title: 'Always show queue', hint: 'Keeps the queue panel under the Queue expanded and visible, even when the queue is empty.' },
    { key: 'showIdlePlayerQuips', title: 'Show idle player quips', hint: 'Shows a randomly chosen quip in the idle player bar when the queue or library has music.' },
    { key: 'showTrackTitleInWindowTitle', title: 'Show track title in window title', hint: 'Shows the current track title in the main app window title. Turn it off to always show only "izci".' }
  ];

  let localFontFamilies: string[] = [];
  let localFontsLoading = false;
  let localFontsError: '' | 'empty' | 'permission' | 'load' = '';
  let localFontAccessGranted = false;
  const localFontAccessSupported = supportsLocalFontAccess();
  let localFontPermissionChecked = !localFontAccessSupported;

  function checked(event: Event) { return (event.currentTarget as HTMLInputElement).checked; }
  $: effectiveColorScheme = $appearanceSettings.colorThemeMode === 'system'
    ? $systemColorScheme
    : $appearanceSettings.colorThemeMode;
  $: activeColorTheme = effectiveColorScheme === 'light'
    ? $appearanceSettings.lightColorTheme
    : $appearanceSettings.darkColorTheme;
  $: availableColorThemes = COLOR_THEME_DEFINITIONS.filter((theme) => theme.variants[effectiveColorScheme]);
  $: isAccented = activeColorTheme === 'accented';
  $: colorHue = isAccented ? $appearanceSettings.accentedHue : $appearanceSettings.chameleonHue;
  $: colorSaturation = isAccented ? $appearanceSettings.accentedSaturation : $appearanceSettings.chameleonSaturation;

  function handleColorThemeChange(event: CustomEvent<string>) {
    const value = event.detail;
    appearanceSettings.update(effectiveColorScheme === 'light'
      ? { lightColorTheme: value as ColorTheme }
      : { darkColorTheme: value as ColorTheme });
  }
  function handleColorThemeModeChange(event: CustomEvent<string>) { appearanceSettings.update({ colorThemeMode: event.detail as ColorThemeMode }); }
  function handleLanguageChange(event: CustomEvent<string>) { appLocale.set(event.detail); }
  function handleColorHueInput(event: Event) {
    const hue = Number((event.currentTarget as HTMLInputElement).value);
    appearanceSettings.update(isAccented ? { accentedHue: hue } : { chameleonHue: hue });
  }
  function handleColorSaturationInput(event: Event) {
    const saturation = Number((event.currentTarget as HTMLInputElement).value);
    appearanceSettings.update(isAccented ? { accentedSaturation: saturation } : { chameleonSaturation: saturation });
  }
  function handleSynthwaveBackgroundBrightnessInput(event: Event) { appearanceSettings.update({ synthwaveBackgroundBrightness: Number((event.currentTarget as HTMLInputElement).value) }); }
  function handleAppearanceToggle(event: Event, key: BooleanAppearanceSetting) { appearanceSettings.update({ [key]: checked(event) }); }
  function handleFontFamilyChange(event: CustomEvent<string>) { appearanceSettings.update({ fontFamily: event.detail }); }
  function handleLibraryNavigationChange(event: CustomEvent<string>) { appearanceSettings.update({ libraryNavigationStyle: event.detail as LibraryNavigationStyle }); }
  function handleContextualTabChange(event: CustomEvent<string>, tab: ContextualWorkspaceTab) {
    appearanceSettings.update({
      contextualTabs: {
        ...appearanceSettings.getSnapshot().contextualTabs,
        [tab]: event.detail as ContextualTabAutomation
      }
    });
  }

  async function loadLocalFonts() {
    localFontsLoading = true;
    localFontsError = '';
    try {
      localFontFamilies = await queryLocalFontFamilies();
      localFontAccessGranted = true;
      if (localFontFamilies.length === 0) localFontsError = 'empty';
    } catch (error) {
      localFontsError = error instanceof DOMException && error.name === 'NotAllowedError' ? 'permission' : 'load';
    } finally {
      localFontsLoading = false;
    }
  }

  function handleUseLocalFonts() { void loadLocalFonts(); }

  function themeLabel(value: ColorTheme): string {
    switch (value) {
      case 'pale': return $t('options.appearance.themes.pale', { default: 'Pale (default)' });
      case 'accented': return $t('options.appearance.themes.accented', { default: 'Accented' });
      case 'lights-out': return $t('options.appearance.themes.lightsOut', { default: 'Lights Out' });
      case 'solarized': return $t('options.appearance.themes.solarized', { default: 'Solarized' });
      case 'nordic': return $t('options.appearance.themes.nordic', { default: 'Nordic' });
      case 'gruvbox': return $t('options.appearance.themes.gruvbox', { default: 'Gruvbox' });
      case 'dracula': return $t('options.appearance.themes.dracula', { default: 'Dracula' });
      case 'ember': return $t('options.appearance.themes.ember', { default: 'Ember' });
      case 'synthwave': return $t('options.appearance.themes.synthwave', { default: 'Synthwave' });
      case 'chameleon': return $t('options.appearance.themes.chameleon', { default: 'Chameleon' });
    }
  }

  function automationLabel(value: ContextualTabAutomation): string {
    if (value === 'manual') return $t('options.appearance.contextualTabs.options.manual', { default: 'Manual' });
    if (value === 'open') return $t('options.appearance.contextualTabs.options.open', { default: 'Open when available' });
    return $t('options.appearance.contextualTabs.options.openClose', { default: 'Open and close automatically' });
  }

  function toggleTitle(toggle: typeof INTERFACE_TOGGLES[number]): string {
    switch (toggle.key) {
      case 'keepLibraryColumnsVisibleInNarrowLayout': return $t('options.appearance.interface.keepColumns.title', { default: 'Keep columns visible in narrow library panels' });
      case 'showLibraryAlbumArtworkBackdrop': return $t('options.appearance.interface.libraryArtwork.title', { default: 'Show album artwork backdrop in Library' });
      case 'compactPlayerBar': return $t('options.appearance.interface.compactPlayerBar.title', { default: 'Compact player bar' });
      case 'keepEmptyWorkspacePanelsOpen': return $t('options.appearance.interface.keepPanels.title', { default: 'Keep empty workspace panels open' });
      case 'collapseSingleTabWorkspaceBar': return $t('options.appearance.interface.singleTabBar.title', { default: 'Collapse tab bar when a pane has a single tab' });
      case 'alwaysShowUpNext': return $t('options.appearance.interface.alwaysUpNext.title', { default: 'Always show queue' });
      case 'showIdlePlayerQuips': return $t('options.appearance.interface.idleQuips.title', { default: 'Show idle player quips' });
      default: return $t('options.appearance.interface.windowTitle.title', { default: 'Show track title in window title' });
    }
  }

  function toggleHint(toggle: typeof INTERFACE_TOGGLES[number]): string {
    switch (toggle.key) {
      case 'keepLibraryColumnsVisibleInNarrowLayout': return $t('options.appearance.interface.keepColumns.hint', { default: 'Prevents the slim-window library view from collapsing to title-only rows.' });
      case 'showLibraryAlbumArtworkBackdrop': return $t('options.appearance.interface.libraryArtwork.hint', { default: 'Shows a blurred album cover behind its songs after you open an album.' });
      case 'compactPlayerBar': return $t('options.appearance.interface.compactPlayerBar.hint', { default: 'Fits track information, compact transport controls, seek, and popup volume into one small row.' });
      case 'keepEmptyWorkspacePanelsOpen': return $t('options.appearance.interface.keepPanels.hint', { default: 'Leaves a dock panel in place after its last tab closes instead of letting neighboring panels fill the space.' });
      case 'collapseSingleTabWorkspaceBar': return $t('options.appearance.interface.singleTabBar.hint', { default: 'Hides the tab strip in panes with only one tab so media covers the full pane.' });
      case 'alwaysShowUpNext': return $t('options.appearance.interface.alwaysUpNext.hint', { default: 'Keeps the queue panel under the Queue expanded and visible, even when the queue is empty.' });
      case 'showIdlePlayerQuips': return $t('options.appearance.interface.idleQuips.hint', { default: 'Shows a randomly chosen quip in the idle player bar when the queue or library has music.' });
      default: return $t('options.appearance.interface.windowTitle.hint', { default: 'Shows the current track title in the main app window title. Turn it off to always show only "izci".' });
    }
  }

  onMount(() => {
    void hasLocalFontAccessPermission().then((granted) => {
      localFontPermissionChecked = true;
      if (granted) { void loadLocalFonts(); }
    });
  });

  $: fontFamilyOptions = [
    { value: SYSTEM_FONT_FAMILY, label: $t('options.appearance.font.system', { default: 'System' }) },
    ...($appearanceSettings.fontFamily !== SYSTEM_FONT_FAMILY && !localFontFamilies.includes($appearanceSettings.fontFamily)
      ? [{ value: $appearanceSettings.fontFamily, label: $appearanceSettings.fontFamily }]
      : []),
    ...localFontFamilies.map((family) => ({ value: family, label: family }))
  ] satisfies FontFamilyOption[];
</script>

<article class="view">
  <div class="section">
    <h2>{$t('options.appearance.language.section', { default: 'Language' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.appearance.language.title', { default: 'Interface language' })}
        hint={$t('options.appearance.language.hint', { default: 'Changes the language in izci and its Options window.' })}
      >
        <ThemedSelect
          value={$appLocale}
          options={APP_LOCALE_OPTIONS}
          label={$t('options.appearance.language.title', { default: 'Interface language' })}
          on:change={handleLanguageChange}
        />
      </SettingsField>
    </div>
  </div>

  <div class="section">
    <h2>{$t('options.appearance.theme.heading', { default: 'Window Theme' })}</h2>
    <div class="field-grid">
      <SettingsField title={$t('options.appearance.theme.title', { default: 'Color theme' })} hint={$t('options.appearance.theme.hint', { default: 'Sets the global color theme.' })}>
          <ThemedSelect
            value={activeColorTheme}
            options={availableColorThemes.map((theme) => ({ value: theme.value, label: themeLabel(theme.value) }))}
            label={$t('options.appearance.theme.title', { default: 'Color theme' })}
            on:change={handleColorThemeChange}
          />
      </SettingsField>

      <SettingsField title={$t('options.appearance.themeMode.title', { default: 'Appearance' })} hint={$t('options.appearance.themeMode.hint', { default: 'Follows the system color preference or keeps the selected appearance.' })}>
        <ThemedSelect
          value={$appearanceSettings.colorThemeMode}
          options={[
            { value: 'system', label: $t('options.appearance.themeMode.system', { default: 'Follow system' }) },
            { value: 'light', label: $t('options.appearance.themeMode.light', { default: 'Light' }) },
            { value: 'dark', label: $t('options.appearance.themeMode.dark', { default: 'Dark' }) }
          ]}
          label={$t('options.appearance.themeMode.title', { default: 'Appearance' })}
          on:change={handleColorThemeModeChange}
        />
      </SettingsField>

      {#if activeColorTheme === 'chameleon' || isAccented}
        <SettingsField
          title={isAccented
            ? $t('options.appearance.accentedColor.title', { default: 'Accent color' })
            : $t('options.appearance.chameleonColor.title', { default: 'Chameleon color' })}
          hint={isAccented
            ? $t('options.appearance.accentedColor.hint', { default: 'Colors active controls, selections, and focus indicators while keeping Pale backgrounds. This choice is remembered when you use another theme.' })
            : $t('options.appearance.chameleonColor.hint', { default: "Fine-tunes Chameleon's hue. This choice is remembered when you use another theme." })}
          fieldClass="theme-color-hue-field"
          controlClass="theme-color-slider-control"
        >
            <input
              class="theme-color-hue-slider"
              type="range"
              min={MIN_COLOR_HUE}
              max={MAX_COLOR_HUE}
              step="1"
              value={colorHue}
              style={`--slider-hue: ${colorHue}; --slider-saturation: ${colorSaturation}%`}
              aria-label={isAccented
                ? $t('options.appearance.accentedColor.hueLabel', { default: 'Accent color hue' })
                : $t('options.appearance.chameleonColor.hueLabel', { default: 'Chameleon color hue' })}
              on:input={handleColorHueInput}
            />
            <output class="theme-color-slider-output" style={`--swatch-hue: ${colorHue}; --swatch-saturation: ${colorSaturation}%`} aria-label={$t('options.appearance.degrees', { default: '{value} degrees', values: { value: colorHue } })}>
              {colorHue}°
            </output>
        </SettingsField>

        <SettingsField
          title={isAccented
            ? $t('options.appearance.accentedSaturation.title', { default: 'Accent saturation' })
            : $t('options.appearance.chameleonSaturation.title', { default: 'Chameleon saturation' })}
          hint={isAccented
            ? $t('options.appearance.accentedSaturation.hint', { default: 'Controls accent intensity. 0% makes the accents neutral; backgrounds stay unchanged.' })
            : $t('options.appearance.chameleonSaturation.hint', { default: "Controls color intensity without changing the theme's contrast or brightness." })}
          fieldClass="theme-color-saturation-field"
          controlClass="theme-color-slider-control"
        >
            <input
              class="theme-color-saturation-slider"
              type="range"
              min={MIN_COLOR_SATURATION}
              max={MAX_COLOR_SATURATION}
              step="1"
              value={colorSaturation}
              style={`--slider-hue: ${colorHue}; --slider-saturation: ${colorSaturation}%`}
              aria-label={isAccented
                ? $t('options.appearance.accentedSaturation.label', { default: 'Accent color saturation' })
                : $t('options.appearance.chameleonSaturation.label', { default: 'Chameleon color saturation' })}
              on:input={handleColorSaturationInput}
            />
            <output class="theme-color-slider-output" style={`--swatch-hue: ${colorHue}; --swatch-saturation: ${colorSaturation}%`} aria-label={$t('options.appearance.percent', { default: '{value} percent', values: { value: colorSaturation } })}>
              {colorSaturation}%
            </output>
        </SettingsField>
      {/if}

      {#if activeColorTheme === 'synthwave'}
        <SettingsField
          title={$t('options.appearance.synthwaveBackgroundBrightness.title', { default: 'Background brightness' })}
          hint={$t('options.appearance.synthwaveBackgroundBrightness.hint', { default: "Scales the sunset, grid, and background glows. 0% hides the scenery entirely; 100% is as loud as it gets." })}
          fieldClass="synthwave-brightness-field"
          controlClass="theme-color-slider-control"
        >
            <input
              class="synthwave-brightness-slider"
              type="range"
              min={MIN_SYNTHWAVE_BACKGROUND_BRIGHTNESS}
              max={MAX_SYNTHWAVE_BACKGROUND_BRIGHTNESS}
              step="1"
              value={$appearanceSettings.synthwaveBackgroundBrightness}
              style={`--slider-hue: 315; --slider-saturation: ${$appearanceSettings.synthwaveBackgroundBrightness}%`}
              aria-label={$t('options.appearance.synthwaveBackgroundBrightness.label', { default: 'Synthwave background brightness' })}
              on:input={handleSynthwaveBackgroundBrightnessInput}
            />
            <output class="theme-color-slider-output" style="--swatch-hue: 315" aria-label={$t('options.appearance.percent', { default: '{value} percent', values: { value: $appearanceSettings.synthwaveBackgroundBrightness } })}>
              {$appearanceSettings.synthwaveBackgroundBrightness}%
            </output>
        </SettingsField>
      {/if}

      <SettingsField
        title={$t('options.appearance.artworkPlayerColors.title', { default: 'Use artwork colors for player' })}
        hint={$t('options.appearance.artworkPlayerColors.hint', { default: 'Tints the player bar from the current artwork, with the selected theme as fallback.' })}
        checkbox
      >
          <input
            type="checkbox"
            checked={$appearanceSettings.useArtworkPlayerColors}
            on:change={(event) => handleAppearanceToggle(event, 'useArtworkPlayerColors')}
          />
      </SettingsField>
    </div>
  </div>

  <div class="section">
    <h2>{$t('options.appearance.interface.heading', { default: 'Interface' })}</h2>
    <div class="field-grid">
      <SettingsField title={$t('options.appearance.font.title', { default: 'Font' })} fieldClass="font-field" controlClass="font-control">
          <ThemedSelect
            value={$appearanceSettings.fontFamily}
            options={fontFamilyOptions}
            label={$t('options.appearance.font.title', { default: 'Font' })}
            on:change={handleFontFamilyChange}
          />
          {#if localFontAccessSupported && localFontPermissionChecked && !localFontAccessGranted}
            <button class="local-font-button" type="button" on:click={handleUseLocalFonts} disabled={localFontsLoading}>
              {localFontsLoading ? $t('options.appearance.font.loading', { default: 'Loading local fonts…' }) : $t('options.appearance.font.useLocal', { default: 'Use local fonts…' })}
            </button>
          {/if}
        <svelte:fragment slot="hint">
          {#if localFontsError}
            {localFontsError === 'empty'
              ? $t('options.appearance.font.noFonts', { default: 'No local fonts were returned.' })
              : localFontsError === 'permission'
                ? $t('options.appearance.font.permissionDenied', { default: 'Local font permission was not granted.' })
                : $t('options.appearance.font.loadFailed', { default: 'Local fonts could not be loaded.' })}
          {:else if PlatformAppearanceSettings}
            {$t('options.appearance.font.desktopHint', { default: 'Applies the system interface font or any installed font across the app.' })}
          {:else if localFontAccessSupported}
            {$t('options.appearance.font.hint', { default: 'Applies the system interface font or a permitted local font across the app.' })}
          {:else}
            {$t('options.appearance.font.unsupported', { default: 'Local Font Access is not supported by this browser.' })}
          {/if}
        </svelte:fragment>
      </SettingsField>

      <SettingsField
        title={$t('options.appearance.interface.libraryNavigation.title', { default: 'Library navigation' })}
        hint={$t('options.appearance.interface.libraryNavigation.hint', { default: 'Shows Library categories as tabs or a list on the left in the main desktop shell. Right-click the categories to choose which are visible.' })}
      >
        <ThemedSelect
          value={$appearanceSettings.libraryNavigationStyle}
          options={[
            { value: 'tabbed', label: $t('options.appearance.interface.libraryNavigation.tabbed', { default: 'Tabbed' }) },
            { value: 'list', label: $t('options.appearance.interface.libraryNavigation.list', { default: 'List' }) }
          ]}
          label={$t('options.appearance.interface.libraryNavigation.title', { default: 'Library navigation' })}
          on:change={handleLibraryNavigationChange}
        />
      </SettingsField>

      {#each INTERFACE_TOGGLES as toggle (toggle.key)}
        <SettingsField
          title={toggleTitle(toggle)}
          hint={toggleHint(toggle)}
          advanced={toggle.key === 'keepLibraryColumnsVisibleInNarrowLayout' || toggle.key === 'keepEmptyWorkspacePanelsOpen' || toggle.key === 'alwaysShowUpNext' || toggle.key === 'collapseSingleTabWorkspaceBar'}
          checkbox
        >
          <input
            type="checkbox"
            checked={$appearanceSettings[toggle.key]}
            on:change={(event) => handleAppearanceToggle(event, toggle.key)}
          />
        </SettingsField>
      {/each}
      {#if PlatformAppearanceSettings}
        <svelte:component this={PlatformAppearanceSettings} />
      {/if}
    </div>
  </div>

  <div class="section">
    <h2>{$t('options.appearance.contextualTabs.heading', { default: 'Contextual Tabs' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.appearance.contextualTabs.lyrics.title', { default: 'Lyrics' })}
        hint={$t('options.appearance.contextualTabs.lyrics.hint', { default: 'Controls whether the Lyrics tab follows embedded lyrics availability for the playing track.' })}
      >
        <ThemedSelect
          value={$appearanceSettings.contextualTabs.lyrics}
          options={CONTEXTUAL_TAB_AUTOMATION_OPTIONS.map((option) => ({ value: option.value, label: automationLabel(option.value) }))}
          label={$t('options.appearance.contextualTabs.lyrics.title', { default: 'Lyrics' })}
          on:change={(event) => handleContextualTabChange(event, 'lyrics')}
        />
      </SettingsField>

      <SettingsField
        title={$t('options.appearance.contextualTabs.patterns.title', { default: 'Patterns' })}
        hint={$t('options.appearance.contextualTabs.patterns.hint', { default: 'Controls whether the Patterns tab follows module pattern availability for the playing track.' })}
      >
        <ThemedSelect
          value={$appearanceSettings.contextualTabs.patterns}
          options={CONTEXTUAL_TAB_AUTOMATION_OPTIONS.map((option) => ({ value: option.value, label: automationLabel(option.value) }))}
          label={$t('options.appearance.contextualTabs.patterns.title', { default: 'Patterns' })}
          on:change={(event) => handleContextualTabChange(event, 'patterns')}
        />
      </SettingsField>
    </div>
  </div>
</article>
