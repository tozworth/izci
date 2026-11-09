import { describe, expect, it } from 'vitest';
import { svelteSettingsToCore } from './settings-mapping';

describe('Svelte to core settings mapping', () => {
  it('maps queue/volume/replay/play-count snapshots to the core row', () => {
    const settings = svelteSettingsToCore({
      queuePlaybackOptions: { shuffle: true, repeatMode: 'all' },
      restartCurrentTrackOnPrevious: true,
      volume: 0.8,
      mute: false,
      replayGainMode: 'track',
      replayGainPreampDb: 0,
      playCountThresholdSeconds: 15
    });
    expect(settings).toEqual({
      shuffle: true,
      repeat: 'all',
      previous_restart_seconds: 3,
      volume: 0.8,
      mute: false,
      replay_gain: {
        mode: 'track',
        fallback: true,
        preamp_db: 0,
        missing_gain_db: 0,
        r128_target_lufs: -18,
        prevent_clipping: true
      },
      play_counts: { enabled: true, threshold_seconds: 15 }
    });
  });

  it('maps disabled Previous-restart to an effectively-never threshold', () => {
    const settings = svelteSettingsToCore({
      queuePlaybackOptions: { shuffle: false, repeatMode: 'off' },
      restartCurrentTrackOnPrevious: false,
      volume: 0.5,
      mute: true,
      replayGainMode: 'off',
      replayGainPreampDb: -3,
      playCountThresholdSeconds: 30
    });
    expect(settings.previous_restart_seconds).toBe(600);
    expect(settings.mute).toBe(true);
  });

  it('rejects out-of-range volume and thresholds through core validation', () => {
    expect(() =>
      svelteSettingsToCore({
        queuePlaybackOptions: { shuffle: false, repeatMode: 'off' },
        restartCurrentTrackOnPrevious: true,
        volume: 2,
        replayGainMode: 'off',
        replayGainPreampDb: 0,
        playCountThresholdSeconds: 15
      })
    ).toThrow();
    expect(() =>
      svelteSettingsToCore({
        queuePlaybackOptions: { shuffle: false, repeatMode: 'off' },
        restartCurrentTrackOnPrevious: true,
        volume: 0.5,
        replayGainMode: 'off',
        replayGainPreampDb: 0,
        playCountThresholdSeconds: 0
      })
    ).toThrow();
  });
});
