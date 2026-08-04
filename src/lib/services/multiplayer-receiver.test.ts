import { describe, expect, it } from 'vitest';
import { setMultiplayerReceiverBuffer } from './multiplayer-receiver';

describe('multiplayer receiver buffering', () => {
  it('sets the standardized jitter buffer target in milliseconds', () => {
    const receiver = { jitterBufferTarget: null } as unknown as RTCRtpReceiver;

    expect(setMultiplayerReceiverBuffer(receiver, 750)).toBe(true);
    expect(receiver.jitterBufferTarget).toBe(750);
  });

  it('bounds the native target to the WebRTC maximum', () => {
    const receiver = { jitterBufferTarget: null } as unknown as RTCRtpReceiver;

    setMultiplayerReceiverBuffer(receiver, 9_000);
    expect(receiver.jitterBufferTarget).toBe(4_000);
  });

  it('falls back to the legacy Chromium hint in seconds', () => {
    const receiver = { playoutDelayHint: null } as unknown as RTCRtpReceiver;

    expect(setMultiplayerReceiverBuffer(receiver, 1_250)).toBe(true);
    expect((receiver as unknown as { playoutDelayHint: number }).playoutDelayHint).toBe(1.25);
  });
});
