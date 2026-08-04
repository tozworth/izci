import { describe, expect, it } from 'vitest';
import {
  isMultiplayerClientTransportHealthy,
  isMultiplayerFreeplayActive,
  isMultiplayerPlaybackPreparationReady,
  shouldTransferMultiplayerSourceFile
} from './multiplayer-session';
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

describe('Freeplay pairing negotiation', () => {
  const enabledPairing = {
    paired: true,
    freeplayPaired: true,
    hostEnabled: true,
    clientEnabled: true
  };

  it('activates only for a persisted pairing with both current opt-ins', () => {
    expect(isMultiplayerFreeplayActive(enabledPairing)).toBe(true);
    for (const key of Object.keys(enabledPairing) as Array<keyof typeof enabledPairing>) {
      expect(isMultiplayerFreeplayActive({ ...enabledPairing, [key]: false })).toBe(false);
    }
  });
});

describe('multiplayer playback preparation', () => {
  const baseState = {
    remoteTrackId: 'track',
    receiveAudio: true,
    loadedSourceTrackId: null,
    streamReady: false
  };

  it('waits for a transferred file to be loaded for the requested track', () => {
    const preparation = { preparationId: 'one', trackId: 'track', audio: 'file' as const };
    expect(isMultiplayerPlaybackPreparationReady(preparation, baseState)).toBe(false);
    expect(isMultiplayerPlaybackPreparationReady(preparation, {
      ...baseState,
      loadedSourceTrackId: 'track'
    })).toBe(true);
    expect(isMultiplayerPlaybackPreparationReady(preparation, {
      ...baseState,
      remoteTrackId: 'other',
      loadedSourceTrackId: 'track'
    })).toBe(false);
  });

  it('waits for a stream to be listening', () => {
    const preparation = { preparationId: 'one', trackId: 'track', audio: 'stream' as const };
    expect(isMultiplayerPlaybackPreparationReady(preparation, baseState)).toBe(false);
    expect(isMultiplayerPlaybackPreparationReady(preparation, {
      ...baseState,
      streamReady: true
    })).toBe(true);
  });

  it('does not block clients that opted out of audio or sessions with no audio', () => {
    expect(isMultiplayerPlaybackPreparationReady(
      { preparationId: 'one', trackId: 'track', audio: 'file' },
      { ...baseState, receiveAudio: false }
    )).toBe(true);
    expect(isMultiplayerPlaybackPreparationReady(
      { preparationId: 'one', trackId: 'track', audio: 'none' },
      baseState
    )).toBe(true);
  });
});
