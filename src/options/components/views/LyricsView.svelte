<script lang="ts">
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
  function handleLyricsOpenPanelToggle(event: Event) { updateLyrics({ openPanelForLyrics: checked(event) }); }
  function handleLyricsClosePanelToggle(event: Event) { updateLyrics({ closePanelWithoutLyrics: checked(event) }); }
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

