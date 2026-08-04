import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPERIMENTAL_SETTINGS,
  MULTIPLAYER_MAX_LISTENERS_MAX,
  MULTIPLAYER_OPUS_BITRATE_MAX_KBPS,
  MULTIPLAYER_OPUS_BITRATE_MIN_KBPS,
  normalizeExperimentalSettings
} from './experimental-settings';

describe('experimental settings', () => {
  it('fills multiplayer audio defaults into older settings', () => {
    const normalized = normalizeExperimentalSettings({
      multiplayer: true,
      izciName: 'Living room'
    });

    expect(normalized).toMatchObject({
      multiplayerStreamAudio: true,
      multiplayerSendPostRaf: false,
      multiplayerOpusBitrateKbps: DEFAULT_EXPERIMENTAL_SETTINGS.multiplayerOpusBitrateKbps,
      multiplayerIncludeVideoAudio: true,
      multiplayerMaxListeners: DEFAULT_EXPERIMENTAL_SETTINGS.multiplayerMaxListeners
    });
  });

  it('bounds bitrate and listener controls', () => {
    expect(normalizeExperimentalSettings({ multiplayerOpusBitrateKbps: 1 }).multiplayerOpusBitrateKbps)
      .toBe(MULTIPLAYER_OPUS_BITRATE_MIN_KBPS);
    expect(normalizeExperimentalSettings({ multiplayerOpusBitrateKbps: 999 }).multiplayerOpusBitrateKbps)
      .toBe(MULTIPLAYER_OPUS_BITRATE_MAX_KBPS);
    expect(normalizeExperimentalSettings({ multiplayerMaxListeners: 99 }).multiplayerMaxListeners)
      .toBe(MULTIPLAYER_MAX_LISTENERS_MAX);
  });
});
