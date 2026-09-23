<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import ThemedSelect from '$lib/components/options/ThemedSelect.svelte';
  import ThemedImageSelect from '$lib/components/options/ThemedImageSelect.svelte';
  import {
    ODA_ARROW_REPEAT_INITIAL_DELAY_MAX_MS,
    ODA_ARROW_REPEAT_INITIAL_DELAY_MIN_MS,
    ODA_ARROW_REPEAT_INTERVAL_MAX_MS,
    ODA_ARROW_REPEAT_INTERVAL_MIN_MS,
    ODA_BACKGROUND_OPACITY_MAX_PERCENT,
    ODA_BACKGROUND_OPACITY_MIN_PERCENT,
    ODA_HOLD_BACK_THRESHOLD_MAX_MS,
    ODA_HOLD_BACK_THRESHOLD_MIN_MS,
    ODA_OVERSCAN_MAX_PERCENT,
    ODA_OVERSCAN_MIN_PERCENT,
    ODA_SCREENSAVER_DELAY_MAX_MINUTES,
    ODA_SCREENSAVER_DELAY_MIN_MINUTES,
    ODA_SCREENSAVER_MOVE_MAX_MINUTES,
    ODA_SCREENSAVER_MOVE_MIN_MINUTES,
    odaSettings
  } from '$lib/stores/oda-settings';
  import { readOdaBackgroundImage } from '$lib/services/oda-background';
  import type { OdaBackground, OdaBrowserLayout, OdaHoldBackAction, OdaLayout } from '$lib/types';
  import { tick } from 'svelte';

  function checked(event: Event) { return (event.currentTarget as HTMLInputElement).checked; }
  function handleLayoutChange(event: CustomEvent<string>) {
    odaSettings.update({ odaLayout: event.detail as OdaLayout });
  }
  function handleEnterFullscreenToggle(event: Event) {
    odaSettings.update({ odaEnterFullscreen: checked(event) });
  }
  function handleSongsLayoutChange(event: CustomEvent<string>) {
    const music = event.detail as OdaBrowserLayout;
    odaSettings.update({
      odaBrowserLayouts: { ...$odaSettings.odaBrowserLayouts, music }
    });
  }
  function handleWrapNavigationToggle(event: Event) {
    odaSettings.update({ odaWrapNavigation: checked(event) });
  }
  function handleOverscanChange(event: Event) {
    odaSettings.update({ odaOverscanPercent: (event.currentTarget as HTMLInputElement).valueAsNumber });
  }
  let backgroundPicker: { open: () => void } | null = null;
  function handleBackgroundChange(event: CustomEvent<string>) {
    const next = event.detail as OdaBackground;
    odaSettings.update({ odaBackground: next });
    if (next === 'custom') {
      // Let the picker mount before opening the dialog.
      void tick().then(() => backgroundPicker?.open());
    }
  }
  async function handleBackgroundFileChange(event: CustomEvent<File>) {
    const file = event.detail;
    const dataUrl = await readOdaBackgroundImage(file);
    if (dataUrl) odaSettings.update({ odaBackground: 'custom', odaBackgroundImage: dataUrl });
    else if (!odaSettings.getSnapshot().odaBackgroundImage) odaSettings.update({ odaBackground: 'none' });
  }
  function handleBackgroundOpacityChange(event: Event) {
    odaSettings.update({
      odaBackgroundOpacity: (event.currentTarget as HTMLInputElement).valueAsNumber
    });
  }
  function handleUseHostBackgroundToggle(event: Event) {
    odaSettings.update({ odaUseHostBackground: checked(event) });
  }
  function handleScreensaverDelayChange(event: Event) {
    odaSettings.update({
      odaScreensaverDelayMinutes: (event.currentTarget as HTMLInputElement).valueAsNumber
    });
  }
  function handleScreensaverMoveIntervalChange(event: Event) {
    odaSettings.update({
      odaScreensaverMoveIntervalMinutes: (event.currentTarget as HTMLInputElement).valueAsNumber
    });
  }
  function minutesLabel(value: number): string {
    return value === 0
      ? $t('options.oda.screensaver.off', { default: 'Off' })
      : $t('options.oda.screensaver.minutes', { default: '{minutes} min', values: { minutes: value } });
  }
  function backgroundActionLabel(value: OdaBackground): string {
    return value === 'custom'
      ? $t('options.oda.background.options.custom', { default: 'Custom' })
      : $t('options.oda.background.options.none', { default: 'None' });
  }
  function handleArrowRepeatInitialDelayChange(event: Event) {
    odaSettings.update({
      odaArrowRepeatInitialDelayMs: (event.currentTarget as HTMLInputElement).valueAsNumber
    });
  }
  function handleArrowRepeatIntervalChange(event: Event) {
    odaSettings.update({
      odaArrowRepeatIntervalMs: (event.currentTarget as HTMLInputElement).valueAsNumber
    });
  }
  function handleHoldBackActionChange(event: CustomEvent<string>) {
    odaSettings.update({
      odaHoldBackAction: event.detail as OdaHoldBackAction
    });
  }
  function handleHoldBackThresholdChange(event: Event) {
    odaSettings.update({
      odaHoldBackThresholdMs: (event.currentTarget as HTMLInputElement).valueAsNumber
    });
  }
  function holdBackActionLabel(value: OdaHoldBackAction): string {
    return value === 'return-home'
      ? $t('options.oda.holdBack.options.returnHome', { default: 'Return home' })
      : $t('options.oda.holdBack.options.none', { default: 'Nothing' });
  }
