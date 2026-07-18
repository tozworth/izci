<script lang="ts">
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
  $: lyricsFontSizeLimits = LYRICS_FONT_SIZE_LIMITS[$appearanceSettings.lyrics.displayStyle];
  $: lyricsFontSizeValue = $appearanceSettings.lyrics.fontSizes[$appearanceSettings.lyrics.displayStyle];
  $: lyricsFontSizePercent = Math.round(lyricsFontSizeValue * 100);
</script>

<article class="view">
  <div class="section">
    <h2>Lyrics</h2>
    <div class="field-grid">
      <SettingsField title="Display style" hint="Chooses how embedded synced lyrics render in the Lyrics panel.">
          <select value={$appearanceSettings.lyrics.displayStyle} on:change={handleLyricsStyleChange}>
            {#each LYRICS_STYLE_OPTIONS as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
      </SettingsField>

      <SettingsField title="Font size" hint="Saves a separate size for Plain text, Timestamped rows, and Theater.">
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
          title="Auto scroll to current line"
          hint="Keeps the highlighted lyric row in view while playback advances."
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
          title="Downtime dots"
          hint="Shows a three-dot break marker during long gaps between synced lines."
          checkbox
        >
            <input
              type="checkbox"
              checked={$appearanceSettings.lyrics.theaterDowntimeDots}
              on:change={handleLyricsTheaterDotsToggle}
            />
        </SettingsField>

        <SettingsField
          title="Downtime after"
          hint="Sets how long a synced lyric gap must last before Theater shows the break marker."
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
          title="Smooth Theater scroll"
          hint="Animates Theater line changes instead of snapping directly to the active line."
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
