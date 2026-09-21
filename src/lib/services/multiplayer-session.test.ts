import { describe, expect, it } from 'vitest';
import { MULTIPLAYER_PROTOCOL_MAJOR } from './multiplayer-protocol';
import {
  isMultiplayerClientTransportHealthy,
  isIncompatibleProtocolHello,
  isMultiplayerFreeplayActive,
  resolveMultiplayerDeliveryMode,
  sanitizeFreeplayQueueIds
} from './multiplayer-utils';
import type { TrackItem } from '$lib/types';

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
  function track(kind: TrackItem['kind'], size = 1): TrackItem {
    return {
      id: 'track',
      name: 'track.flac',
      extension: 'flac',
      kind,
      size,
      lastModified: 1
    };
  }

  it('pre-renders audio and modules over the limit, and keeps live RTP only for video', () => {
    expect(resolveMultiplayerDeliveryMode(track('stream'), true)).toBe('render');
    expect(resolveMultiplayerDeliveryMode(track('module'), true)).toBe('render');
    expect(resolveMultiplayerDeliveryMode(track('video'), true)).toBe('stream');
  });

  it('transfers files under the "Send files under" limit whole', () => {
    expect(resolveMultiplayerDeliveryMode(track('stream', 4 * 1024 * 1024), true, 8)).toBe('source-file');
    expect(resolveMultiplayerDeliveryMode(track('module', 1), true, 8)).toBe('source-file');
    // The limit is strict: a file exactly at the limit still pre-renders.
    expect(resolveMultiplayerDeliveryMode(track('stream', 8 * 1024 * 1024), true, 8)).toBe('render');
    // 0 = off (everything renders), < 0 = every file transfers.
    expect(resolveMultiplayerDeliveryMode(track('stream', 1), true, 0)).toBe('render');
    expect(resolveMultiplayerDeliveryMode(track('stream', 1), true, -1)).toBe('source-file');
    // Video ignores the limit and keeps the live RTP path.
    expect(resolveMultiplayerDeliveryMode(track('video', 1), true, 8)).toBe('stream');
    // Unknown size falls back to pre-rendering rather than transferring.
    expect(resolveMultiplayerDeliveryMode({ ...track('stream'), size: 0 }, true, 8)).toBe('render');
  });

  it('disables delivery when the audio master switch is off or no track is set', () => {
    expect(resolveMultiplayerDeliveryMode(track('stream'), false)).toBe('none');
    expect(resolveMultiplayerDeliveryMode(null, true)).toBe('none');
  });
});

describe('isIncompatibleProtocolHello', () => {
  it('accepts a hello at the current major regardless of minor', () => {
    expect(isIncompatibleProtocolHello({
      kind: 'hello',
      protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR,
      protocolMinor: 0,
      capabilities: []
    })).toBe(false);
    expect(isIncompatibleProtocolHello({
      kind: 'hello',
      protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR,
      protocolMinor: 99,
      capabilities: ['future-cap']
    })).toBe(false);
  });

  it('detects a hello from a different major', () => {
    expect(isIncompatibleProtocolHello({
      kind: 'hello',
      protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR + 1,
      protocolMinor: 0,
      capabilities: []
    })).toBe(true);
  });

  it('detects legacy integer-version hellos as incompatible', () => {
    expect(isIncompatibleProtocolHello({
      kind: 'hello',
      version: 29
    })).toBe(true);
  });

  it('rejects non-hello messages even with a version', () => {
    expect(isIncompatibleProtocolHello({
      kind: 'state',
      protocolMajor: MULTIPLAYER_PROTOCOL_MAJOR - 1
    })).toBe(false);
  });

  it('rejects malformed or non-object frames', () => {
    expect(isIncompatibleProtocolHello(null)).toBe(false);
    expect(isIncompatibleProtocolHello('hello')).toBe(false);
    expect(isIncompatibleProtocolHello({ kind: 'hello' })).toBe(false);
    expect(isIncompatibleProtocolHello({ kind: 'hello', version: '18' })).toBe(false);
  });
});

describe('Freeplay negotiation', () => {
  const enabledPreferences = {
    hostEnabled: true,
    clientEnabled: true
  };

  it('activates whenever both connected peers opt in', () => {
    expect(isMultiplayerFreeplayActive(enabledPreferences)).toBe(true);
    for (const key of Object.keys(enabledPreferences) as Array<keyof typeof enabledPreferences>) {
      expect(isMultiplayerFreeplayActive({ ...enabledPreferences, [key]: false })).toBe(false);
    }
  });

  it('deduplicates and bounds the client queue before sending it', () => {
    expect(sanitizeFreeplayQueueIds(['b', 'a', 'b', '', 'c'])).toEqual(['b', 'a', 'c']);
  });
});
