<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
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
    ? $t('options.nowPlaying.neverHide', { default: 'Never hide' }) : `${$appearanceSettings.nowPlayingPanelAutoHideDelaySeconds}s`;
</script>

<article class="view">
  <div class="section">
    <h2>{$t('options.nowPlaying.heading', { default: 'Now Playing' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.nowPlaying.openWhenMaximized.title', { default: 'Open when maximized' })}
        hint={$t('options.nowPlaying.openWhenMaximized.hint', { default: 'Switches the main window to Now Playing while it is maximized or fullscreen.' })}
        checkbox
      >
          <input
            type="checkbox"
            checked={$appearanceSettings.autoNowPlayingOnMaximized}
            on:change={handleAutoNowPlayingToggle}
          />
      </SettingsField>

      <SettingsField
        title={$t('options.nowPlaying.hideSideChrome.title', { default: 'Hide controls after inactivity' })}
        hint={$t('options.nowPlaying.hideSideChrome.hint', { default: 'Fades transport, side handles, and unpinned panels. Pinned panels stay visible.' })}
      >
          <input
            type="range"
            min={MIN_NOW_PLAYING_PANEL_AUTO_HIDE_SECONDS}
            max={NOW_PLAYING_PANEL_AUTO_HIDE_NEVER_SECONDS}
            step="1"
            value={$appearanceSettings.nowPlayingPanelAutoHideDelaySeconds}
            on:input={handleNowPlayingPanelAutoHideChange}
          />
          <span class="field-output">{nowPlayingPanelAutoHideLabel}</span>
      </SettingsField>

      <SettingsField
        title={$t('options.nowPlaying.artworkColors.title', { default: 'Always use artwork colors' })}
        hint={$t('options.nowPlaying.artworkColors.hint', { default: 'Forces the focused player controls to use artwork colors. When off, Now Playing follows the main player setting.' })}
        checkbox
      >
          <input
            type="checkbox"
            checked={$appearanceSettings.useNowPlayingArtworkPlayerColors}
            on:change={handleNowPlayingArtworkPlayerColorsToggle}
          />
      </SettingsField>

      <SettingsField
        title={$t('options.nowPlaying.autoTheater.title', { default: 'Auto switch to Theater' })}
        hint={$t('options.nowPlaying.autoTheater.hint', { default: 'Uses the large focused lyrics layout while Now Playing is active.' })}
        checkbox
      >
          <input
            type="checkbox"
            checked={$appearanceSettings.lyrics.autoTheaterInNowPlaying}
            on:change={handleLyricsAutoTheaterToggle}
          />
      </SettingsField>

      <SettingsField
        title={$t('options.nowPlaying.autoFocusLyrics.title', { default: 'Auto focus Lyrics tab' })}
        hint={$t('options.nowPlaying.autoFocusLyrics.hint', { default: 'Opens Now Playing directly to the lyrics view.' })}
        checkbox
      >
          <input
            type="checkbox"
            checked={$appearanceSettings.lyrics.autoFocusInNowPlaying}
            on:change={handleLyricsAutoFocusToggle}
          />
      </SettingsField>
    </div>
  </div>
</article>
