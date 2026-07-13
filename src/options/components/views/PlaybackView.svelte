<script lang="ts">
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
      <label class="field">
        <div class="field-copy">
          <span class="field-title">Restore playback</span>
        </div>
        <div class="field-control">
          <select
            value={$playbackSettings.restoreMode}
            on:change={handlePlaybackRestoreModeChange}
          >
            {#each PLAYBACK_RESTORE_MODE_OPTIONS as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>
        <p class="field-hint">
          Restores the current track and position after a reload. Position and state also resumes playback when Chromium allows it.
        </p>
      </label>
    </div>
  </div>

  <div class="section">
    <h2>Volume</h2>
    <div class="field-grid">
      <label class="field checkbox-field">
        <div class="field-copy">
          <span class="field-title">Logarithmic volume</span>
        </div>
        <div class="field-control checkbox-control">
          <input
            type="checkbox"
            checked={$playbackSettings.logarithmicVolume}
            on:change={handleLogarithmicVolumeToggle}
          />
        </div>
        <p class="field-hint">
          Shapes the volume slider for gentler low-end changes.
        </p>
      </label>

      <label class="field">
        <div class="field-copy">
          <span class="field-title">ReplayGain</span>
        </div>
        <div class="field-control">
          <select value={$playbackSettings.replayGainMode} on:change={handleReplayGainModeChange}>
            {#each REPLAY_GAIN_MODE_OPTIONS as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
        </div>
        <p class="field-hint">
          Applies streamed-file ReplayGain tags, preferring track or album gain when both are available.
        </p>
      </label>
    </div>
  </div>

  <div class="section">
    <h2>Effects</h2>
    <div class="field-grid">
      <label class="field checkbox-field">
        <div class="field-copy">
          <span class="field-title">Enable Raf</span>
        </div>
        <div class="field-control checkbox-control">
          <input
            type="checkbox"
            checked={$playbackSettings.enableRaf}
            on:change={handleEnableRafToggle}
          />
        </div>
        <p class="field-hint">
          Enables the built-in audio effects rack and shows Raf under Playback.
        </p>
      </label>

      <label class="field checkbox-field">
        <div class="field-copy">
          <span class="field-title">Show Raf toggle in player bar</span>
        </div>
        <div class="field-control checkbox-control">
          <input
            type="checkbox"
            checked={$playbackSettings.showRafToggleInPlayerBar}
            on:change={handleShowRafToggleInPlayerBar}
          />
        </div>
        <p class="field-hint">
          Shows the rack bypass control beside volume while Raf is enabled. Right-clicking it opens Raf options.
        </p>
      </label>
    </div>
  </div>
</article>

