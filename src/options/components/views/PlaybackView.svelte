<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '../SettingsField.svelte';
  import { PLAYBACK_RESTORE_MODE_OPTIONS, REPLAY_GAIN_MODE_OPTIONS, playbackSettings } from '$lib/stores/playback-settings';
  import type { PlaybackRestoreMode, ReplayGainMode } from '$lib/types';

  function checked(event: Event) { return (event.currentTarget as HTMLInputElement).checked; }
  function handlePlaybackRestoreModeChange(event: Event) { playbackSettings.update({ restoreMode: (event.currentTarget as HTMLSelectElement).value as PlaybackRestoreMode }); }
  function handleLogarithmicVolumeToggle(event: Event) { playbackSettings.update({ logarithmicVolume: checked(event) }); }
  function handleReplayGainModeChange(event: Event) { playbackSettings.update({ replayGainMode: (event.currentTarget as HTMLSelectElement).value as ReplayGainMode }); }
  function handleEnableRafToggle(event: Event) { playbackSettings.update({ enableRaf: checked(event) }); }
  function handleShowRafToggleInPlayerBar(event: Event) { playbackSettings.update({ showRafToggleInPlayerBar: checked(event) }); }
  function restoreModeLabel(value: PlaybackRestoreMode): string {
    if (value === 'disabled') return $t('options.playback.restore.options.disabled', { default: 'Disabled' });
    if (value === 'position') return $t('options.playback.restore.options.position', { default: 'Position only' });
    return $t('options.playback.restore.options.positionAndState', { default: 'Position and state' });
  }
  function replayGainModeLabel(value: ReplayGainMode): string {
    if (value === 'track') return $t('options.playback.replayGain.options.track', { default: 'Track' });
    if (value === 'album') return $t('options.playback.replayGain.options.album', { default: 'Album' });
    return $t('options.playback.replayGain.options.off', { default: 'Off' });
  }
</script>

<article class="view">
  <div class="section">
    <h2>{$t('options.playback.startup.heading', { default: 'Startup' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.playback.restore.title', { default: 'Restore playback' })}
        hint={$t('options.playback.restore.hint', { default: 'Restores the current track and position after a reload. Position and state also resumes playback when Chromium allows it.' })}
      >
          <select value={$playbackSettings.restoreMode} on:change={handlePlaybackRestoreModeChange}>
            {#each PLAYBACK_RESTORE_MODE_OPTIONS as option}
              <option value={option.value}>{restoreModeLabel(option.value)}</option>
            {/each}
          </select>
      </SettingsField>
    </div>
  </div>

  <div class="section">
    <h2>{$t('options.playback.volume.heading', { default: 'Volume' })}</h2>
    <div class="field-grid">
      <SettingsField title={$t('options.playback.logarithmicVolume.title', { default: 'Logarithmic volume' })} hint={$t('options.playback.logarithmicVolume.hint', { default: 'Shapes the volume slider for gentler low-end changes.' })} checkbox>
          <input
            type="checkbox"
            checked={$playbackSettings.logarithmicVolume}
            on:change={handleLogarithmicVolumeToggle}
          />
      </SettingsField>

      <SettingsField
        title={$t('options.playback.replayGain.title', { default: 'ReplayGain' })}
        hint={$t('options.playback.replayGain.hint', { default: 'Applies streamed-file ReplayGain tags, preferring track or album gain when both are available.' })}
      >
          <select value={$playbackSettings.replayGainMode} on:change={handleReplayGainModeChange}>
            {#each REPLAY_GAIN_MODE_OPTIONS as option}
              <option value={option.value}>{replayGainModeLabel(option.value)}</option>
            {/each}
          </select>
      </SettingsField>
    </div>
  </div>

  <div class="section">
    <h2>{$t('options.playback.effects.heading', { default: 'Effects' })}</h2>
    <div class="field-grid">
      <SettingsField title={$t('options.playback.enableRaf.title', { default: 'Enable Raf' })} hint={$t('options.playback.enableRaf.hint', { default: 'Enables the built-in audio effects rack and shows Raf under Playback.' })} checkbox>
          <input
            type="checkbox"
            checked={$playbackSettings.enableRaf}
            on:change={handleEnableRafToggle}
          />
      </SettingsField>

      <SettingsField
        title={$t('options.playback.showRafToggle.title', { default: 'Show Raf toggle in player bar' })}
        hint={$t('options.playback.showRafToggle.hint', { default: 'Shows the rack bypass control beside volume while Raf is enabled. Right-clicking it opens Raf options.' })}
        checkbox
      >
          <input
            type="checkbox"
            checked={$playbackSettings.showRafToggleInPlayerBar}
            on:change={handleShowRafToggleInPlayerBar}
          />
      </SettingsField>
    </div>
  </div>
</article>
