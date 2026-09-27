import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MultiplayerClientContext } from './multiplayer-client';

vi.mock('./multiplayer-audio', () => ({ multiplayerAudioService: { warmRemoteAudio: vi.fn() } }));
vi.mock('./multiplayer-render-playback', () => ({ multiplayerRenderPlaybackService: {} }));
vi.mock('./multiplayer-source-playback', () => ({ multiplayerSourcePlaybackService: {
  beginClientSession: vi.fn(), setEnabled: vi.fn(), replay: vi.fn()
} }));
vi.mock('./multiplayer-peer', () => ({ sendToPeer: vi.fn() }));
vi.mock('./multiplayer-client-audio', () => ({
  applyClientAudioBuffer: vi.fn(), sendClientPlaybackReadyIfPossible: vi.fn()
}));

import { beginClientPlaybackSession, scheduleClientReconnect } from './multiplayer-client-lifecycle';
import { multiplayerSourcePlaybackService } from './multiplayer-source-playback';
import { sendToPeer } from './multiplayer-peer';

function context(reconnectSignaling: () => Promise<void> = vi.fn(async () => undefined)) {
  const core = {
    state: { mode: 'client', connectionStatus: 'disconnected' },
    serverGuest: { reconnectSignaling },
    transportGeneration: 1,
    allowClientReconnect: true,
    reconnectInFlight: false,
    reconnectTimer: null,
    reconnectAttempts: 0,
    publish: vi.fn()
  };
  return { core } as unknown as MultiplayerClientContext;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal('window', { setTimeout, clearTimeout });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('server client reconnect', () => {
  it('reconnects through the admitted server guest with a bounded deadline', async () => {
    const reconnect = vi.fn(async () => undefined);
    const ctx = context(reconnect);
    scheduleClientReconnect(ctx, 0);
    await vi.advanceTimersByTimeAsync(0);
    expect(reconnect).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(ctx.core.reconnectInFlight).toBe(false);
  });

  it('cannot reconnect a session that was replaced before the timer fired', async () => {
    const reconnect = vi.fn(async () => undefined);
    const ctx = context(reconnect);
    scheduleClientReconnect(ctx, 100);
    ctx.core.transportGeneration += 1;
    await vi.advanceTimersByTimeAsync(100);
    expect(reconnect).not.toHaveBeenCalled();
    expect(ctx.core.publish).not.toHaveBeenCalled();
  });

  it('ignores late completion after another session took ownership', async () => {
    let finish!: () => void;
    const reconnect = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const ctx = context(reconnect);
    scheduleClientReconnect(ctx, 0);
    await vi.advanceTimersByTimeAsync(0);
    ctx.core.transportGeneration += 1;
    ctx.core.reconnectInFlight = true;
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(ctx.core.reconnectInFlight).toBe(true);
    expect(ctx.core.reconnectTimer).toBeNull();
  });
});

describe('server received-file playback session', () => {
  function playbackContext(freeplay: boolean, repeatMode: 'one' | 'off') {
    return {
      core: {
        state: { mode: 'client', receiveAudio: true, freeplay,
          remoteCatalog: { repeatMode }, hostImplementation: { product: 'izci-server' } },
        clientPeer: {}
      },
      transition: { isCurrent: vi.fn(() => true) }
    } as unknown as MultiplayerClientContext;
  }

  it('reports a current received-file ending and ignores stale generations', () => {
    const ctx = playbackContext(false, 'off');
    beginClientPlaybackSession(ctx);
    expect(multiplayerSourcePlaybackService.setEnabled).toHaveBeenCalledWith(true);
    const ended = vi.mocked(multiplayerSourcePlaybackService.beginClientSession).mock.calls[0][0]!;
    ended('track', 'generation');
    expect(sendToPeer).toHaveBeenCalledWith(ctx.core.clientPeer,
      { kind: 'playback.ended', trackId: 'track', generationId: 'generation' });
    vi.mocked(ctx.transition.isCurrent).mockReturnValue(false);
    ended('old-track', 'old-generation');
    expect(sendToPeer).toHaveBeenCalledOnce();
  });

  it('repeats Freeplay files locally when repeat-one is active', () => {
    beginClientPlaybackSession(playbackContext(true, 'one'));
    vi.mocked(multiplayerSourcePlaybackService.beginClientSession).mock.calls[0][0]!('track', 'generation');
    expect(multiplayerSourcePlaybackService.replay).toHaveBeenCalledOnce();
    expect(sendToPeer).not.toHaveBeenCalled();
  });
});
