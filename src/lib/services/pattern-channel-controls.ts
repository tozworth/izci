import { writable } from 'svelte/store';
import type { PatternChannelMemory, RememberedPatternChannel } from '$lib/stores/pattern-channel-memory';

export interface PatternChannelState {
  muted: boolean;
  solo: boolean;
  effectiveMuted: boolean;
}

export interface PatternChannelSnapshot {
  trackId: string | null;
  channels: PatternChannelState[];
  remembered: boolean;
}

interface ChannelMemoryStore {
  getSnapshot(): PatternChannelMemory;
  update(updater: (value: PatternChannelMemory) => PatternChannelMemory): unknown;
  subscribe(listener: (value: PatternChannelMemory) => void): () => void;
}

export function createPatternChannelControls(
  applyMute: (muted: boolean[]) => void,
  memory?: ChannelMemoryStore
) {
  let fileKey: string | null = null;
  let current: PatternChannelSnapshot = { trackId: null, channels: [], remembered: false };
  const state = writable(current);

  function restoreChannels(saved: RememberedPatternChannel[], count: number): PatternChannelState[] {
    return Array.from({ length: count }, (_, index) => ({
      muted: saved[index]?.muted ?? false,
      solo: saved[index]?.solo ?? false,
      effectiveMuted: false
    }));
  }

  function save(): void {
    if (!memory || !fileKey || !current.remembered) return;
    const key = fileKey;
    memory.update((value) => ({
      ...value,
      [key]: current.channels.map(({ muted, solo }) => ({ muted, solo }))
    }));
  }

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
    save();
  }

  const unsubscribe = memory?.subscribe((value) => {
    if (!fileKey) return;
    const saved = value[fileKey];
    const remembered = saved !== undefined;
    const changed = saved && current.channels.some((channel, index) =>
      channel.muted !== (saved[index]?.muted ?? false) || channel.solo !== (saved[index]?.solo ?? false));
    if (current.remembered === remembered && !changed) return;
    current = {
      ...current,
      remembered,
      channels: saved ? restoreChannels(saved, current.channels.length) : current.channels
    };
    publish();
  });

  return {
    state: { subscribe: state.subscribe },
    setTrack(trackId: string | null, count = 0, nextFileKey: string | null = null): void {
      const channelCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
      if (current.trackId === trackId && fileKey === nextFileKey && current.channels.length === channelCount) return;
      const previous = current.trackId === trackId && fileKey === nextFileKey ? current.channels : null;
      fileKey = trackId ? nextFileKey : null;
      const saved = fileKey ? memory?.getSnapshot()[fileKey] : undefined;
      current = {
        trackId,
        remembered: saved !== undefined,
        channels: restoreChannels(previous ?? saved ?? [], channelCount)
      };
      publish();
    },
    toggleRemember(trackId: string): void {
      if (trackId !== current.trackId || !memory || !fileKey) return;
      current = { ...current, remembered: !current.remembered };
      if (current.remembered) save();
      else {
        const key = fileKey;
        memory.update((value) => {
          const next = { ...value };
          delete next[key];
          return next;
        });
      }
      state.set(current);
    },
    toggleMute: (trackId: string, index: number) => toggle(trackId, index, 'muted'),
    toggleSolo: (trackId: string, index: number) => toggle(trackId, index, 'solo'),
    reset(trackId: string): void {
      if (trackId !== current.trackId) return;
      current.channels = current.channels.map(() => ({ muted: false, solo: false, effectiveMuted: false }));
      publish();
      save();
    },
    destroy: () => unsubscribe?.()
  };
}
