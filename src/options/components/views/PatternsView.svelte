<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '../SettingsField.svelte';
  import { isPatternCellEmpty, splitPatternCell } from '$lib/services/pattern-presentation';
  import {
    MAX_PATTERN_CHANNEL_WIDTH,
    MAX_PATTERN_FONT_SIZE,
    MAX_PATTERN_ROW_HEIGHT,
    MIN_PATTERN_CHANNEL_WIDTH,
    MIN_PATTERN_FONT_SIZE,
    MIN_PATTERN_ROW_HEIGHT,
    patternViewerSettings
  } from '$lib/stores/pattern-viewer-settings';
  import type { PatternViewerSettings } from '$lib/types';

  type NumericSetting = 'fontSize' | 'rowHeight' | 'channelWidth';
  type ToggleSetting = 'followPlayback' | 'smoothScroll' | 'showChannelNames' | 'highlightBeatRows';

  const NUMERIC_SETTINGS: Array<{
    key: NumericSetting;
    title: string;
    hint: string;
    min: number;
    max: number;
    suffix: string;
  }> = [
    {
      key: 'fontSize',
      title: 'Pattern text size',
      hint: 'Scales tracker cells independently from the app interface font.',
      min: MIN_PATTERN_FONT_SIZE,
      max: MAX_PATTERN_FONT_SIZE,
      suffix: 'px'
    },
    {
      key: 'rowHeight',
      title: 'Row height',
      hint: 'Controls how densely pattern rows pass through the playhead.',
      min: MIN_PATTERN_ROW_HEIGHT,
      max: MAX_PATTERN_ROW_HEIGHT,
      suffix: 'px'
    },
    {
      key: 'channelWidth',
      title: 'Channel width',
      hint: 'Sets the horizontal room reserved for each formatted tracker channel.',
      min: MIN_PATTERN_CHANNEL_WIDTH,
      max: MAX_PATTERN_CHANNEL_WIDTH,
      suffix: 'px'
    }
  ];

  const TOGGLE_SETTINGS: Array<{ key: ToggleSetting; title: string; hint: string }> = [
    {
      key: 'followPlayback',
      title: 'Follow the playhead',
      hint: 'Keeps the active row centered while a module plays.'
    },
    {
      key: 'smoothScroll',
      title: 'Smooth playhead scrolling',
      hint: 'Animates row centering instead of stepping directly to the current row.'
    },
    {
      key: 'showChannelNames',
      title: 'Show channel names',
      hint: 'Adds module-provided names beside channel numbers when they are available.'
    },
    {
      key: 'highlightBeatRows',
      title: 'Highlight beat rows',
      hint: 'Adds a subtle guide every four rows behind the moving playhead.'
    }
  ];

  const PREVIEW_ROWS = [
    ['C-5 01v48 A06', 'G-4 03 .. ...', '... .. .. ...'],
    ['... .. .. ...', '... .. .. ...', 'C-3 08v32 ...'],
    ['E-5 01 .. ...', 'B-4 03 .. D03', '... .. .. ...'],
    ['G-5 01v42 ...', 'D-5 03 .. ...', 'C-3 08 .. ...']
  ];
  const PREVIEW_ROW_START = 8;

  $: previewStyle = [
    `--preview-font-size: ${$patternViewerSettings.fontSize}px`,
    `--preview-row-height: ${$patternViewerSettings.rowHeight}px`,
    `--preview-channel-width: ${$patternViewerSettings.channelWidth}px`
  ].join('; ');

  function updateNumericSetting(event: Event, key: NumericSetting) {
    patternViewerSettings.update({
      [key]: (event.currentTarget as HTMLInputElement).valueAsNumber
    } as Partial<PatternViewerSettings>);
  }

  function updateToggle(event: Event, key: ToggleSetting) {
    patternViewerSettings.update({
      [key]: (event.currentTarget as HTMLInputElement).checked
    } as Partial<PatternViewerSettings>);
  }

  function updateRowNumberBase(event: Event) {
    patternViewerSettings.update({
      rowNumberBase: (event.currentTarget as HTMLSelectElement).value as PatternViewerSettings['rowNumberBase']
    });
  }

  function updateColorScheme(event: Event) {
    patternViewerSettings.update({
      colorScheme: (event.currentTarget as HTMLSelectElement).value as PatternViewerSettings['colorScheme']
    });
  }

  function formatPreviewRow(index: number): string {
    return $patternViewerSettings.rowNumberBase === 'hex'
      ? index.toString(16).toUpperCase().padStart(2, '0')
      : String(index).padStart(2, '0');
  }

  function numericTitle(setting: typeof NUMERIC_SETTINGS[number]): string {
    if (setting.key === 'fontSize') return $t('options.patterns.textSize.title', { default: 'Pattern text size' });
    if (setting.key === 'rowHeight') return $t('options.patterns.rowHeight.title', { default: 'Row height' });
    return $t('options.patterns.channelWidth.title', { default: 'Channel width' });
  }
  function numericHint(setting: typeof NUMERIC_SETTINGS[number]): string {
    if (setting.key === 'fontSize') return $t('options.patterns.textSize.hint', { default: 'Scales tracker cells independently from the app interface font.' });
    if (setting.key === 'rowHeight') return $t('options.patterns.rowHeight.hint', { default: 'Controls how densely pattern rows pass through the playhead.' });
    return $t('options.patterns.channelWidth.hint', { default: 'Sets the horizontal room reserved for each formatted tracker channel.' });
  }
  function toggleTitle(setting: typeof TOGGLE_SETTINGS[number]): string {
    if (setting.key === 'followPlayback') return $t('options.patterns.follow.title', { default: 'Follow the playhead' });
    if (setting.key === 'smoothScroll') return $t('options.patterns.smoothScroll.title', { default: 'Smooth playhead scrolling' });
    if (setting.key === 'showChannelNames') return $t('options.patterns.channelNames.title', { default: 'Show channel names' });
    return $t('options.patterns.highlightBeats.title', { default: 'Highlight beat rows' });
  }
  function toggleHint(setting: typeof TOGGLE_SETTINGS[number]): string {
    if (setting.key === 'followPlayback') return $t('options.patterns.follow.hint', { default: 'Keeps the active row centered while a module plays.' });
    if (setting.key === 'smoothScroll') return $t('options.patterns.smoothScroll.hint', { default: 'Animates row centering instead of stepping directly to the current row.' });
    if (setting.key === 'showChannelNames') return $t('options.patterns.channelNames.hint', { default: 'Adds module-provided names beside channel numbers when they are available.' });
    return $t('options.patterns.highlightBeats.hint', { default: 'Adds a subtle guide every four rows behind the moving playhead.' });
  }
