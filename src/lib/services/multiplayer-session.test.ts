import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExperimentalSettings } from '$lib/contracts/experimental-settings';
import type { MediaEntity } from '$lib/contracts/catalog';

const sessionHarness = vi.hoisted(() => {
  const settings: ExperimentalSettings = {
    multiplayer: true,
    izciName: 'Scout test',
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
    multiplayerFileTransferLimitMiB: 0,
    multiplayerOpusBitrateKbps: 128,
    multiplayerAudioBufferMs: 3_000,
    multiplayerRenderCacheLimitMiB: 256,
    multiplayerRenderDiskCacheEnabled: true,
    multiplayerRenderDiskCacheLimitMiB: 1_024,
    multiplayerMaxListeners: 4
  };
  const settingsListeners = new Set<(value: ExperimentalSettings) => void>();
  let core: any = null;
  const host = {
    startHosting: vi.fn(() => Promise.resolve()),
    stopHosting: vi.fn(() => Promise.resolve()),
    kick: vi.fn(),
    togglePairing: vi.fn(),
    cancelPendingPlayback: vi.fn(),
    updateHostState: vi.fn(),
    syncHostAudio: vi.fn(),
    syncHostSourceFiles: vi.fn(),
    syncPeerFreeplayMode: vi.fn(),
    releasePreparedHostPlayback: vi.fn(),
    beginHostPlaybackPreparation: vi.fn(),
    beginFreeplayPlaybackPreparation: vi.fn()
  };
  const client = {
    join: vi.fn(() => Promise.resolve()),
    joinPaired: vi.fn(() => Promise.resolve()),
    restoreClientJoin: vi.fn(() => Promise.resolve()),
    leave: vi.fn(() => Promise.resolve()),
    sendCommand: vi.fn(),
    setFreeplayQueue: vi.fn(),
    resumeAudio: vi.fn(() => Promise.resolve(true)),
    setReceiveAudio: vi.fn(),
    applyClientAudioBuffer: vi.fn(),
    handleClientResume: vi.fn(),
    clearReceiverMonitor: vi.fn(),
    clearReconnectTimer: vi.fn(),
    resetTransitions: vi.fn()
  };
  return {
    settings,
    settingsListeners,
    get core() { return core; },
    setCore(next: any) { core = next; },
    host,
    client,
    audio: { clearRemoteTrack: vi.fn(), releaseHostTrack: vi.fn() },
    source: { clearLoadedFile: vi.fn() },
    render: { release: vi.fn() },
    coordinator: { clear: vi.fn(), setCacheLimitMiB: vi.fn() },
    disposePeerConnection: vi.fn(),
    sendToPeer: vi.fn()
  };
});

vi.mock('$lib/stores/experimental-settings', () => ({
  experimentalSettings: {
    getSnapshot: () => ({ ...sessionHarness.settings }),
    subscribe: (listener: (value: ExperimentalSettings) => void) => {
      sessionHarness.settingsListeners.add(listener);
      listener({ ...sessionHarness.settings });
      return () => sessionHarness.settingsListeners.delete(listener);
    }
  }
}));
vi.mock('$lib/stores/multiplayer-last-session', () => ({
  multiplayerLastSession: { getSnapshot: () => null }
}));
vi.mock('$lib/logging/api', () => ({ logDebug: vi.fn(), logWarning: vi.fn() }));
vi.mock('./multiplayer-audio', () => ({ multiplayerAudioService: sessionHarness.audio }));
vi.mock('./multiplayer-source-playback', () => ({ multiplayerSourcePlaybackService: sessionHarness.source }));
vi.mock('./multiplayer-render-playback', () => ({ multiplayerRenderPlaybackService: sessionHarness.render }));
vi.mock('./multiplayer-render-coordinator', () => ({ multiplayerRenderCoordinator: sessionHarness.coordinator }));
vi.mock('./multiplayer-peer', () => ({
  disposePeerConnection: sessionHarness.disposePeerConnection,
  sendToPeer: sessionHarness.sendToPeer
}));
vi.mock('./multiplayer-host', () => ({
  createMultiplayerHostSide: (core: unknown) => {
    sessionHarness.setCore(core);
    return sessionHarness.host;
  }
}));
vi.mock('./multiplayer-client', () => ({
  createMultiplayerClientSide: () => sessionHarness.client
}));

import { createMultiplayerSession } from './multiplayer-session';
import {
  isMultiplayerClientTransportHealthy,
  isMultiplayerFreeplayActive,
  resolveMultiplayerDeliveryMode,
  resolveMultiplayerFreeplayAgreement,
  sanitizeFreeplayQueueIds
} from './multiplayer-utils';

