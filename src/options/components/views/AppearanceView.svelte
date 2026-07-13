<script lang="ts">
  import { onMount } from 'svelte';
  import { COLOR_THEME_OPTIONS } from '$lib/services/theme';
  import { hasLocalFontAccessPermission, queryLocalFontFamilies, supportsLocalFontAccess } from '$lib/services/local-fonts';
  import { SYSTEM_FONT_FAMILY, appearanceSettings } from '$lib/stores/appearance-settings';
  import type { ColorTheme } from '$lib/types';

  let localFontFamilies: string[] = [];
  let localFontsLoading = false;
  let localFontsError = '';
  let localFontAccessGranted = false;
  const localFontAccessSupported = supportsLocalFontAccess();
  let localFontPermissionChecked = !localFontAccessSupported;

  function checked(event: Event) { return (event.currentTarget as HTMLInputElement).checked; }
  function handleColorThemeChange(event: Event) { appearanceSettings.update({ colorTheme: (event.currentTarget as HTMLSelectElement).value as ColorTheme }); }
  function handleArtworkPlayerColorsToggle(event: Event) { appearanceSettings.update({ useArtworkPlayerColors: checked(event) }); }
  function handleCompactPlayerBarToggle(event: Event) { appearanceSettings.update({ compactPlayerBar: checked(event) }); }
  function handleCompactColumnLayoutToggle(event: Event) { appearanceSettings.update({ keepLibraryColumnsVisibleInNarrowLayout: checked(event) }); }
  function handleEmptyWorkspacePanelsToggle(event: Event) { appearanceSettings.update({ keepEmptyWorkspacePanelsOpen: checked(event) }); }
  function handleIdlePlayerQuipsToggle(event: Event) { appearanceSettings.update({ showIdlePlayerQuips: checked(event) }); }
  function handleWindowTitleToggle(event: Event) { appearanceSettings.update({ showTrackTitleInWindowTitle: checked(event) }); }
  function handleFontFamilyChange(event: Event) { appearanceSettings.update({ fontFamily: (event.currentTarget as HTMLSelectElement).value }); }

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
      <label class="field font-field">
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

