import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODULE_PLAYBACK_SETTINGS, getHivelyRampingMs, getOpenMptRampingStrength,
  normalizeModulePlaybackSettings
} from './module-playback-settings';

describe('module ramping settings', () => {
  it('defaults to Normal and bounds malformed saved durations', () => {
    expect(normalizeModulePlaybackSettings({})).toEqual(DEFAULT_MODULE_PLAYBACK_SETTINGS);
    expect(normalizeModulePlaybackSettings({ ramping: 'invalid', hivelyRampingMs: NaN }))
      .toMatchObject({ ramping: 'normal', hivelyRampingMs: 5 });
    expect(normalizeModulePlaybackSettings({ ramping: 'off', hivelyRampingMs: -10 }))
      .toMatchObject({ ramping: 'off', hivelyRampingMs: 1 });
    expect(normalizeModulePlaybackSettings({ hivelyRampingMs: '99' }).hivelyRampingMs).toBe(20);
    expect(normalizeModulePlaybackSettings({ hivelyRampingMs: '3.14' }).hivelyRampingMs).toBe(3.1);
  });

  it.each([
    ['off', 0, 0], ['short', 2.5, 2], ['normal', 5, 5], ['long', 10, 10]
  ] as const)('maps %s to each decoder without treating libopenmpt strengths as ms', (ramping, ms, strength) => {
    expect(getHivelyRampingMs({ ...DEFAULT_MODULE_PLAYBACK_SETTINGS, ramping })).toBe(ms);
    expect(getOpenMptRampingStrength(ramping)).toBe(strength);
  });
});
