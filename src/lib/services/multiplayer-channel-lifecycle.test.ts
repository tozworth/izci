import { describe, expect, it, vi } from 'vitest';
import { attachClientChannel } from './multiplayer-client-channels';
import { attachHostChannel } from './multiplayer-host-channels';
import type { MultiplayerClientContext } from './multiplayer-client';
import type { MultiplayerHostContext } from './multiplayer-host';
import type { PeerConnection } from './multiplayer-types';

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
      hostPeers: new Map([['client', previous]])
    };
    const ctx = {
      core,
      updateClient,
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

  it('ignores client messages from a replaced host peer', () => {
    const previous = peer('host');
    const replacement = peer('host');
    const applyClientAudioBuffer = vi.fn();
    const core = {
      clientPeer: previous,
      hostAudioBufferMs: null
    };
    const ctx = {
      core,
      applyClientAudioBuffer
    } as unknown as MultiplayerClientContext;
    const channel = previous.channel!;
    attachClientChannel(ctx, previous);
    core.clientPeer = replacement;

    channel.onmessage?.({
      data: JSON.stringify({ kind: 'buffer', bufferMs: 750 })
    } as MessageEvent);

    expect(core.hostAudioBufferMs).toBeNull();
    expect(applyClientAudioBuffer).not.toHaveBeenCalled();
  });
});
