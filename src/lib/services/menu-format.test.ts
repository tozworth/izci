import { describe, expect, it } from 'vitest';
import type { MultiplayerAudioStatus, MultiplayerConnectionStatus } from '$lib/services/multiplayer-types';
import type { MultiplayerConnectionRoute } from '$lib/services/multiplayer-ice';
import {
  formatMultiplayerAudioStatusLabel,
  formatConnectionStat,
  formatAudioStat,
  formatPacketLoss,
  formatBytes,
  formatTimingStat,
  type MenuTranslation
} from './menu-format';

const t: MenuTranslation = (_id, options) => options?.default ?? String(_id);

describe('menu-format helpers', () => {
  it('labels multiplayer audio status with route and bitrate', () => {
    expect(formatMultiplayerAudioStatusLabel('playing' as MultiplayerAudioStatus, 'direct', 128, t))
      .toBe('Listening · Direct · 128 kbps');
    expect(formatMultiplayerAudioStatusLabel('blocked' as MultiplayerAudioStatus, null, null, t))
      .toBe('Audio needs permission');
  });

  it('formats connection stats with route label', () => {
    expect(formatConnectionStat('connected' as MultiplayerConnectionStatus, 'relayed' as MultiplayerConnectionRoute, t))
      .toBe('connected · Relayed');
    expect(formatConnectionStat('disconnected' as MultiplayerConnectionStatus, null, t))
      .toBe('disconnected');
  });

  it('formats audio stats from codec and bitrate', () => {
    expect(formatAudioStat(true, { codec: 'opus' } as never, 64, t)).toBe('opus · 64 kbps');
    expect(formatAudioStat(true, null, null, t)).toBe('—');
    expect(formatAudioStat(false, null, null, t)).toBe('Refused');
  });

  it('formats packet loss with optional percentage', () => {
    expect(formatPacketLoss(2, 98, 2)).toBe('2 / 100 · 2%');
    expect(formatPacketLoss(2, 98, null)).toBe('2 / 100');
    expect(formatPacketLoss(undefined, 98, null)).toBe('—');
  });

  it('formats byte counts with units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1000)).toBe('1 KB');
    expect(formatBytes(12_345)).toBe('12.3 KB');
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });

  it('formats jitter and rtt timing stats', () => {
    expect(formatTimingStat({ jitterMs: 12, roundTripTimeMs: 40 } as never)).toBe('12 ms · 40 ms');
    expect(formatTimingStat({ jitterMs: null, roundTripTimeMs: null } as never)).toBe('— · —');
  });
});
