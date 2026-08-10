import { describe, expect, it } from 'vitest';
import {
  isMultiplayerClientTransportHealthy,
  isMultiplayerFreeplayActive,
  resolveMultiplayerDeliveryMode,
  resolveMultiplayerFreeplayAgreement,
  sanitizeFreeplayQueueIds
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

describe('multiplayer render delivery selection', () => {
  function track(kind: PlaylistItem['kind']): PlaylistItem {
    return {
      id: 'track',
      name: 'track.flac',
      extension: 'flac',
      kind,
      size: 1,
      lastModified: 1
    };
  }

  it('pre-renders audio and modules, and keeps live RTP only for video', () => {
    expect(resolveMultiplayerDeliveryMode(track('stream'), true)).toBe('render');
    expect(resolveMultiplayerDeliveryMode(track('module'), true)).toBe('render');
    expect(resolveMultiplayerDeliveryMode(track('video'), true)).toBe('stream');
  });

  it('disables delivery when the audio master switch is off or no track is set', () => {
    expect(resolveMultiplayerDeliveryMode(track('stream'), false)).toBe('none');
    expect(resolveMultiplayerDeliveryMode(null, true)).toBe('none');
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
