<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import {
    ODA_ARROW_REPEAT_INITIAL_DELAY_MAX_MS,
    ODA_ARROW_REPEAT_INITIAL_DELAY_MIN_MS,
    ODA_ARROW_REPEAT_INTERVAL_MAX_MS,
    ODA_ARROW_REPEAT_INTERVAL_MIN_MS,
    ODA_HOLD_BACK_THRESHOLD_MAX_MS,
    ODA_HOLD_BACK_THRESHOLD_MIN_MS,
    ODA_OVERSCAN_MAX_PERCENT,
    ODA_OVERSCAN_MIN_PERCENT,
    odaSettings
  } from '$lib/stores/oda-settings';
  import type { OdaHoldBackAction, OdaLayout } from '$lib/types';

  function checked(event: Event) { return (event.currentTarget as HTMLInputElement).checked; }
  function handleLayoutChange(event: Event) {
    odaSettings.update({ odaLayout: (event.currentTarget as HTMLSelectElement).value as OdaLayout });
  }
  function handleEnterFullscreenToggle(event: Event) {
    odaSettings.update({ odaEnterFullscreen: checked(event) });
  }
  function handleWrapNavigationToggle(event: Event) {
    odaSettings.update({ odaWrapNavigation: checked(event) });
  }
  function handleOverscanChange(event: Event) {
    odaSettings.update({ odaOverscanPercent: (event.currentTarget as HTMLInputElement).valueAsNumber });
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
  function handleHoldBackActionChange(event: Event) {
    odaSettings.update({
      odaHoldBackAction: (event.currentTarget as HTMLSelectElement).value as OdaHoldBackAction
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
        <select value={$odaSettings.odaLayout} on:change={handleLayoutChange}>
          <option value="waterfall">{$t('options.oda.layout.options.waterfall', { default: 'Waterfall' })}</option>
        </select>
      </SettingsField>

      <SettingsField
        title={$t('options.oda.fullscreen.title', { default: 'Enter browser fullscreen' })}
        hint={$t('options.oda.fullscreen.hint', { default: 'Requests fullscreen when Oda is entered. Oda stays usable when the request is denied, unavailable, or exited with the browser shortcut.' })}
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
        <select value={$odaSettings.odaHoldBackAction} on:change={handleHoldBackActionChange}>
          <option value="none">{holdBackActionLabel('none')}</option>
          <option value="return-home">{holdBackActionLabel('return-home')}</option>
        </select>
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
