import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MULTIPLAYER_SETTINGS,
  MULTIPLAYER_AUDIO_BUFFER_MAX_MS,
  MULTIPLAYER_AUDIO_BUFFER_MIN_MS,
  MULTIPLAYER_MAX_LISTENERS_MAX,
  MULTIPLAYER_OPUS_BITRATE_MAX_KBPS,
  MULTIPLAYER_OPUS_BITRATE_MIN_KBPS,
  deriveMultiplayerMode,
  multiplayerModePatch,
  normalizeMultiplayerSettings
} from './multiplayer-settings';

describe('multiplayer settings', () => {
  it('fills multiplayer audio defaults into older settings', () => {
    const normalized = normalizeMultiplayerSettings({
      multiplayer: true,
      izciName: 'Living room'
    });

    expect(normalized).toMatchObject({
      multiplayerMotd: '',
      multiplayerWaitForClients: false,
      multiplayerSynchronizedPlayback: false,
      multiplayerSyncLeadTimeMs: 1_000,
      multiplayerRestoreLastSession: true,
      multiplayerFreeplay: false,
      multiplayerStreamAudio: true,
      multiplayerFileTransferLimitMiB: DEFAULT_MULTIPLAYER_SETTINGS.multiplayerFileTransferLimitMiB,
      multiplayerOpusBitrateKbps: DEFAULT_MULTIPLAYER_SETTINGS.multiplayerOpusBitrateKbps,
      multiplayerAudioBufferMs: DEFAULT_MULTIPLAYER_SETTINGS.multiplayerAudioBufferMs,
      multiplayerRenderCacheLimitMiB: DEFAULT_MULTIPLAYER_SETTINGS.multiplayerRenderCacheLimitMiB,
      multiplayerRenderDiskCacheEnabled: DEFAULT_MULTIPLAYER_SETTINGS.multiplayerRenderDiskCacheEnabled,
      multiplayerRenderDiskCacheLimitMiB: DEFAULT_MULTIPLAYER_SETTINGS.multiplayerRenderDiskCacheLimitMiB,
      multiplayerMaxListeners: DEFAULT_MULTIPLAYER_SETTINGS.multiplayerMaxListeners
    });
  });

  it('trims and bounds the host message of the day', () => {
    expect(normalizeMultiplayerSettings({
      multiplayerMotd: `  ${'x'.repeat(600)}  `
    }).multiplayerMotd).toBe('x'.repeat(500));
  });

  it('persists the Freeplay opt-in independently from Multiplayer', () => {
    expect(normalizeMultiplayerSettings({ multiplayerFreeplay: true })).toMatchObject({
      multiplayer: false,
      multiplayerFreeplay: true
    });
  });

  it('normalizes the "Send files under" limit to the bounded choices', () => {
    expect(normalizeMultiplayerSettings({ multiplayerFileTransferLimitMiB: 16 })).toMatchObject({
      multiplayerFileTransferLimitMiB: 16
    });
    expect(normalizeMultiplayerSettings({ multiplayerFileTransferLimitMiB: -1 })).toMatchObject({
      multiplayerFileTransferLimitMiB: -1
    });
    expect(normalizeMultiplayerSettings({ multiplayerFileTransferLimitMiB: 7 })).toMatchObject({
      multiplayerFileTransferLimitMiB: DEFAULT_MULTIPLAYER_SETTINGS.multiplayerFileTransferLimitMiB
    });
  });

  it('defaults server setup state to unconfigured and explicit opt-ins off', () => {
    expect(normalizeMultiplayerSettings({})).toMatchObject({
      multiplayerServerEndpoint: '',
      multiplayerServerNoticeVersion: 0,
      multiplayerServerForceRelay: false,
      multiplayerServerIceAck: ''
    });
  });

  it('normalizes server setup fields across windows', () => {
    expect(normalizeMultiplayerSettings({
      multiplayerServerNoticeVersion: 2.7,
      multiplayerServerForceRelay: true,
      multiplayerServerIceAck: 'x'.repeat(3_000)
    })).toMatchObject({
      multiplayerServerNoticeVersion: 2,
      multiplayerServerForceRelay: true,
      multiplayerServerIceAck: 'x'.repeat(2_048)
    });
    expect(normalizeMultiplayerSettings({
      multiplayerServerNoticeVersion: Number.NaN
    })).toMatchObject({
      multiplayerServerNoticeVersion: 0
    });
  });

  it('bounds bitrate and listener controls', () => {
    expect(normalizeMultiplayerSettings({ multiplayerOpusBitrateKbps: 1 }).multiplayerOpusBitrateKbps)
      .toBe(MULTIPLAYER_OPUS_BITRATE_MIN_KBPS);
    expect(normalizeMultiplayerSettings({ multiplayerOpusBitrateKbps: 999 }).multiplayerOpusBitrateKbps)
      .toBe(MULTIPLAYER_OPUS_BITRATE_MAX_KBPS);
    expect(normalizeMultiplayerSettings({ multiplayerAudioBufferMs: 1 }).multiplayerAudioBufferMs)
      .toBe(MULTIPLAYER_AUDIO_BUFFER_MIN_MS);
    expect(normalizeMultiplayerSettings({ multiplayerAudioBufferMs: 99_999 }).multiplayerAudioBufferMs)
      .toBe(MULTIPLAYER_AUDIO_BUFFER_MAX_MS);
    expect(normalizeMultiplayerSettings({ multiplayerMaxListeners: 99 }).multiplayerMaxListeners)
      .toBe(MULTIPLAYER_MAX_LISTENERS_MAX);
  });

  it('accepts only the render-cache slider values', () => {
    expect(normalizeMultiplayerSettings({ multiplayerRenderCacheLimitMiB: 128 }).multiplayerRenderCacheLimitMiB)
      .toBe(128);
    expect(normalizeMultiplayerSettings({ multiplayerRenderCacheLimitMiB: 0 }).multiplayerRenderCacheLimitMiB)
      .toBe(0);
    expect(normalizeMultiplayerSettings({ multiplayerRenderCacheLimitMiB: 100 }).multiplayerRenderCacheLimitMiB)
      .toBe(DEFAULT_MULTIPLAYER_SETTINGS.multiplayerRenderCacheLimitMiB);
  });

  it('accepts only the disk-cache limit choices and keeps it enabled by default', () => {
    expect(normalizeMultiplayerSettings({ multiplayerRenderDiskCacheLimitMiB: 1024 }).multiplayerRenderDiskCacheLimitMiB)
      .toBe(1024);
    expect(normalizeMultiplayerSettings({ multiplayerRenderDiskCacheLimitMiB: 0 }).multiplayerRenderDiskCacheLimitMiB)
      .toBe(DEFAULT_MULTIPLAYER_SETTINGS.multiplayerRenderDiskCacheLimitMiB);
    expect(normalizeMultiplayerSettings({ multiplayerRenderDiskCacheLimitMiB: 999 }).multiplayerRenderDiskCacheLimitMiB)
      .toBe(DEFAULT_MULTIPLAYER_SETTINGS.multiplayerRenderDiskCacheLimitMiB);
    expect(normalizeMultiplayerSettings({ multiplayerRenderDiskCacheEnabled: false }).multiplayerRenderDiskCacheEnabled)
      .toBe(false);
    expect(normalizeMultiplayerSettings({}).multiplayerRenderDiskCacheEnabled)
      .toBe(true);
  });

  it('normalizes synchronized playback and bounds its lead time', () => {
    expect(normalizeMultiplayerSettings({
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