</script>

<article class="view">
  <div class="section">
    <h2>{$t('options.patterns.heading', { default: 'Pattern Viewer' })}</h2>
    <div class="pattern-preview colors-{$patternViewerSettings.colorScheme}" style={previewStyle} aria-label={$t('options.patterns.preview.label', { default: 'Pattern viewer preview' })}>
      <div class="preview-header">
        <span>{$t('options.patterns.preview.row', { default: 'ROW' })}</span>
        {#each [0, 1, 2] as channel}
          <span><b>{$t('options.patterns.preview.channelAbbreviation', { default: 'CH' })} {String(channel + 1).padStart(2, '0')}</b>{$patternViewerSettings.showChannelNames ? ` · ${[$t('options.patterns.preview.lead', { default: 'Lead' }), $t('options.patterns.preview.chord', { default: 'Chord' }), $t('options.patterns.preview.bass', { default: 'Bass' })][channel]}` : ''}</span>
        {/each}
      </div>
      {#each PREVIEW_ROWS as row, rowIndex}
        {@const displayedRow = rowIndex + PREVIEW_ROW_START}
        <div class:active={rowIndex === 2} class:beat={$patternViewerSettings.highlightBeatRows && displayedRow % 4 === 0} class="preview-row">
          <span>{formatPreviewRow(displayedRow)}</span>
          {#each row as cell}
            {@const parts = splitPatternCell(cell)}
            <span class="preview-cell" class:empty={isPatternCellEmpty(cell)}>
              <span class="preview-token pattern-note">{parts.note}</span>
              <span class="preview-token pattern-instrument">{parts.instrument}</span>
              <span class="preview-token pattern-volume">{parts.volume}</span>
              <span class="preview-token pattern-effect">{parts.effect}</span>
            </span>
          {/each}
        </div>
      {/each}
    </div>

    <div class="field-grid">
      {#each NUMERIC_SETTINGS as setting (setting.key)}
        <SettingsField title={numericTitle(setting)} hint={numericHint(setting)}>
          <input
            type="range"
            min={setting.min}
            max={setting.max}
            step="1"
            value={$patternViewerSettings[setting.key]}
            on:input={(event) => updateNumericSetting(event, setting.key)}
          />
          <span class="field-output">{$patternViewerSettings[setting.key]}{setting.suffix}</span>
        </SettingsField>
      {/each}

      <SettingsField title={$t('options.patterns.rowNumbers.title', { default: 'Row numbers' })} hint={$t('options.patterns.rowNumbers.hint', { default: 'Uses familiar hexadecimal tracker numbering or ordinary decimal values.' })}>
        <select value={$patternViewerSettings.rowNumberBase} on:change={updateRowNumberBase}>
          <option value="hex">{$t('options.patterns.rowNumbers.hex', { default: 'Hexadecimal (0A)' })}</option>
          <option value="decimal">{$t('options.patterns.rowNumbers.decimal', { default: 'Decimal (10)' })}</option>
        </select>
      </SettingsField>

      <SettingsField title={$t('options.patterns.colors.title', { default: 'Pattern colors' })} hint={$t('options.patterns.colors.hint', { default: 'Colors notes, instruments, volume commands, and effects for easier scanning.' })}>
        <select value={$patternViewerSettings.colorScheme} on:change={updateColorScheme}>
          <option value="conventional">{$t('options.patterns.colors.conventional', { default: 'Conventional tracker colors' })}</option>
          <option value="theme">{$t('options.patterns.colors.theme', { default: 'Theme colors' })}</option>
          <option value="monochrome">{$t('options.patterns.colors.monochrome', { default: 'Monochrome' })}</option>
        </select>
      </SettingsField>

      {#each TOGGLE_SETTINGS as setting (setting.key)}
        <SettingsField title={toggleTitle(setting)} hint={toggleHint(setting)} checkbox>
          <input
            type="checkbox"
            checked={$patternViewerSettings[setting.key]}
            disabled={setting.key === 'smoothScroll' && !$patternViewerSettings.followPlayback}
            on:change={(event) => updateToggle(event, setting.key)}
          />
        </SettingsField>
      {/each}
    </div>
  </div>
</article>

<style>
  .pattern-preview {
    max-width: 100%;
    margin: 0 0 1rem;
    overflow: hidden;
    border: 1px solid var(--border-soft);
    border-radius: 0.62rem;
    background: var(--bg-base);
    box-shadow: inset 0 1px rgba(255, 255, 255, 0.025);
  }

  .preview-header,
  .preview-row {
    display: grid;
    grid-template-columns: 2.8rem repeat(3, var(--preview-channel-width));
    width: max-content;
    min-width: 100%;
  }

  .preview-header {
    color: var(--muted);
    background: var(--bg-elevated);
    font: 650 0.62rem/1.8rem 'IBM Plex Mono', Consolas, monospace;
    letter-spacing: 0.04em;
  }

  .preview-header > span,
  .preview-row > span {
    box-sizing: border-box;
    overflow: hidden;
    padding: 0 0.3rem;
    border-right: 1px solid var(--border-faint);
    white-space: pre;
  }

  .preview-header b {
    color: var(--accent);
  }

  .preview-row {
    min-height: var(--preview-row-height);
    color: var(--text);
    font: 500 var(--preview-font-size)/var(--preview-row-height) 'IBM Plex Mono', Consolas, monospace;
  }

  .preview-row > span {
    border-bottom: 1px solid color-mix(in srgb, var(--border-faint) 50%, transparent);
  }

  .preview-row.beat:not(.active) > span {
    background: color-mix(in srgb, var(--accent) 4%, transparent);
  }

  .preview-row.active > span {
    color: var(--text-strong);
    background: color-mix(in srgb, var(--accent) 14%, var(--bg-base));
  }

  .preview-row > span:first-child {
    text-align: center;
    color: var(--muted);
  }

  .preview-cell {
    display: grid;
    grid-template-columns: 3ch 2ch 3ch minmax(3ch, 1fr);
    column-gap: 1ch;
  }

  .preview-token {
    overflow: hidden;
  }

  .preview-cell.empty {
    color: color-mix(in srgb, var(--muted) 38%, transparent);
  }

  .preview-cell.empty .preview-token {
    color: inherit;
  }

  .colors-conventional .pattern-note { color: #8eafff; }
  .colors-conventional .pattern-instrument { color: #69cbcb; }
  .colors-conventional .pattern-volume { color: #72d58a; }
  .colors-conventional .pattern-effect { color: #d2d7df; }

  .colors-theme .pattern-note { color: var(--accent); }
  .colors-theme .pattern-instrument { color: color-mix(in srgb, var(--accent) 70%, var(--text-strong)); }
  .colors-theme .pattern-volume { color: color-mix(in srgb, var(--accent) 46%, var(--text-strong)); }
  .colors-theme .pattern-effect { color: color-mix(in srgb, var(--accent) 20%, var(--text)); }

  .colors-monochrome .preview-token { color: var(--text); }
</style>
