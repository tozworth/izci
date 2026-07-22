import { readable } from 'svelte/store';

export type RafAutoAmpGainSnapshot = Record<string, number>;

interface AutoAmpGainMessage {
  id: string;
  gainDb: number | null;
}

const CHANNEL_NAME = 'izci-raf-auto-amp-meter';
let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

export const rafAutoAmpGains = readable<RafAutoAmpGainSnapshot>({}, (set) => {
  const meterChannel = getChannel();
  if (!meterChannel) return;
  let snapshot: RafAutoAmpGainSnapshot = {};
  const receive = (event: MessageEvent<AutoAmpGainMessage>) => {
    const { id, gainDb } = event.data;
    if (typeof id !== 'string' || (gainDb !== null && !Number.isFinite(gainDb))) return;
    if (gainDb === null) {
      const { [id]: _removed, ...remaining } = snapshot;
      snapshot = remaining;
    } else {
      snapshot = { ...snapshot, [id]: gainDb };
    }
    set(snapshot);
  };
  meterChannel.addEventListener('message', receive);
  return () => meterChannel.removeEventListener('message', receive);
});

export function publishRafAutoAmpGain(id: string, gainDb: number | null): void {
  getChannel()?.postMessage({ id, gainDb } satisfies AutoAmpGainMessage);
}
