<script lang="ts">
  import { t } from 'svelte-i18n';
  import SettingsField from '$lib/components/options/SettingsField.svelte';
  import {
    PLAYBACK_RATE_MAX,
    PLAYBACK_RATE_MIN,
    PLAYBACK_RATE_STEP,
    PLAYBACK_RESTORE_MODE_OPTIONS,
    PLAYBACK_TRANSITION_MODE_OPTIONS,
    REMEMBER_PROGRESS_DURATION_MINUTES,
    REPLAY_GAIN_MODE_OPTIONS,
    FADE_DURATION_MAX_SECONDS,
    FADE_DURATION_MIN_SECONDS,
    FADE_DURATION_STEP_SECONDS,
    MANUAL_TRACK_CHANGE_FADE_PERCENT_MAX,
    MANUAL_TRACK_CHANGE_FADE_PERCENT_MIN,
    MANUAL_TRACK_CHANGE_FADE_PERCENT_STEP,
    MAX_SEEK_WHEEL_STEP_SECONDS,
    MIN_SEEK_WHEEL_STEP_SECONDS,
    normalizeFadeDurationSeconds,
    normalizeManualTrackChangeFadePercent,
    normalizePlaybackRate,
    normalizeRememberProgressDurationIndex,
    normalizeSeekWheelStepSeconds,
    playbackSettings
  } from '$lib/stores/playback-settings';
  import type { PlaybackRestoreMode, PlaybackTransitionMode, ReplayGainMode } from '$lib/types';

  function checked(event: Event) { return (event.currentTarget as HTMLInputElement).checked; }
  function handlePlaybackRestoreModeChange(event: Event) { playbackSettings.update({ restoreMode: (event.currentTarget as HTMLSelectElement).value as PlaybackRestoreMode }); }
  function handleRememberProgressDurationChange(event: Event) {
    playbackSettings.update({
      rememberProgressDurationIndex: normalizeRememberProgressDurationIndex(
        (event.currentTarget as HTMLInputElement).valueAsNumber
      )
    });
  }
  function handlePlaybackRateChange(event: Event) {
    playbackSettings.update({
      playbackRate: normalizePlaybackRate(
        (event.currentTarget as HTMLInputElement).valueAsNumber
      )
    });
  }
  function handleTrueSpeedToggle(event: Event) { playbackSettings.update({ trueSpeed: checked(event) }); }
  function handleRestartCurrentTrackOnPreviousToggle(event: Event) { playbackSettings.update({ restartCurrentTrackOnPrevious: checked(event) }); }
  function handleTransitionModeChange(event: Event) { playbackSettings.update({ transitionMode: (event.currentTarget as HTMLSelectElement).value as PlaybackTransitionMode }); }
  function handleGaplessPlaybackToggle(event: Event) {
    const gaplessPlayback = checked(event);
    playbackSettings.update({
      gaplessPlayback,
      ...(!gaplessPlayback && $playbackSettings.transitionMode === 'crossfade'
        ? { transitionMode: 'fadeout' as const }
        : {})
    });
  }
  function handleFadeDurationChange(event: Event) { playbackSettings.update({ fadeDurationSeconds: normalizeFadeDurationSeconds((event.currentTarget as HTMLInputElement).valueAsNumber) }); }
  function handleManualTrackChangeFadePercentChange(event: Event) { playbackSettings.update({ manualTrackChangeFadePercent: normalizeManualTrackChangeFadePercent((event.currentTarget as HTMLInputElement).valueAsNumber) }); }
  function handleLogarithmicVolumeToggle(event: Event) { playbackSettings.update({ logarithmicVolume: checked(event) }); }
  function handleShowTimeRemainingToggle(event: Event) { playbackSettings.update({ showTimeRemaining: checked(event) }); }
  function handleSeekWheelStepChange(event: Event) { playbackSettings.update({ seekWheelStepSeconds: normalizeSeekWheelStepSeconds((event.currentTarget as HTMLInputElement).valueAsNumber) }); }
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
  function transitionModeLabel(value: PlaybackTransitionMode): string {
    if (value === 'none') return $t('options.playback.transitions.options.none', { default: 'None' });
    if (value === 'fadeout') return $t('options.playback.transitions.options.fadeout', { default: 'Fade out' });
    return $t('options.playback.transitions.options.crossfade', { default: 'Crossfade' });
  }
  function rememberProgressDurationLabel(index: number): string {
    const minutes = REMEMBER_PROGRESS_DURATION_MINUTES[index] ?? null;
    if (minutes === null) return $t('options.playback.rememberProgress.off', { default: 'Off' });
    if (minutes === 0) return $t('options.playback.rememberProgress.everyFile', { default: 'Every file' });
    if (minutes < 60) {
      return $t('options.playback.rememberProgress.minutes', {
        default: '{minutes} min',
        values: { minutes }
      });
    }
    return $t('options.playback.rememberProgress.hours', {
      default: '{hours} h',
      values: { hours: minutes / 60 }
    });
  }
  function playbackRateLabel(value: number): string {
    return `${value.toFixed(2).replace(/\.?0+$/, '')}×`;
  }
  function manualTrackChangeFadeLabel(value: number): string {
    if (value === MANUAL_TRACK_CHANGE_FADE_PERCENT_MIN) {
      return $t('options.playback.transitions.manual.off', { default: 'Off' });
    }
    if (value === MANUAL_TRACK_CHANGE_FADE_PERCENT_MAX) {
      return $t('options.playback.transitions.manual.fullDuration', { default: 'Full duration' });
    }
    return `${value}%`;
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
    <h2>{$t('options.playback.navigation.heading', { default: 'Navigation' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.playback.restartCurrentTrackOnPrevious.title', { default: 'Previous restarts current track' })}
        hint={$t('options.playback.restartCurrentTrackOnPrevious.hint', { default: 'Restarts the current track when Previous is pressed after 3 seconds; press it again to go to the previous track.' })}
        checkbox
      >
          <input
            type="checkbox"
            checked={$playbackSettings.restartCurrentTrackOnPrevious}
            on:change={handleRestartCurrentTrackOnPreviousToggle}
          />
      </SettingsField>
    </div>
  </div>

  <div class="section">
    <h2>{$t('options.playback.transitions.heading', { default: 'Transitions' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.playback.transitions.mode.title', { default: 'Track transition' })}
        hint={$t('options.playback.transitions.mode.hint', { default: 'Cuts directly, fades the outgoing track to silence, or overlaps adjacent tracks.' })}
      >
          <select value={$playbackSettings.transitionMode} on:change={handleTransitionModeChange}>
            {#each PLAYBACK_TRANSITION_MODE_OPTIONS as option}
              <option value={option.value} disabled={option.value === 'crossfade' && !$playbackSettings.gaplessPlayback}>
                {transitionModeLabel(option.value)}
              </option>
            {/each}
          </select>
      </SettingsField>

      <SettingsField
        title={$t('options.playback.transitions.gapless.title', { default: 'Gapless playback' })}
        hint={$t('options.playback.transitions.gapless.hint', { default: 'Prepares the next file before the current one ends. Turning this off also disables crossfade.' })}
        advanced
        checkbox
      >
          <input
            type="checkbox"
            checked={$playbackSettings.gaplessPlayback}
            on:change={handleGaplessPlaybackToggle}
          />
      </SettingsField>

      <SettingsField
        title={$t('options.playback.transitions.duration.title', { default: 'Fade length' })}
        hint={$t('options.playback.transitions.duration.hint', { default: 'Sets the fade-out or overlap duration.' })}
        advanced
      >
          <input
            type="range"
            min={FADE_DURATION_MIN_SECONDS}
            max={FADE_DURATION_MAX_SECONDS}
            step={FADE_DURATION_STEP_SECONDS}
            value={$playbackSettings.fadeDurationSeconds}
            disabled={$playbackSettings.transitionMode === 'none'}
            on:input={handleFadeDurationChange}
          />
          <span class="field-output">{$playbackSettings.fadeDurationSeconds} s</span>
      </SettingsField>

      <SettingsField
        title={$t('options.playback.transitions.manual.title', { default: 'Fade manual track changes' })}
        hint={$t('options.playback.transitions.manual.hint', { default: 'Sets how much of the standard fade or crossfade duration applies when you choose Previous, Next, or another track.' })}
        advanced
      >
          <input
            type="range"
            min={MANUAL_TRACK_CHANGE_FADE_PERCENT_MIN}
            max={MANUAL_TRACK_CHANGE_FADE_PERCENT_MAX}
            step={MANUAL_TRACK_CHANGE_FADE_PERCENT_STEP}
            value={$playbackSettings.manualTrackChangeFadePercent}
            disabled={$playbackSettings.transitionMode === 'none'}
            on:input={handleManualTrackChangeFadePercentChange}
          />
          <span class="field-output">{manualTrackChangeFadeLabel($playbackSettings.manualTrackChangeFadePercent)}</span>
      </SettingsField>
    </div>
  </div>

  <div class="section">
    <h2>{$t('options.playback.speed.heading', { default: 'Speed' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.playback.playbackRate.title', { default: 'Playback speed' })}
        hint={$t('options.playback.playbackRate.hint', { default: 'Changes the playback speed of streamed audio and video. Tracker modules use their own tempo and pitch controls.' })}
      >
          <input
            type="range"
            min={PLAYBACK_RATE_MIN}
            max={PLAYBACK_RATE_MAX}
            step={PLAYBACK_RATE_STEP}
            value={$playbackSettings.playbackRate}
            on:input={handlePlaybackRateChange}
          />
          <span class="field-output">{playbackRateLabel($playbackSettings.playbackRate)}</span>
      </SettingsField>

      <SettingsField
        title={$t('options.playback.trueSpeed.title', { default: 'True speed' })}
        hint={$t('options.playback.trueSpeed.hint', { default: 'Disables timestretching so pitch rises or falls along with playback speed.' })}
        checkbox
      >
          <input
            type="checkbox"
            checked={$playbackSettings.trueSpeed}
            on:change={handleTrueSpeedToggle}
          />
      </SettingsField>
    </div>
  </div>

  <div class="section">
    <h2>{$t('options.playback.progress.heading', { default: 'Progress' })}</h2>
    <div class="field-grid">
      <SettingsField
        title={$t('options.playback.rememberProgress.title', { default: 'Remember progress' })}
        hint={$t('options.playback.rememberProgress.hint', { default: 'Automatically resumes unfinished files at least this long when you return to them.' })}
        advanced
      >
          <input
            type="range"
            min="0"
            max={REMEMBER_PROGRESS_DURATION_MINUTES.length - 1}
            step="1"
            value={$playbackSettings.rememberProgressDurationIndex}
            on:input={handleRememberProgressDurationChange}
          />
          <span class="field-output">
            {rememberProgressDurationLabel($playbackSettings.rememberProgressDurationIndex)}
          </span>
      </SettingsField>

      <SettingsField
        title={$t('options.playback.showTimeRemaining.title', { default: 'Show time remaining' })}
        hint={$t('options.playback.showTimeRemaining.hint', { default: "Shows how much of the current track is left instead of its total length." })}
        checkbox
      >
          <input
            type="checkbox"
            checked={$playbackSettings.showTimeRemaining}
            on:change={handleShowTimeRemainingToggle}
          />
      </SettingsField>

      <SettingsField
        title={$t('options.playback.seekWheelStep.title', { default: 'Wheel seek step' })}
        hint={$t('options.playback.seekWheelStep.hint', { default: 'How many seconds each wheel notch scrubs over the seek bar.' })}
        advanced
      >
          <input
            type="range"
            min={MIN_SEEK_WHEEL_STEP_SECONDS}
            max={MAX_SEEK_WHEEL_STEP_SECONDS}
            step="1"
            value={$playbackSettings.seekWheelStepSeconds}
            on:input={handleSeekWheelStepChange}
          />
          <span class="field-output">{$playbackSettings.seekWheelStepSeconds} s</span>
      </SettingsField>
    </div>
  </div>

  <div class="section">
    <h2>{$t('options.playback.volume.heading', { default: 'Volume' })}</h2>
    <div class="field-grid">
      <SettingsField title={$t('options.playback.logarithmicVolume.title', { default: 'Logarithmic volume' })} hint={$t('options.playback.logarithmicVolume.hint', { default: 'Shapes the volume slider for gentler low-end changes.' })} advanced checkbox>
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
