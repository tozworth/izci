import { writable } from 'svelte/store';

export interface PatternChannelState {
  muted: boolean;
  solo: boolean;
  effectiveMuted: boolean;
}

export interface PatternChannelSnapshot {
  trackId: string | null;
  channels: PatternChannelState[];
}

export function createPatternChannelControls(applyMute: (muted: boolean[]) => void) {
  let current: PatternChannelSnapshot = { trackId: null, channels: [] };
  const state = writable(current);

  function publish(): void {
    const hasSolo = current.channels.some((channel) => channel.solo);
    current = {
      ...current,
      channels: current.channels.map((channel) => ({
        ...channel,
        effectiveMuted: channel.muted || (hasSolo && !channel.solo)
      }))
    };
    applyMute(current.channels.map((channel) => channel.effectiveMuted));
    state.set(current);
  }

  function toggle(trackId: string, index: number, control: 'muted' | 'solo'): void {
    if (trackId !== current.trackId || !Number.isInteger(index) || !current.channels[index]) return;
    current.channels = current.channels.map((channel, channelIndex) => {
      if (channelIndex !== index) return channel;
      const enabled = !channel[control];
      return {
        ...channel,
        [control]: enabled,
        ...(enabled ? { [control === 'muted' ? 'solo' : 'muted']: false } : {})
      };
    });
    publish();
  }

  return {
    state: { subscribe: state.subscribe },
    setTrack(trackId: string | null, count = 0): void {
      const channelCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
      if (current.trackId === trackId && current.channels.length === channelCount) return;
      const previous = current.trackId === trackId ? current.channels : [];
      current = {
        trackId,
        channels: Array.from({ length: channelCount }, (_, index) => previous[index]
          ?? { muted: false, solo: false, effectiveMuted: false })
      };
      publish();
    },
    toggleMute: (trackId: string, index: number) => toggle(trackId, index, 'muted'),
    toggleSolo: (trackId: string, index: number) => toggle(trackId, index, 'solo'),
    reset(trackId: string): void {
      if (trackId !== current.trackId) return;
      current.channels = current.channels.map(() => ({ muted: false, solo: false, effectiveMuted: false }));
      publish();
    }
  };
}
