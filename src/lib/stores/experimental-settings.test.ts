import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPERIMENTAL_SETTINGS,
  MULTIPLAYER_AUDIO_BUFFER_MAX_MS,
  MULTIPLAYER_AUDIO_BUFFER_MIN_MS,
  MULTIPLAYER_MAX_LISTENERS_MAX,
  MULTIPLAYER_OPUS_BITRATE_MAX_KBPS,
  MULTIPLAYER_OPUS_BITRATE_MIN_KBPS,
  deriveMultiplayerMode,
  multiplayerModePatch,
  normalizeExperimentalSettings
} from './experimental-settings';

describe('experimental settings', () => {
  it('fills multiplayer audio defaults into older settings', () => {
    const normalized = normalizeExperimentalSettings({
      multiplayer: true,
      izciName: 'Living room'
    });

    expect(normalized).toMatchObject({
      multiplayerWaitForClients: false,
      multiplayerSynchronizedPlayback: false,
      multiplayerSyncLeadTimeMs: 1_000,
      multiplayerAutoHost: false,
      multiplayerRestoreLastSession: true,
      multiplayerTurnUrl: '',
      multiplayerTurnSecret: '',
      multiplayerTurnCredentialHours: 12,
      multiplayerForceTurn: false,
      multiplayerFreeplay: false,
      multiplayerStreamAudio: true,
      multiplayerOpusBitrateKbps: DEFAULT_EXPERIMENTAL_SETTINGS.multiplayerOpusBitrateKbps,
      multiplayerAudioBufferMs: DEFAULT_EXPERIMENTAL_SETTINGS.multiplayerAudioBufferMs,
      multiplayerRenderCacheLimitMiB: DEFAULT_EXPERIMENTAL_SETTINGS.multiplayerRenderCacheLimitMiB,
      multiplayerMaxListeners: DEFAULT_EXPERIMENTAL_SETTINGS.multiplayerMaxListeners
    });
  });

  it('persists the Freeplay opt-in independently from Multiplayer', () => {
    expect(normalizeExperimentalSettings({ multiplayerFreeplay: true })).toMatchObject({
      multiplayer: false,
      multiplayerFreeplay: true
    });
  });

  it('normalizes TURN settings while keeping them opt-in', () => {
    expect(normalizeExperimentalSettings({
      multiplayerTurnUrl: ' relay.example.test:3478 ',
      multiplayerTurnSecret: ' secret ',
      multiplayerTurnCredentialHours: 999,
      multiplayerForceTurn: true
    })).toMatchObject({
      multiplayerTurnUrl: 'turn:relay.example.test:3478',
      multiplayerTurnSecret: 'secret',
      multiplayerTurnCredentialHours: 48,
      multiplayerForceTurn: true
    });
    expect(normalizeExperimentalSettings({ multiplayerForceTurn: true }).multiplayerTurnUrl)
      .toBe('');
  });

  it('bounds bitrate and listener controls', () => {
    expect(normalizeExperimentalSettings({ multiplayerOpusBitrateKbps: 1 }).multiplayerOpusBitrateKbps)
      .toBe(MULTIPLAYER_OPUS_BITRATE_MIN_KBPS);
    expect(normalizeExperimentalSettings({ multiplayerOpusBitrateKbps: 999 }).multiplayerOpusBitrateKbps)
      .toBe(MULTIPLAYER_OPUS_BITRATE_MAX_KBPS);
    expect(normalizeExperimentalSettings({ multiplayerAudioBufferMs: 1 }).multiplayerAudioBufferMs)
      .toBe(MULTIPLAYER_AUDIO_BUFFER_MIN_MS);
    expect(normalizeExperimentalSettings({ multiplayerAudioBufferMs: 99_999 }).multiplayerAudioBufferMs)
      .toBe(MULTIPLAYER_AUDIO_BUFFER_MAX_MS);
    expect(normalizeExperimentalSettings({ multiplayerMaxListeners: 99 }).multiplayerMaxListeners)
      .toBe(MULTIPLAYER_MAX_LISTENERS_MAX);
  });

  it('accepts only the render-cache slider values', () => {
    expect(normalizeExperimentalSettings({ multiplayerRenderCacheLimitMiB: 128 }).multiplayerRenderCacheLimitMiB)
      .toBe(128);
    expect(normalizeExperimentalSettings({ multiplayerRenderCacheLimitMiB: 100 }).multiplayerRenderCacheLimitMiB)
      .toBe(DEFAULT_EXPERIMENTAL_SETTINGS.multiplayerRenderCacheLimitMiB);
  });

  it('normalizes synchronized playback and bounds its lead time', () => {
    expect(normalizeExperimentalSettings({
      multiplayerSynchronizedPlayback: true,
      multiplayerSyncLeadTimeMs: 99_999
    })).toMatchObject({
      multiplayerSynchronizedPlayback: true,
      multiplayerSyncLeadTimeMs: 3_000
    });
  });

  describe('multiplayer mode tiers', () => {
    it('derives singleplayer whenever multiplayer is off', () => {
      expect(deriveMultiplayerMode({
        multiplayer: false,
        multiplayerFreeplay: true,
        multiplayerStreamAudio: true
      })).toBe('singleplayer');
    });

    it('treats freeplay as the top tier, implying audio', () => {
      expect(deriveMultiplayerMode({
        multiplayer: true,
        multiplayerFreeplay: true,
        multiplayerStreamAudio: false
      })).toBe('freeplay');
    });

    it('derives co-op + audio when audio streaming is on', () => {
      expect(deriveMultiplayerMode({
        multiplayer: true,
        multiplayerFreeplay: false,
        multiplayerStreamAudio: true
      })).toBe('coopAudio');
    });

    it('derives plain co-op when audio is off', () => {
      expect(deriveMultiplayerMode({
        multiplayer: true,
        multiplayerFreeplay: false,
        multiplayerStreamAudio: false
      })).toBe('coop');
    });

    it('builds tier patches that imply the tiers below them', () => {
      expect(multiplayerModePatch('singleplayer')).toEqual({
        multiplayer: false,
        multiplayerFreeplay: false,
        multiplayerStreamAudio: false
      });
      expect(multiplayerModePatch('coop')).toEqual({
        multiplayer: true,
        multiplayerFreeplay: false,
        multiplayerStreamAudio: false
      });
      expect(multiplayerModePatch('coopAudio')).toEqual({
        multiplayer: true,
        multiplayerFreeplay: false,
        multiplayerStreamAudio: true
      });
      expect(multiplayerModePatch('freeplay')).toEqual({
        multiplayer: true,
        multiplayerFreeplay: true,
        multiplayerStreamAudio: true
      });
    });
  });
});
