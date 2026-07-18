<script lang="ts">
  import { onMount } from 'svelte';
  import SettingsField from '../SettingsField.svelte';
  import { COLOR_THEME_OPTIONS } from '$lib/services/theme';
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
  import type { ColorTheme, ContextualTabAutomation, ContextualWorkspaceTab } from '$lib/types';

  type BooleanAppearanceSetting =
    | 'useArtworkPlayerColors'
    | 'compactPlayerBar'
    | 'keepLibraryColumnsVisibleInNarrowLayout'
    | 'keepEmptyWorkspacePanelsOpen'
    | 'showLibraryAlbumArtworkBackdrop'
    | 'showIdlePlayerQuips'
    | 'showTrackTitleInWindowTitle';
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
  let localFontsError = '';
  let localFontAccessGranted = false;
  const localFontAccessSupported = supportsLocalFontAccess();
  let localFontPermissionChecked = !localFontAccessSupported;

  function checked(event: Event) { return (event.currentTarget as HTMLInputElement).checked; }
  function handleColorThemeChange(event: Event) { appearanceSettings.update({ colorTheme: (event.currentTarget as HTMLSelectElement).value as ColorTheme }); }
  function handleChameleonHueInput(event: Event) { appearanceSettings.update({ chameleonHue: Number((event.currentTarget as HTMLInputElement).value) }); }
  function handleChameleonSaturationInput(event: Event) { appearanceSettings.update({ chameleonSaturation: Number((event.currentTarget as HTMLInputElement).value) }); }
  function handleAppearanceToggle(event: Event, key: BooleanAppearanceSetting) { appearanceSettings.update({ [key]: checked(event) }); }
  function handleFontFamilyChange(event: Event) { appearanceSettings.update({ fontFamily: (event.currentTarget as HTMLSelectElement).value }); }
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
      if (localFontFamilies.length === 0) localFontsError = 'No local fonts were returned.';
    } catch (error) {
      localFontsError = error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Local font permission was not granted.'
        : 'Local fonts could not be loaded.';
    } finally {
      localFontsLoading = false;
    }
  }

  function handleUseLocalFonts(event: MouseEvent) { event.preventDefault(); void loadLocalFonts(); }

  onMount(() => {
    void hasLocalFontAccessPermission().then((granted) => {
      localFontPermissionChecked = true;
      if (granted) { localFontAccessGranted = true; void loadLocalFonts(); }
    });
  });
</script>

<article class="view">
  <div class="section">
    <h2>Window Theme</h2>
    <div class="field-grid">
      <SettingsField title="Color theme" hint="Sets the global color theme.">
          <select value={$appearanceSettings.colorTheme} on:change={handleColorThemeChange}>
            {#each COLOR_THEME_OPTIONS as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
      </SettingsField>

      {#if $appearanceSettings.colorTheme === 'chameleon'}
        <SettingsField
          title="Chameleon color"
          hint="Fine-tunes Chameleon's hue. This choice is remembered when you use another theme."
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
              aria-label="Chameleon color hue"
              on:input={handleChameleonHueInput}
            />
            <output class="chameleon-slider-output" style={`--swatch-hue: ${$appearanceSettings.chameleonHue}; --swatch-saturation: ${$appearanceSettings.chameleonSaturation}%`} aria-label={`${$appearanceSettings.chameleonHue} degrees`}>
              {$appearanceSettings.chameleonHue}°
            </output>
        </SettingsField>

        <SettingsField
          title="Chameleon saturation"
          hint="Controls color intensity without changing the theme's contrast or brightness."
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
              aria-label="Chameleon color saturation"
              on:input={handleChameleonSaturationInput}
            />
            <output class="chameleon-slider-output" aria-label={`${$appearanceSettings.chameleonSaturation} percent`}>
              {$appearanceSettings.chameleonSaturation}%
            </output>
        </SettingsField>
      {/if}

      <SettingsField
        title="Use artwork colors for player"
        hint="Tints the player bar from the current artwork, with the selected theme as fallback."
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
    <h2>Interface</h2>
    <div class="field-grid">
      <SettingsField title="Font" fieldClass="font-field" controlClass="font-control">
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
        <svelte:fragment slot="hint">
          {#if localFontsError}
            {localFontsError}
          {:else if localFontAccessSupported}
            Applies the system interface font or a permitted local font across the app.
          {:else}
            Local Font Access is not supported by this browser.
          {/if}
        </svelte:fragment>
      </SettingsField>

      {#each INTERFACE_TOGGLES as toggle (toggle.key)}
        <SettingsField title={toggle.title} hint={toggle.hint} checkbox>
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
    <h2>Contextual Tabs</h2>
    <div class="field-grid">
      <SettingsField
        title="Lyrics"
        hint="Controls whether the Lyrics tab follows embedded lyrics availability for the playing track."
      >
        <select
          value={$appearanceSettings.contextualTabs.lyrics}
          on:change={(event) => handleContextualTabChange(event, 'lyrics')}
        >
          {#each CONTEXTUAL_TAB_AUTOMATION_OPTIONS as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </SettingsField>

      <SettingsField
        title="Patterns"
        hint="Controls whether the Patterns tab follows module pattern availability for the playing track."
      >
        <select
          value={$appearanceSettings.contextualTabs.patterns}
          on:change={(event) => handleContextualTabChange(event, 'patterns')}
        >
          {#each CONTEXTUAL_TAB_AUTOMATION_OPTIONS as option}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </SettingsField>
    </div>
  </div>
</article>
