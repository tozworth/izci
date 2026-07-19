<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '../SettingsField.svelte';
  import {
    LYRICS_FONT_SIZE_LIMITS, LYRICS_STYLE_OPTIONS,
    MAX_LYRICS_DOWNTIME_THRESHOLD_SECONDS, MIN_LYRICS_DOWNTIME_THRESHOLD_SECONDS,
    appearanceSettings, normalizeLyricsDowntimeThresholdSeconds, normalizeLyricsFontSize
  } from '$lib/stores/appearance-settings';
  import type { LyricsDisplayStyle } from '$lib/types';

  function checked(event: Event) { return (event.currentTarget as HTMLInputElement).checked; }
  function updateLyrics(patch: Partial<typeof $appearanceSettings.lyrics>) {
    appearanceSettings.update({ lyrics: { ...appearanceSettings.getSnapshot().lyrics, ...patch } });
  }
  function handleLyricsStyleChange(event: Event) { updateLyrics({ displayStyle: (event.currentTarget as HTMLSelectElement).value as LyricsDisplayStyle }); }
  function handleLyricsAutoScrollToggle(event: Event) { updateLyrics({ autoScroll: checked(event) }); }
  function handleLyricsTheaterDotsToggle(event: Event) { updateLyrics({ theaterDowntimeDots: checked(event) }); }
  function handleLyricsTheaterSmoothScrollToggle(event: Event) { updateLyrics({ theaterSmoothScroll: checked(event) }); }
  function handleLyricsFontSizeChange(event: Event) {
    const lyrics = appearanceSettings.getSnapshot().lyrics;
    updateLyrics({ fontSizes: { ...lyrics.fontSizes, [lyrics.displayStyle]: normalizeLyricsFontSize(lyrics.displayStyle, (event.currentTarget as HTMLInputElement).valueAsNumber) } });
  }
  function handleLyricsDowntimeThresholdChange(event: Event) {
    updateLyrics({ theaterDowntimeThresholdSeconds: normalizeLyricsDowntimeThresholdSeconds((event.currentTarget as HTMLInputElement).valueAsNumber) });
  }
  function lyricsStyleLabel(style: LyricsDisplayStyle): string {
    if (style === 'plain') return $t('options.lyrics.styles.plain', { default: 'Plain text' });
    if (style === 'timestamped') return $t('options.lyrics.styles.timestamped', { default: 'Timestamped rows' });
    return $t('options.lyrics.styles.theater', { default: 'Theater' });
  }
  $: lyricsFontSizeLimits = LYRICS_FONT_SIZE_LIMITS[$appearanceSettings.lyrics.displayStyle];
  $: lyricsFontSizeValue = $appearanceSettings.lyrics.fontSizes[$appearanceSettings.lyrics.displayStyle];
  $: lyricsFontSizePercent = Math.round(lyricsFontSizeValue * 100);
</script>

<article class="view">
  <div class="section">
    <h2>{$t('options.lyrics.heading', { default: 'Lyrics' })}</h2>
    <div class="field-grid">
      <SettingsField title={$t('options.lyrics.displayStyle.title', { default: 'Display style' })} hint={$t('options.lyrics.displayStyle.hint', { default: 'Chooses how embedded synced lyrics render in the Lyrics panel.' })}>
          <select value={$appearanceSettings.lyrics.displayStyle} on:change={handleLyricsStyleChange}>
            {#each LYRICS_STYLE_OPTIONS as option}
              <option value={option.value}>{lyricsStyleLabel(option.value)}</option>
            {/each}
          </select>
      </SettingsField>

      <SettingsField title={$t('options.lyrics.fontSize.title', { default: 'Font size' })} hint={$t('options.lyrics.fontSize.hint', { default: 'Saves a separate size for Plain text, Timestamped rows, and Theater.' })}>
          <input
            type="range"
            min={lyricsFontSizeLimits.min}
            max={lyricsFontSizeLimits.max}
            step={lyricsFontSizeLimits.step}
            value={lyricsFontSizeValue}
            on:input={handleLyricsFontSizeChange}
          />
          <span class="field-output">{lyricsFontSizePercent}%</span>
      </SettingsField>

      {#if $appearanceSettings.lyrics.displayStyle !== 'theater'}
        <SettingsField
          title={$t('options.lyrics.autoScroll.title', { default: 'Auto scroll to current line' })}
          hint={$t('options.lyrics.autoScroll.hint', { default: 'Keeps the highlighted lyric row in view while playback advances.' })}
          checkbox
        >
            <input
              type="checkbox"
              checked={$appearanceSettings.lyrics.autoScroll}
              on:change={handleLyricsAutoScrollToggle}
            />
        </SettingsField>
      {:else}
        <SettingsField
          title={$t('options.lyrics.downtimeDots.title', { default: 'Downtime dots' })}
          hint={$t('options.lyrics.downtimeDots.hint', { default: 'Shows a three-dot break marker during long gaps between synced lines.' })}
          checkbox
        >
            <input
              type="checkbox"
              checked={$appearanceSettings.lyrics.theaterDowntimeDots}
              on:change={handleLyricsTheaterDotsToggle}
            />
        </SettingsField>

        <SettingsField
          title={$t('options.lyrics.downtimeAfter.title', { default: 'Downtime after' })}
          hint={$t('options.lyrics.downtimeAfter.hint', { default: 'Sets how long a synced lyric gap must last before Theater shows the break marker.' })}
        >
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
        </SettingsField>

        <SettingsField
          title={$t('options.lyrics.smoothTheaterScroll.title', { default: 'Smooth Theater scroll' })}
          hint={$t('options.lyrics.smoothTheaterScroll.hint', { default: 'Animates Theater line changes instead of snapping directly to the active line.' })}
          checkbox
        >
            <input
              type="checkbox"
              checked={$appearanceSettings.lyrics.theaterSmoothScroll}
              on:change={handleLyricsTheaterSmoothScrollToggle}
            />
        </SettingsField>
      {/if}

    </div>
  </div>
</article>
