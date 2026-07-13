<script lang="ts">
  import {
    MIN_NOW_PLAYING_PANEL_AUTO_HIDE_SECONDS, NOW_PLAYING_PANEL_AUTO_HIDE_NEVER_SECONDS,
    appearanceSettings, normalizeNowPlayingPanelAutoHideDelaySeconds
  } from '$lib/stores/appearance-settings';

  function checked(event: Event) { return (event.currentTarget as HTMLInputElement).checked; }
  function updateLyrics(key: 'autoTheaterInNowPlaying' | 'autoFocusInNowPlaying', event: Event) {
    appearanceSettings.update({ lyrics: { ...appearanceSettings.getSnapshot().lyrics, [key]: checked(event) } });
  }
  function handleAutoNowPlayingToggle(event: Event) { appearanceSettings.update({ autoNowPlayingOnMaximized: checked(event) }); }
  function handleNowPlayingArtworkPlayerColorsToggle(event: Event) { appearanceSettings.update({ useNowPlayingArtworkPlayerColors: checked(event) }); }
  function handleLyricsAutoTheaterToggle(event: Event) { updateLyrics('autoTheaterInNowPlaying', event); }
  function handleLyricsAutoFocusToggle(event: Event) { updateLyrics('autoFocusInNowPlaying', event); }
  function handleNowPlayingPanelAutoHideChange(event: Event) {
    appearanceSettings.update({ nowPlayingPanelAutoHideDelaySeconds: normalizeNowPlayingPanelAutoHideDelaySeconds((event.currentTarget as HTMLInputElement).valueAsNumber) });
  }
  $: nowPlayingPanelAutoHideLabel = $appearanceSettings.nowPlayingPanelAutoHideDelaySeconds >= NOW_PLAYING_PANEL_AUTO_HIDE_NEVER_SECONDS
    ? 'Never hide' : `${$appearanceSettings.nowPlayingPanelAutoHideDelaySeconds}s`;
</script>

<article class="view">
  <div class="section">
    <h2>Now Playing</h2>
    <div class="field-grid">
      <label class="field checkbox-field">
        <div class="field-copy">
          <span class="field-title">Open when maximized</span>
        </div>
        <div class="field-control checkbox-control">
          <input
            type="checkbox"
            checked={$appearanceSettings.autoNowPlayingOnMaximized}
            on:change={handleAutoNowPlayingToggle}
          />
        </div>
        <p class="field-hint">
          Switches the main window to Now Playing while it is maximized or fullscreen.
        </p>
      </label>

      <label class="field">
        <div class="field-copy">
          <span class="field-title">Hide side chrome after</span>
        </div>
        <div class="field-control">
          <input
            type="range"
            min={MIN_NOW_PLAYING_PANEL_AUTO_HIDE_SECONDS}
            max={NOW_PLAYING_PANEL_AUTO_HIDE_NEVER_SECONDS}
            step="1"
            value={$appearanceSettings.nowPlayingPanelAutoHideDelaySeconds}
            on:input={handleNowPlayingPanelAutoHideChange}
          />
          <span class="field-output">{nowPlayingPanelAutoHideLabel}</span>
        </div>
        <p class="field-hint">
          Fades the side tabs, pane fill, and close button after mouse inactivity.
        </p>
      </label>

      <label class="field checkbox-field">
        <div class="field-copy">
          <span class="field-title">Always use artwork colors</span>
        </div>
        <div class="field-control checkbox-control">
          <input
            type="checkbox"
            checked={$appearanceSettings.useNowPlayingArtworkPlayerColors}
            on:change={handleNowPlayingArtworkPlayerColorsToggle}
          />
        </div>
        <p class="field-hint">
          Forces the focused player controls to use artwork colors. When off, Now Playing follows the main player setting.
        </p>
      </label>

      <label class="field checkbox-field">
        <div class="field-copy">
          <span class="field-title">Auto switch to Theater</span>
        </div>
        <div class="field-control checkbox-control">
          <input
            type="checkbox"
            checked={$appearanceSettings.lyrics.autoTheaterInNowPlaying}
            on:change={handleLyricsAutoTheaterToggle}
          />
        </div>
        <p class="field-hint">
          Uses the large focused lyrics layout while Now Playing is active.
        </p>
      </label>

      <label class="field checkbox-field">
        <div class="field-copy">
          <span class="field-title">Auto focus Lyrics tab</span>
        </div>
        <div class="field-control checkbox-control">
          <input
            type="checkbox"
            checked={$appearanceSettings.lyrics.autoFocusInNowPlaying}
            on:change={handleLyricsAutoFocusToggle}
          />
        </div>
        <p class="field-hint">
          Opens Now Playing directly to the lyrics view.
        </p>
      </label>
    </div>
  </div>
</article>

