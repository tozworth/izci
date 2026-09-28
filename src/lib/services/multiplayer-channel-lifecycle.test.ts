import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachClientChannel } from './multiplayer-client-channels';
import { announceHostPeerLeave, attachHostChannel } from './multiplayer-host-channels';
import type { MultiplayerClientContext } from './multiplayer-client';
import type { MultiplayerHostContext } from './multiplayer-host';
import { EMPTY_DELIVERY, EMPTY_REMOTE_PLAYBACK, type PeerConnection } from './multiplayer-types';
import { MultiplayerClientTransition } from './multiplayer-client-transition';
import { multiplayerRenderPlaybackService } from './multiplayer-render-playback';
import { multiplayerSourcePlaybackService } from './multiplayer-source-playback';

function controlChannel(): RTCDataChannel {
  return {
    readyState: 'closed',
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn()
  } as unknown as RTCDataChannel;
}

function peer(id: string): PeerConnection {
  return {
    id,
    name: id,
    pc: { connectionState: 'connected' },
    channel: controlChannel(),
    outgoing: [],
    flushing: false,
    decode: vi.fn()
  } as unknown as PeerConnection;
}

describe('multiplayer channel lifecycle', () => {
  it('ignores host callbacks from a replaced peer', () => {
    const previous = peer('client');
    const replacement = peer('client');
    const updateClient = vi.fn();
    const handleHostCommand = vi.fn();
    const core = {
      hostPeers: new Map([['client', previous]]),
      updateClient
    };
    const ctx = {
      core,
      handleHostCommand
    } as unknown as MultiplayerHostContext;
    const channel = previous.channel!;
    vi.mocked(previous.decode).mockReturnValue({
      kind: 'command',
      command: { type: 'transport.play', commandId: 'command' }
    });
    attachHostChannel(ctx, previous, channel);
    core.hostPeers.set('client', replacement);

    channel.onmessage?.({ data: '{}' } as MessageEvent);
    channel.onclose?.({} as Event);

    expect(previous.decode).not.toHaveBeenCalled();
    expect(handleHostCommand).not.toHaveBeenCalled();
    expect(updateClient).not.toHaveBeenCalled();
  });

  it('announces a peer leave only once after a joined peer disconnects', () => {
    const joinedPeer = peer('client');
    joinedPeer.helloReceived = true;
    const handleChatPresence = vi.fn();
    const ctx = { handleChatPresence } as unknown as MultiplayerHostContext;

    announceHostPeerLeave(ctx, joinedPeer);
    announceHostPeerLeave(ctx, joinedPeer);

    expect(handleChatPresence).toHaveBeenCalledOnce();
    expect(handleChatPresence).toHaveBeenCalledWith('client', 'leave');
  });

  it('ignores client messages from a replaced host peer', () => {
    const previous = peer('host');
    const replacement = peer('host');
    const core = {
      clientPeer: previous,
      hostAudioBufferMs: null
    };
    const ctx = { core } as unknown as MultiplayerClientContext;
    const channel = previous.channel!;
    attachClientChannel(ctx, previous);
    core.clientPeer = replacement;

    channel.onmessage?.({
      data: JSON.stringify({ kind: 'buffer', bufferMs: 750 })
    } as MessageEvent);

    expect(core.hostAudioBufferMs).toBeNull();
  });
});

describe('multiplayer delivery changes', () => {
  afterEach(() => vi.restoreAllMocks());

  function client(receiveAudio: boolean) {
    const host = peer('host');
    const core = {
      clientPeer: host,
      latestDelivery: { ...EMPTY_DELIVERY },
      pendingClientSourceFile: null,
      hostAudioBufferMs: null,
      multiplayerSettings: { multiplayerAudioBufferMs: 3000 },
      state: {
        mode: 'client', receiveAudio, freeplay: false,
        remoteDelivery: { ...EMPTY_DELIVERY },
        remotePlayback: { ...EMPTY_REMOTE_PLAYBACK }
      },
      publish: vi.fn((patch) => Object.assign(core.state, patch))
    };
    const ctx = {
      core, transition: new MultiplayerClientTransition(),
      synchronizedStartTimer: null
    } as unknown as MultiplayerClientContext;
    vi.spyOn(multiplayerSourcePlaybackService, 'setLocalTimeline').mockImplementation(() => undefined);
    vi.spyOn(multiplayerSourcePlaybackService, 'setEnabled').mockReturnValue(false);
    vi.spyOn(multiplayerSourcePlaybackService, 'clearSourceTrack').mockImplementation(() => undefined);
    vi.spyOn(multiplayerRenderPlaybackService, 'getState').mockReturnValue({ ready: false } as never);
    attachClientChannel(ctx, host);
    return { host, core };
  }

  it.each(['source-file', 'none'] as const)('releases buffered playback when delivery changes to %s even with audio refused', (mode) => {
    const { host, core } = client(false);
    const release = vi.spyOn(multiplayerRenderPlaybackService, 'release').mockImplementation(() => undefined);
    host.channel!.onmessage?.({ data: JSON.stringify({
      kind: 'delivery', delivery: {
        generationId: 'next', trackId: 'track', mode,
        reason: mode === 'none' ? 'host-disabled' : null
      }
    }) } as MessageEvent);
    expect(release).toHaveBeenCalledOnce();
    expect(core.state.remoteDelivery.mode).toBe(mode);
    expect(core.publish).toHaveBeenCalledWith(expect.objectContaining({ audioStatus: 'refused' }));
  });

  it('prepares buffered delivery while audio is refused so enabling it can use the current generation', () => {
    const { host } = client(false);
    const start = vi.spyOn(multiplayerRenderPlaybackService, 'start').mockImplementation(() => undefined);
    const enabled = vi.spyOn(multiplayerRenderPlaybackService, 'setEnabled').mockImplementation(() => undefined);
    const buffer = vi.spyOn(multiplayerRenderPlaybackService, 'updateWindowMs').mockImplementation(() => undefined);
    host.channel!.onmessage?.({ data: JSON.stringify({
      kind: 'delivery', delivery: { generationId: 'next', trackId: 'track', mode: 'render', reason: null }
    }) } as MessageEvent);
    expect(start).toHaveBeenCalledWith('next', 'track');
    expect(enabled).toHaveBeenCalledWith(false);
    expect(buffer).toHaveBeenCalledWith(3000);
    expect(multiplayerSourcePlaybackService.clearSourceTrack).toHaveBeenCalledOnce();
  });
});
