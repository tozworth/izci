<script lang="ts">
  import { onMount } from 'svelte';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import FontFamilyPicker from '../FontFamilyPicker.svelte';
  import { COLOR_THEME_DEFINITIONS, systemColorScheme } from '$lib/services/theme';
  import { t } from 'svelte-i18n';
  import { APP_LOCALE_OPTIONS, appLocale } from '$lib/i18n';
  import { hasLocalFontAccessPermission, queryLocalFontFamilies, supportsLocalFontAccess } from '$lib/services/local-fonts';
  import {
    CONTEXTUAL_TAB_AUTOMATION_OPTIONS,
    MAX_CHAMELEON_HUE,
    MAX_CHAMELEON_SATURATION,
    MIN_CHAMELEON_HUE,
    MIN_CHAMELEON_SATURATION,
    SYSTEM_FONT_FAMILY,
    appearanceSettings
  } from '$lib/stores/appearance-settings';
  import type { ColorTheme, ColorThemeMode } from '$lib/contracts/appearance-settings';
  import type { ContextualTabAutomation, ContextualWorkspaceTab } from '$lib/contracts/workspace';

  type BooleanAppearanceSetting =
    | 'useArtworkPlayerColors'
    | 'compactPlayerBar'
    | 'keepLibraryColumnsVisibleInNarrowLayout'
    | 'keepEmptyWorkspacePanelsOpen'
    | 'showLibraryAlbumArtworkBackdrop'
    | 'showIdlePlayerQuips'
    | 'showTrackTitleInWindowTitle';
  type FontFamilyOption = { value: string; label: string };
  const INTERFACE_TOGGLES: Array<{ key: BooleanAppearanceSetting; title: string; hint: string }> = [
    { key: 'keepLibraryColumnsVisibleInNarrowLayout', title: 'Keep columns visible in narrow library panels', hint: 'Prevents the slim-window library view from collapsing to title-only rows.' },
    { key: 'showLibraryAlbumArtworkBackdrop', title: 'Show album artwork backdrop in Library', hint: 'Shows a blurred album cover behind its songs after you open an album.' },
    { key: 'compactPlayerBar', title: 'Compact player bar', hint: 'Fits track information, compact transport controls, seek, and popup volume into one small row.' },
    { key: 'keepEmptyWorkspacePanelsOpen', title: 'Keep empty workspace panels open', hint: 'Leaves a dock panel in place after its last tab closes instead of letting neighboring panels fill the space.' },
    { key: 'showIdlePlayerQuips', title: 'Show idle player quips', hint: 'Shows a randomly chosen quip in the idle player bar when the playlist or library has music.' },
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

  function handleColorThemeChange(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    appearanceSettings.update(effectiveColorScheme === 'light'
      ? { lightColorTheme: value as ColorTheme }
      : { darkColorTheme: value as ColorTheme });
  }
  function handleColorThemeModeChange(event: Event) { appearanceSettings.update({ colorThemeMode: (event.currentTarget as HTMLSelectElement).value as ColorThemeMode }); }
  function handleLanguageChange(event: Event) { appLocale.set((event.currentTarget as HTMLSelectElement).value); }
  function handleChameleonHueInput(event: Event) { appearanceSettings.update({ chameleonHue: Number((event.currentTarget as HTMLInputElement).value) }); }
  function handleChameleonSaturationInput(event: Event) { appearanceSettings.update({ chameleonSaturation: Number((event.currentTarget as HTMLInputElement).value) }); }
  function handleAppearanceToggle(event: Event, key: BooleanAppearanceSetting) { appearanceSettings.update({ [key]: checked(event) }); }
  function handleFontFamilyChange(event: CustomEvent<string>) { appearanceSettings.update({ fontFamily: event.detail }); }
  function handleContextualTabChange(event: Event, tab: ContextualWorkspaceTab) {
    appearanceSettings.update({
      contextualTabs: {
        ...appearanceSettings.getSnapshot().contextualTabs,
        [tab]: (event.currentTarget as HTMLSelectElement).value as ContextualTabAutomation
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

  function handleUseLocalFonts(event: MouseEvent) { event.preventDefault(); void loadLocalFonts(); }

  function themeLabel(value: ColorTheme): string {
    switch (value) {
      case 'pale': return $t('options.appearance.themes.pale', { default: 'Pale (default)' });
      case 'lights-out': return $t('options.appearance.themes.lightsOut', { default: 'Lights Out' });
      case 'solarized': return $t('options.appearance.themes.solarized', { default: 'Solarized' });
      case 'nordic': return $t('options.appearance.themes.nordic', { default: 'Nordic' });
      case 'gruvbox': return $t('options.appearance.themes.gruvbox', { default: 'Gruvbox' });
      case 'dracula': return $t('options.appearance.themes.dracula', { default: 'Dracula' });
      case 'ember': return $t('options.appearance.themes.ember', { default: 'Ember' });
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
      case 'showIdlePlayerQuips': return $t('options.appearance.interface.idleQuips.hint', { default: 'Shows a randomly chosen quip in the idle player bar when the playlist or library has music.' });
      default: return $t('options.appearance.interface.windowTitle.hint', { default: 'Shows the current track title in the main app window title. Turn it off to always show only "izci".' });
    }
  }

  onMount(() => {
    void hasLocalFontAccessPermission().then((granted) => {
      localFontPermissionChecked = true;
      if (granted) { localFontAccessGranted = true; void loadLocalFonts(); }
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
        <select value={$appLocale} on:change={handleLanguageChange}>
          {#each APP_LOCALE_OPTIONS as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </SettingsField>
    </div>
  </div>

  <div class="section">
    <h2>{$t('options.appearance.theme.heading', { default: 'Window Theme' })}</h2>
    <div class="field-grid">
      <SettingsField title={$t('options.appearance.theme.title', { default: 'Color theme' })} hint={$t('options.appearance.theme.hint', { default: 'Sets the global color theme.' })}>
          <select value={activeColorTheme} on:change={handleColorThemeChange}>
            {#each availableColorThemes as theme}
              <option value={theme.value}>{themeLabel(theme.value)}</option>
            {/each}
          </select>
      </SettingsField>

      <SettingsField title={$t('options.appearance.themeMode.title', { default: 'Appearance' })} hint={$t('options.appearance.themeMode.hint', { default: 'Follows the system color preference or keeps the selected appearance.' })}>
        <select value={$appearanceSettings.colorThemeMode} on:change={handleColorThemeModeChange}>
          <option value="system">{$t('options.appearance.themeMode.system', { default: 'Follow system' })}</option>
          <option value="light">{$t('options.appearance.themeMode.light', { default: 'Light' })}</option>
          <option value="dark">{$t('options.appearance.themeMode.dark', { default: 'Dark' })}</option>
        </select>
      </SettingsField>

      {#if activeColorTheme === 'chameleon'}
        <SettingsField
          title={$t('options.appearance.chameleonColor.title', { default: 'Chameleon color' })}
          hint={$t('options.appearance.chameleonColor.hint', { default: "Fine-tunes Chameleon's hue. This choice is remembered when you use another theme." })}
          fieldClass="chameleon-hue-field"
          controlClass="chameleon-slider-control"
        >
            <input
              class="chameleon-hue-slider"
              type="range"
              min={MIN_CHAMELEON_HUE}
              max={MAX_CHAMELEON_HUE}
              step="1"
              value={$appearanceSettings.chameleonHue}
              style={`--slider-hue: ${$appearanceSettings.chameleonHue}; --slider-saturation: ${$appearanceSettings.chameleonSaturation}%`}
              aria-label={$t('options.appearance.chameleonColor.hueLabel', { default: 'Chameleon color hue' })}
              on:input={handleChameleonHueInput}
            />
            <output class="chameleon-slider-output" style={`--swatch-hue: ${$appearanceSettings.chameleonHue}; --swatch-saturation: ${$appearanceSettings.chameleonSaturation}%`} aria-label={$t('options.appearance.degrees', { default: '{value} degrees', values: { value: $appearanceSettings.chameleonHue } })}>
              {$appearanceSettings.chameleonHue}°
            </output>
        </SettingsField>

        <SettingsField
          title={$t('options.appearance.chameleonSaturation.title', { default: 'Chameleon saturation' })}
          hint={$t('options.appearance.chameleonSaturation.hint', { default: "Controls color intensity without changing the theme's contrast or brightness." })}
          fieldClass="chameleon-saturation-field"
          controlClass="chameleon-slider-control"
        >
            <input
              class="chameleon-saturation-slider"
              type="range"
              min={MIN_CHAMELEON_SATURATION}
              max={MAX_CHAMELEON_SATURATION}
              step="1"
              value={$appearanceSettings.chameleonSaturation}
              style={`--slider-hue: ${$appearanceSettings.chameleonHue}; --slider-saturation: ${$appearanceSettings.chameleonSaturation}%`}
              aria-label={$t('options.appearance.chameleonSaturation.label', { default: 'Chameleon color saturation' })}
              on:input={handleChameleonSaturationInput}
            />
            <output class="chameleon-slider-output" aria-label={$t('options.appearance.percent', { default: '{value} percent', values: { value: $appearanceSettings.chameleonSaturation } })}>
              {$appearanceSettings.chameleonSaturation}%
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
          <FontFamilyPicker
            value={$appearanceSettings.fontFamily}
            options={fontFamilyOptions}
            label={$t('options.appearance.font.title', { default: 'Font' })}
            on:change={handleFontFamilyChange}
          />
          {#if localFontAccessSupported && localFontPermissionChecked && !localFontAccessGranted}
            <a href="#local-fonts" on:click={handleUseLocalFonts} aria-disabled={localFontsLoading}>
              {localFontsLoading ? $t('options.appearance.font.loading', { default: 'Loading local fonts…' }) : $t('options.appearance.font.useLocal', { default: 'Use local fonts…' })}
            </a>
          {/if}
        <svelte:fragment slot="hint">
          {#if localFontsError}
            {localFontsError === 'empty'
              ? $t('options.appearance.font.noFonts', { default: 'No local fonts were returned.' })
              : localFontsError === 'permission'
                ? $t('options.appearance.font.permissionDenied', { default: 'Local font permission was not granted.' })
                : $t('options.appearance.font.loadFailed', { default: 'Local fonts could not be loaded.' })}
          {:else if localFontAccessSupported}
            {$t('options.appearance.font.hint', { default: 'Applies the system interface font or a permitted local font across the app.' })}
          {:else}
            {$t('options.appearance.font.unsupported', { default: 'Local Font Access is not supported by this browser.' })}
          {/if}
        </svelte:fragment>
      </SettingsField>

      {#each INTERFACE_TOGGLES as toggle (toggle.key)}
        <SettingsField
          title={toggleTitle(toggle)}
          hint={toggleHint(toggle)}
          advanced={toggle.key === 'keepLibraryColumnsVisibleInNarrowLayout' || toggle.key === 'keepEmptyWorkspacePanelsOpen'}
          checkbox
        >
          <input
            type="checkbox"
            checked={$appearanceSettings[toggle.key]}
            on:change={(event) => handleAppearanceToggle(event, toggle.key)}
          />
        </SettingsField>
      {/each}
    </div>
  </div>

  <div class="section">
    <h2>{$t('options.appearance.contextualTabs.heading', { default: 'Contextual Tabs' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.appearance.contextualTabs.lyrics.title', { default: 'Lyrics' })}
        hint={$t('options.appearance.contextualTabs.lyrics.hint', { default: 'Controls whether the Lyrics tab follows embedded lyrics availability for the playing track.' })}
      >
        <select
          value={$appearanceSettings.contextualTabs.lyrics}
          on:change={(event) => handleContextualTabChange(event, 'lyrics')}
        >
          {#each CONTEXTUAL_TAB_AUTOMATION_OPTIONS as option}
            <option value={option.value}>{automationLabel(option.value)}</option>
          {/each}
        </select>
      </SettingsField>

      <SettingsField
        title={$t('options.appearance.contextualTabs.patterns.title', { default: 'Patterns' })}
        hint={$t('options.appearance.contextualTabs.patterns.hint', { default: 'Controls whether the Patterns tab follows module pattern availability for the playing track.' })}
      >
        <select
          value={$appearanceSettings.contextualTabs.patterns}
          on:change={(event) => handleContextualTabChange(event, 'patterns')}
        >
          {#each CONTEXTUAL_TAB_AUTOMATION_OPTIONS as option}
            <option value={option.value}>{automationLabel(option.value)}</option>
          {/each}
        </select>
      </SettingsField>
    </div>
  </div>
</article>
