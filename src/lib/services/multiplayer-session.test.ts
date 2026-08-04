import { describe, expect, it } from 'vitest';
import { isMultiplayerClientTransportHealthy, shouldTransferMultiplayerSourceFile } from './multiplayer-session';
import type { PlaylistItem } from '$lib/types';

describe('multiplayer client lifecycle', () => {
  it('keeps a connected transport when the app resumes', () => {
    expect(isMultiplayerClientTransportHealthy('connected', 'open')).toBe(true);
  });

  it.each([
    ['disconnected', 'open'],
    ['failed', 'open'],
    ['connected', 'closing'],
    ['connected', 'closed'],
    ['connected', undefined]
  ] as const)('reconnects an unhealthy %s/%s transport', (connectionState, channelState) => {
    expect(isMultiplayerClientTransportHealthy(connectionState, channelState)).toBe(false);
  });
});

describe('multiplayer source-file selection', () => {
  function trackWithSize(size: number): PlaylistItem {
    const file = new File([new Uint8Array(size)], 'track.flac');
    return {
      id: 'track',
      name: 'track.flac',
      extension: 'flac',
      kind: 'stream',
      size,
      lastModified: 1,
      file
    };
  }

  it('uses strict MiB thresholds and the two sentinel values', () => {
    const track = trackWithSize(2 * 1024 * 1024 - 1);
    expect(shouldTransferMultiplayerSourceFile(track, 0)).toBe(false);
    expect(shouldTransferMultiplayerSourceFile(track, 2)).toBe(true);
    expect(shouldTransferMultiplayerSourceFile(trackWithSize(2 * 1024 * 1024), 2)).toBe(false);
    expect(shouldTransferMultiplayerSourceFile(track, -1)).toBe(true);
  });

  it('always streams videos and respects the audio master switch', () => {
    const track = trackWithSize(1);
    expect(shouldTransferMultiplayerSourceFile({ ...track, kind: 'video' }, -1)).toBe(false);
    expect(shouldTransferMultiplayerSourceFile(track, -1, false)).toBe(false);
  });
});