function emitSettings(patch: Partial<ExperimentalSettings>): void {
  Object.assign(sessionHarness.settings, patch);
  for (const listener of sessionHarness.settingsListeners) listener({ ...sessionHarness.settings });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionHarness.settingsListeners.clear();
  Object.assign(sessionHarness.settings, {
    multiplayerWaitForClients: false,
    multiplayerSynchronizedPlayback: false,
    multiplayerFreeplay: false,
    multiplayerStreamAudio: true,
    multiplayerFileTransferLimitMiB: 0,
    multiplayerOpusBitrateKbps: 128,
    multiplayerAudioBufferMs: 3_000,
    multiplayerRenderCacheLimitMiB: 256
  });
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    clearTimeout: vi.fn(),
    localStorage: { getItem: vi.fn(() => null) }
  });
  vi.stubGlobal('document', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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

describe('multiplayer session generation replacement', () => {
  const activeTrack: MediaEntity = {
    id: 'playing',
    path: 'test',
    name: 'playing.flac',
    format: 'flac',
    kind: 'stream',
    size: 10,
    lastModified: 1
  };

  it('forces a fresh host delivery when bitrate or transfer policy changes', () => {
    const session = createMultiplayerSession({
      handleHostCommand: vi.fn(),
      pauseHostPlayback: vi.fn(),
      resumeHostPlayback: vi.fn()
    });
    sessionHarness.core.state = { ...sessionHarness.core.state, mode: 'hosting' };
    sessionHarness.core.latestHostState = { track: activeTrack };

    emitSettings({ multiplayerOpusBitrateKbps: 96 });
    expect(sessionHarness.host.syncHostAudio).toHaveBeenLastCalledWith(activeTrack, true);
    expect(sessionHarness.host.syncHostSourceFiles).toHaveBeenLastCalledWith(activeTrack);

    sessionHarness.host.syncHostAudio.mockClear();
    sessionHarness.host.syncHostSourceFiles.mockClear();
    emitSettings({ multiplayerAudioBufferMs: 4_000 });
    expect(sessionHarness.host.syncHostAudio).not.toHaveBeenCalled();
    expect(sessionHarness.host.syncHostSourceFiles).not.toHaveBeenCalled();

    emitSettings({ multiplayerFileTransferLimitMiB: 8 });
    expect(sessionHarness.host.syncHostAudio).toHaveBeenLastCalledWith(activeTrack, true);
    expect(sessionHarness.host.syncHostSourceFiles).toHaveBeenLastCalledWith(activeTrack);
    session.destroy();
  });

  it('disposes peer and media ownership and clears the active generation', async () => {
    const session = createMultiplayerSession({
      handleHostCommand: vi.fn(),
      pauseHostPlayback: vi.fn(),
      resumeHostPlayback: vi.fn()
    });
    const hostPeer = { id: 'host-peer' };
    const clientPeer = { id: 'client-peer' };
    sessionHarness.core.hostPeers.set(hostPeer.id, hostPeer);
    sessionHarness.core.clientPeer = clientPeer;
    sessionHarness.core.pendingClientSourceFile = {
      generationId: 'old-generation',
      trackId: activeTrack.id,
      file: {}
    };
    sessionHarness.core.latestDelivery = {
      generationId: 'old-generation',
      trackId: activeTrack.id,
      mode: 'source-file',
      reason: null
    };

    await sessionHarness.core.resetSession(false);

    expect(sessionHarness.client.resetTransitions).toHaveBeenCalledOnce();
    expect(sessionHarness.disposePeerConnection).toHaveBeenCalledWith(hostPeer);
    expect(sessionHarness.disposePeerConnection).toHaveBeenCalledWith(clientPeer);
    expect(sessionHarness.audio.clearRemoteTrack).toHaveBeenCalledOnce();
    expect(sessionHarness.source.clearLoadedFile).toHaveBeenCalledOnce();
    expect(sessionHarness.render.release).toHaveBeenCalledOnce();
    expect(sessionHarness.core.pendingClientSourceFile).toBeNull();
    expect(sessionHarness.core.latestDelivery).toEqual({
      generationId: 'idle',
      trackId: null,
      mode: 'none',
      reason: 'host-disabled'
    });
    session.destroy();
  });
});

describe('multiplayer render delivery selection', () => {
  function track(kind: MediaEntity['kind'], size = 1): MediaEntity {
    return {
      id: 'track',
      path: 'test',
      name: 'track.flac',
      format: 'flac',
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
