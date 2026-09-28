import { describe, expect, it } from 'vitest';
import type { MultiplayerAudioStatus, MultiplayerConnectionStatus } from '$lib/services/multiplayer-types';
import type { MultiplayerConnectionRoute } from '$lib/services/multiplayer-ice';
import {
  formatMultiplayerAudioStatusLabel,
  formatConnectionStat,
  formatAudioStat,
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

  it('labels both delivery modes and uses the render bitrate', () => {
    expect(formatAudioStat(true, 'render', 64, t)).toBe('Buffered Opus · 64 kbps');
    expect(formatAudioStat(true, 'render', null, t)).toBe('Buffered Opus');
    expect(formatAudioStat(true, 'source-file', null, t)).toBe('Source file');
    expect(formatAudioStat(true, 'none', null, t)).toBe('Host audio is off');
    expect(formatAudioStat(false, 'render', null, t)).toBe('Refused');
  });
});
