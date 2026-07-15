<script lang="ts">
  import SettingsField from '../SettingsField.svelte';
  import { PLAYBACK_RESTORE_MODE_OPTIONS, REPLAY_GAIN_MODE_OPTIONS, playbackSettings } from '$lib/stores/playback-settings';
  import type { PlaybackRestoreMode, ReplayGainMode } from '$lib/types';

  function checked(event: Event) { return (event.currentTarget as HTMLInputElement).checked; }
  function handlePlaybackRestoreModeChange(event: Event) { playbackSettings.update({ restoreMode: (event.currentTarget as HTMLSelectElement).value as PlaybackRestoreMode }); }
  function handleLogarithmicVolumeToggle(event: Event) { playbackSettings.update({ logarithmicVolume: checked(event) }); }
  function handleReplayGainModeChange(event: Event) { playbackSettings.update({ replayGainMode: (event.currentTarget as HTMLSelectElement).value as ReplayGainMode }); }
  function handleEnableRafToggle(event: Event) { playbackSettings.update({ enableRaf: checked(event) }); }
  function handleShowRafToggleInPlayerBar(event: Event) { playbackSettings.update({ showRafToggleInPlayerBar: checked(event) }); }
</script>

<article class="view">
  <div class="section">
    <h2>Startup</h2>
    <div class="field-grid">
      <SettingsField
        title="Restore playback"
        hint="Restores the current track and position after a reload. Position and state also resumes playback when Chromium allows it."
      >
          <select value={$playbackSettings.restoreMode} on:change={handlePlaybackRestoreModeChange}>
            {#each PLAYBACK_RESTORE_MODE_OPTIONS as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
      </SettingsField>
    </div>
  </div>

  <div class="section">
    <h2>Volume</h2>
    <div class="field-grid">
      <SettingsField title="Logarithmic volume" hint="Shapes the volume slider for gentler low-end changes." checkbox>
          <input
            type="checkbox"
            checked={$playbackSettings.logarithmicVolume}
            on:change={handleLogarithmicVolumeToggle}
          />
      </SettingsField>

      <SettingsField
        title="ReplayGain"
        hint="Applies streamed-file ReplayGain tags, preferring track or album gain when both are available."
      >
          <select value={$playbackSettings.replayGainMode} on:change={handleReplayGainModeChange}>
            {#each REPLAY_GAIN_MODE_OPTIONS as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
      </SettingsField>
    </div>
  </div>

  <div class="section">
    <h2>Effects</h2>
    <div class="field-grid">
      <SettingsField title="Enable Raf" hint="Enables the built-in audio effects rack and shows Raf under Playback." checkbox>
          <input
            type="checkbox"
            checked={$playbackSettings.enableRaf}
            on:change={handleEnableRafToggle}
          />
      </SettingsField>

      <SettingsField
        title="Show Raf toggle in player bar"
        hint="Shows the rack bypass control beside volume while Raf is enabled. Right-clicking it opens Raf options."
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