</script>

<article class="view">
  <div class="section">
    <h2>{$t('options.oda.heading', { default: 'Oda' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.oda.layout.title', { default: 'Layout' })}
        hint={$t('options.oda.layout.hint', { default: 'Selects the ten-foot home layout. Waterfall is the only layout today.' })}
      >
        <ThemedSelect
          value={$odaSettings.odaLayout}
          options={[
            { value: 'waterfall', label: $t('options.oda.layout.options.waterfall', { default: 'Waterfall' }) }
          ]}
          label={$t('options.oda.layout.title', { default: 'Layout' })}
          on:change={handleLayoutChange}
        />
      </SettingsField>

      <SettingsField
        title={$t('options.oda.songsLayout.title', { default: 'Song browser layout' })}
        hint={$t('options.oda.songsLayout.hint', { default: 'Shows songs as a compact list or as an artwork grid in Oda.' })}
      >
        <ThemedSelect
          value={$odaSettings.odaBrowserLayouts.music}
          options={[
            { value: 'list', label: $t('options.oda.songsLayout.options.list', { default: 'List' }) },
            { value: 'grid', label: $t('options.oda.songsLayout.options.grid', { default: 'Artwork grid' }) }
          ]}
          label={$t('options.oda.songsLayout.title', { default: 'Song browser layout' })}
          on:change={handleSongsLayoutChange}
        />
      </SettingsField>

      <SettingsField
        title={$t('options.oda.fullscreen.title', { default: 'Enter browser fullscreen' })}
        hint={$t('options.oda.fullscreen.hint', { default: 'Requests fullscreen when Oda is entered. Oda stays usable when the request is denied, unavailable, or exited with the browser shortcut; a deep-link entry asks again on the first keypress.' })}
        checkbox
      >
        <input
          type="checkbox"
          checked={$odaSettings.odaEnterFullscreen}
          on:change={handleEnterFullscreenToggle}
        />
      </SettingsField>

      <SettingsField
        title={$t('options.oda.wrapNavigation.title', { default: 'Wrap navigation' })}
        hint={$t('options.oda.wrapNavigation.hint', { default: 'Lets directional navigation wrap past the ends of a list or row.' })}
        checkbox
      >
        <input
          type="checkbox"
          checked={$odaSettings.odaWrapNavigation}
          on:change={handleWrapNavigationToggle}
        />
      </SettingsField>

      <SettingsField
        title={$t('options.oda.overscan.title', { default: 'Overscan inset' })}
        hint={$t('options.oda.overscan.hint', { default: 'Adds a safe-area inset around the Oda layout for televisions that crop the edges.' })}
      >
        <input
          type="range"
          min={ODA_OVERSCAN_MIN_PERCENT}
          max={ODA_OVERSCAN_MAX_PERCENT}
          step="0.5"
          value={$odaSettings.odaOverscanPercent}
          on:input={handleOverscanChange}
        />
        <span class="field-output">{$odaSettings.odaOverscanPercent}%</span>
      </SettingsField>

      <SettingsField
        title={$t('options.oda.background.title', { default: 'Background' })}
        hint={$t('options.oda.background.hint', { default: 'Shows a custom image behind the Oda layout.' })}
      >
        <ThemedSelect
          value={$odaSettings.odaBackground}
          options={[
            { value: 'none', label: backgroundActionLabel('none') },
            { value: 'custom', label: backgroundActionLabel('custom') }
          ]}
          label={$t('options.oda.background.title', { default: 'Background' })}
          on:change={handleBackgroundChange}
        />
      </SettingsField>

      {#if $odaSettings.odaBackground === 'custom'}
        <SettingsField
          title={$t('options.oda.backgroundImage.title', { default: 'Background image' })}
          hint={$t('options.oda.backgroundImage.hint', { default: 'The image shown behind the Oda layout.' })}
        >
          <ThemedImageSelect
            bind:this={backgroundPicker}
            src={$odaSettings.odaBackgroundImage}
            label={$t('options.oda.backgroundImage.title', { default: 'Background image' })}
            chooseLabel={$t('options.oda.background.chooseImage', { default: 'Choose image…' })}
            on:change={(event) => void handleBackgroundFileChange(event)}
          />
        </SettingsField>
        <SettingsField
          title={$t('options.oda.backgroundOpacity.title', { default: 'Background opacity' })}
          hint={$t('options.oda.backgroundOpacity.hint', { default: 'How opaque the custom background image is.' })}
        >
          <input
            type="range"
            min={ODA_BACKGROUND_OPACITY_MIN_PERCENT}
            max={ODA_BACKGROUND_OPACITY_MAX_PERCENT}
            step="1"
            value={$odaSettings.odaBackgroundOpacity}
            on:input={handleBackgroundOpacityChange}
          />
          <span class="field-output">{$odaSettings.odaBackgroundOpacity}%</span>
        </SettingsField>
      {/if}

      <SettingsField
        title={$t('options.oda.useHostBackground.title', { default: 'Use host background' })}
        hint={$t('options.oda.useHostBackground.hint', { default: "When connected as a multiplayer client, automatically fetches and uses the host's Oda background image." })}
        checkbox
      >
        <input
          type="checkbox"
          checked={$odaSettings.odaUseHostBackground}
          on:change={handleUseHostBackgroundToggle}
        />
      </SettingsField>

      <SettingsField
        title={$t('options.oda.screensaver.delay.title', { default: 'Screensaver' })}
        hint={$t('options.oda.screensaver.delay.hint', { default: 'Starts the Oda screensaver after this much idle time. It shuffles library images and falls back to theme colors.' })}
      >
        <input
          type="range"
          min={ODA_SCREENSAVER_DELAY_MIN_MINUTES}
          max={ODA_SCREENSAVER_DELAY_MAX_MINUTES}
          step="1"
          value={$odaSettings.odaScreensaverDelayMinutes}
          on:input={handleScreensaverDelayChange}
        />
        <span class="field-output">{minutesLabel($odaSettings.odaScreensaverDelayMinutes)}</span>
      </SettingsField>

      <SettingsField
        title={$t('options.oda.screensaver.move.title', { default: 'Move screensaver text' })}
        hint={$t('options.oda.screensaver.move.hint', { default: 'How often the clock and Now Playing text fade into new positions to reduce burn-in.' })}
        advanced
      >
        <input
          type="range"
          min={ODA_SCREENSAVER_MOVE_MIN_MINUTES}
          max={ODA_SCREENSAVER_MOVE_MAX_MINUTES}
          step="1"
          value={$odaSettings.odaScreensaverMoveIntervalMinutes}
          on:input={handleScreensaverMoveIntervalChange}
        />
        <span class="field-output">{minutesLabel($odaSettings.odaScreensaverMoveIntervalMinutes)}</span>
      </SettingsField>
    </div>
  </div>

  <div class="section">
    <h2>{$t('options.oda.input.heading', { default: 'Input' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.oda.arrowRepeatInitialDelay.title', { default: 'Arrow-repeat initial delay' })}
        hint={$t('options.oda.arrowRepeatInitialDelay.hint', { default: 'How long a directional key must be held before Oda starts repeating it.' })}
        advanced
      >
        <input
          type="range"
          min={ODA_ARROW_REPEAT_INITIAL_DELAY_MIN_MS}
          max={ODA_ARROW_REPEAT_INITIAL_DELAY_MAX_MS}
          step="50"
          value={$odaSettings.odaArrowRepeatInitialDelayMs}
          on:input={handleArrowRepeatInitialDelayChange}
        />
        <span class="field-output">{$odaSettings.odaArrowRepeatInitialDelayMs} ms</span>
      </SettingsField>

      <SettingsField
        title={$t('options.oda.arrowRepeatInterval.title', { default: 'Arrow-repeat interval' })}
        hint={$t('options.oda.arrowRepeatInterval.hint', { default: 'How often a held directional key repeats after the initial delay.' })}
        advanced
      >
        <input
          type="range"
          min={ODA_ARROW_REPEAT_INTERVAL_MIN_MS}
          max={ODA_ARROW_REPEAT_INTERVAL_MAX_MS}
          step="10"
          value={$odaSettings.odaArrowRepeatIntervalMs}
          on:input={handleArrowRepeatIntervalChange}
        />
        <span class="field-output">{$odaSettings.odaArrowRepeatIntervalMs} ms</span>
      </SettingsField>

      <SettingsField
        title={$t('options.oda.holdBack.title', { default: 'Hold Back action' })}
        hint={$t('options.oda.holdBack.hint', { default: 'What holding Back does. Exiting Oda stays an explicit Options command.' })}
        advanced
      >
        <ThemedSelect
          value={$odaSettings.odaHoldBackAction}
          options={[
            { value: 'none', label: holdBackActionLabel('none') },
            { value: 'return-home', label: holdBackActionLabel('return-home') }
          ]}
          label={$t('options.oda.holdBack.title', { default: 'Hold Back action' })}
          on:change={handleHoldBackActionChange}
        />
      </SettingsField>

      <SettingsField
        title={$t('options.oda.holdBackThreshold.title', { default: 'Hold Back threshold' })}
        hint={$t('options.oda.holdBackThreshold.hint', { default: 'How long Back must be held before the Hold Back action triggers.' })}
        advanced
      >
        <input
          type="range"
          min={ODA_HOLD_BACK_THRESHOLD_MIN_MS}
          max={ODA_HOLD_BACK_THRESHOLD_MAX_MS}
          step="50"
          value={$odaSettings.odaHoldBackThresholdMs}
          on:input={handleHoldBackThresholdChange}
        />
        <span class="field-output">{$odaSettings.odaHoldBackThresholdMs} ms</span>
      </SettingsField>
    </div>
  </div>
</article>
