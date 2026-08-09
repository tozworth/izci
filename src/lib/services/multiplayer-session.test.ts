import { describe, expect, it } from 'vitest';
import {
  isMultiplayerClientTransportHealthy,
  isMultiplayerFreeplayActive,
  isMultiplayerPlaybackPreparationReady,
  resolveMultiplayerFreeplayAgreement,
  sanitizeFreeplayQueueIds,
  shouldTransferMultiplayerSourceFile
} from './multiplayer-utils';
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

  it('updates the persisted agreement when both current opt-ins change', () => {
    expect(resolveMultiplayerFreeplayAgreement({ paired: true, hostEnabled: true, clientEnabled: true }))
      .toBe(true);
    expect(resolveMultiplayerFreeplayAgreement({ paired: true, hostEnabled: false, clientEnabled: true }))
      .toBe(false);
  });

  it('deduplicates and bounds the client queue before sending it', () => {
    expect(sanitizeFreeplayQueueIds(['b', 'a', 'b', '', 'c'])).toEqual(['b', 'a', 'c']);
  });
});

describe('multiplayer playback preparation', () => {
  const baseState = {
    remoteTrackId: 'track',
    receiveAudio: true,
    loadedSourceTrackId: null,
    loadedSourceGenerationId: null,
    streamReady: false
  };

  it('waits for a transferred file to be loaded for the requested track', () => {
    const preparation = { preparationId: 'one', trackId: 'track', delivery: 'source-file' as const };
    expect(isMultiplayerPlaybackPreparationReady(preparation, baseState)).toBe(false);
    expect(isMultiplayerPlaybackPreparationReady(preparation, {
      ...baseState,
      loadedSourceTrackId: 'track',
      loadedSourceGenerationId: 'one'
    })).toBe(true);
    expect(isMultiplayerPlaybackPreparationReady(preparation, {
      ...baseState,
      remoteTrackId: 'other',
      loadedSourceTrackId: 'track',
      loadedSourceGenerationId: 'one'
    })).toBe(false);
  });

  it('waits for a stream to be listening', () => {
    const preparation = { preparationId: 'one', trackId: 'track', delivery: 'stream' as const };
    expect(isMultiplayerPlaybackPreparationReady(preparation, baseState)).toBe(false);
    expect(isMultiplayerPlaybackPreparationReady(preparation, {
      ...baseState,
      streamReady: true
    })).toBe(true);
  });

  it('does not block clients that opted out of audio or sessions with no audio', () => {
    expect(isMultiplayerPlaybackPreparationReady(
      { preparationId: 'one', trackId: 'track', delivery: 'source-file' },
      { ...baseState, receiveAudio: false }
    )).toBe(true);
    expect(isMultiplayerPlaybackPreparationReady(
      { preparationId: 'one', trackId: 'track', delivery: 'none' },
      baseState
    )).toBe(true);
  });
});
