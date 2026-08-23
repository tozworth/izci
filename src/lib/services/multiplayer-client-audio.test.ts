import { describe, expect, it, vi } from 'vitest';
import type { MultiplayerClientContext } from './multiplayer-client';
import type { PeerConnection } from './multiplayer-types';

const audio = vi.hoisted(() => ({ setRemoteAudible: vi.fn() }));

vi.mock('./multiplayer-audio', () => ({ multiplayerAudioService: audio }));
vi.mock('./multiplayer-render-playback', () => ({
  multiplayerRenderPlaybackService: { ingest: vi.fn() }
}));
vi.mock('./multiplayer-source-playback', () => ({
  multiplayerSourcePlaybackService: { clearLoadedFile: vi.fn() }
}));

import { attachClientMediaChannel } from './multiplayer-client-audio';

describe('multiplayer source-file channel generations', () => {
  it('drops stale source frames without muting or retaining their file', () => {
    const channel = { binaryType: 'blob' } as unknown as RTCDataChannel;
    const peer = {
      mediaChannel: channel,
      pc: { connectionState: 'connected' }
    } as unknown as PeerConnection;
    const core = {
      clientPeer: peer,
      pendingClientSourceFile: null,
      state: { receiveAudio: true }
    };
    const ctx = {
      core,
      publish: vi.fn(),
      transition: { isCurrent: vi.fn(() => false) },
      requestSourceRetry: vi.fn()
    } as unknown as MultiplayerClientContext;
    attachClientMediaChannel(ctx, peer);

    channel.onmessage?.({
      data: JSON.stringify({
        kind: 'file.begin',
        transferId: 'stale-transfer',
        generationId: 'stale-generation',
        trackId: 'stale-track',
        name: 'stale.flac',
        type: 'audio/flac',
        size: 3,
        lastModified: 1
      })
    } as MessageEvent);
    channel.onmessage?.({ data: new Uint8Array([1, 2, 3]).buffer } as MessageEvent);
    channel.onmessage?.({
      data: JSON.stringify({ kind: 'file.end', transferId: 'stale-transfer' })
    } as MessageEvent);

    expect(audio.setRemoteAudible).not.toHaveBeenCalled();
    expect(core.pendingClientSourceFile).toBeNull();
    expect(ctx.publish).not.toHaveBeenCalled();
    expect(ctx.requestSourceRetry).not.toHaveBeenCalled();
  });
});
