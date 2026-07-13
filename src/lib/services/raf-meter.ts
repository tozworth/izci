import { readable } from 'svelte/store';

export interface RafMeterSnapshot {
  inputDb: number;
  outputDb: number;
  clipping: boolean;
}

const CHANNEL_NAME = 'izci-raf-meter';
const SILENCE_DB = -60;
const CLIP_THRESHOLD_DB = 0;
const CLIP_HOLD_MS = 1500;
const DEFAULT_SNAPSHOT: RafMeterSnapshot = { inputDb: SILENCE_DB, outputDb: SILENCE_DB, clipping: false };

let channel: BroadcastChannel | null = null;
let lastClipAt = 0;

function getChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

export const rafMeter = readable<RafMeterSnapshot>(DEFAULT_SNAPSHOT, (set) => {
  const meterChannel = getChannel();
  if (!meterChannel) return;
  const receive = (event: MessageEvent<RafMeterSnapshot>) => set(event.data);
  meterChannel.addEventListener('message', receive);
  return () => meterChannel.removeEventListener('message', receive);
});

export function publishRafMeter(inputDb: number, outputDb: number): void {
  const now = Date.now();
  if (outputDb >= CLIP_THRESHOLD_DB) lastClipAt = now;
  const snapshot = {
    inputDb: Math.max(SILENCE_DB, inputDb),
    outputDb: Math.max(SILENCE_DB, outputDb),
    clipping: now - lastClipAt < CLIP_HOLD_MS
  };
  getChannel()?.postMessage(snapshot);
}
