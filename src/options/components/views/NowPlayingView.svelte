<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import {
    MAX_MULTIPLAYER_FLOATER_MOTION, MAX_MULTIPLAYER_FLOATER_SIZE,
    MIN_MULTIPLAYER_FLOATER_MOTION, MIN_MULTIPLAYER_FLOATER_SIZE,
    MAX_NOW_PLAYING_FLYOUT_TRANSPARENCY, MIN_NOW_PLAYING_FLYOUT_TRANSPARENCY,
    MIN_NOW_PLAYING_PANEL_AUTO_HIDE_SECONDS, NOW_PLAYING_PANEL_AUTO_HIDE_NEVER_SECONDS,
    appearanceSettings, normalizeMultiplayerFloaterMotion, normalizeMultiplayerFloaterSize,
    normalizeNowPlayingFlyoutTransparency, normalizeNowPlayingPanelAutoHideDelaySeconds
  } from '$lib/stores/appearance-settings';
  import { multiplayerSettings } from '$lib/stores/multiplayer-settings';

  function checked(event: Event) { return (event.currentTarget as HTMLInputElement).checked; }
  function updateLyrics(key: 'autoTheaterInNowPlaying' | 'autoFocusInNowPlaying', event: Event) {
    appearanceSettings.update({ lyrics: { ...appearanceSettings.getSnapshot().lyrics, [key]: checked(event) } });
  }
  function handleAutoNowPlayingToggle(event: Event) { appearanceSettings.update({ autoNowPlayingOnMaximized: checked(event) }); }
  function handleNowPlayingArtworkPlayerColorsToggle(event: Event) { appearanceSettings.update({ useNowPlayingArtworkPlayerColors: checked(event) }); }
  function handleMultiplayerFloatersToggle(event: Event) { appearanceSettings.update({ showMultiplayerFloaters: checked(event) }); }
  function handleMultiplayerFloaterSizeChange(event: Event) { appearanceSettings.update({ multiplayerFloaterSize: normalizeMultiplayerFloaterSize((event.currentTarget as HTMLInputElement).valueAsNumber) }); }
  function handleMultiplayerFloaterMotionChange(event: Event) { appearanceSettings.update({ multiplayerFloaterMotion: normalizeMultiplayerFloaterMotion((event.currentTarget as HTMLInputElement).valueAsNumber) }); }
  function handleLyricsAutoTheaterToggle(event: Event) { updateLyrics('autoTheaterInNowPlaying', event); }
  function handleLyricsAutoFocusToggle(event: Event) { updateLyrics('autoFocusInNowPlaying', event); }
  function handleNowPlayingPanelAutoHideChange(event: Event) {
    appearanceSettings.update({ nowPlayingPanelAutoHideDelaySeconds: normalizeNowPlayingPanelAutoHideDelaySeconds((event.currentTarget as HTMLInputElement).valueAsNumber) });
  }
  function handleFlyoutTransparencyChange(event: Event) {
    appearanceSettings.update({ nowPlayingFlyoutTransparency: normalizeNowPlayingFlyoutTransparency((event.currentTarget as HTMLInputElement).valueAsNumber) });
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
        title={$t('options.nowPlaying.multiplayerFloaters.title', { default: 'Multiplayer floaters' })}
        hint={$t('options.nowPlaying.multiplayerFloaters.hint', { default: 'Shows connected co-op and Freeplay clients around the edges of Now Playing.' })}
        checkbox
      >
          <input
            type="checkbox"
            checked={$appearanceSettings.showMultiplayerFloaters}
            disabled={!$multiplayerSettings.multiplayer}
            on:change={handleMultiplayerFloatersToggle}
          />
      </SettingsField>

      <SettingsField
        title={$t('options.nowPlaying.flyoutTransparency.title', { default: 'Flyout transparency' })}
        hint={$t('options.nowPlaying.flyoutTransparency.hint', { default: 'Lets the Now Playing backdrop show through flyout panel surfaces without fading their contents.' })}
        advanced
      >
          <input
            type="range"
            min={MIN_NOW_PLAYING_FLYOUT_TRANSPARENCY}
            max={MAX_NOW_PLAYING_FLYOUT_TRANSPARENCY}
            step="1"
            value={$appearanceSettings.nowPlayingFlyoutTransparency}
            on:input={handleFlyoutTransparencyChange}
          />
          <span class="field-output">{$appearanceSettings.nowPlayingFlyoutTransparency}%</span>
      </SettingsField>

      <SettingsField
        title={$t('options.nowPlaying.multiplayerFloaterSize.title', { default: 'Multiplayer floater size' })}
        hint={$t('options.nowPlaying.multiplayerFloaterSize.hint', { default: 'Scales the floating client cards without changing the rest of Now Playing.' })}
        advanced
      >
          <input type="range" min={MIN_MULTIPLAYER_FLOATER_SIZE} max={MAX_MULTIPLAYER_FLOATER_SIZE} step="1"
            value={$appearanceSettings.multiplayerFloaterSize}
            disabled={!$multiplayerSettings.multiplayer || !$appearanceSettings.showMultiplayerFloaters}
            on:input={handleMultiplayerFloaterSizeChange} />
          <span class="field-output">{$appearanceSettings.multiplayerFloaterSize}%</span>
      </SettingsField>

      <SettingsField
        title={$t('options.nowPlaying.multiplayerFloaterMotion.title', { default: 'Multiplayer buoyancy' })}
        hint={$t('options.nowPlaying.multiplayerFloaterMotion.hint', { default: 'Controls how far cards gently drift and tilt. Set it to zero for still water.' })}
        advanced
      >
          <input type="range" min={MIN_MULTIPLAYER_FLOATER_MOTION} max={MAX_MULTIPLAYER_FLOATER_MOTION} step="1"
            value={$appearanceSettings.multiplayerFloaterMotion}
            disabled={!$multiplayerSettings.multiplayer || !$appearanceSettings.showMultiplayerFloaters}
            on:input={handleMultiplayerFloaterMotionChange} />
          <span class="field-output">{$appearanceSettings.multiplayerFloaterMotion}%</span>
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
