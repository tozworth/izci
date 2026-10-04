import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { createPatternChannelControls } from './pattern-channel-controls';
import { createPatternChannelMemory } from '$lib/stores/pattern-channel-memory';

describe('pattern channel controls', () => {
  function setup() {
    const apply = vi.fn();
    const controls = createPatternChannelControls(apply);
    controls.setTrack('track', 4);
    return { controls, apply };
  }

  it('combines solos and restores manual mutes when the last solo is cleared', () => {
    const { controls, apply } = setup();
    controls.toggleMute('track', 3);
    controls.toggleSolo('track', 0);
    expect(apply).toHaveBeenLastCalledWith([false, true, true, true]);
    controls.toggleSolo('track', 1);
    expect(apply).toHaveBeenLastCalledWith([false, false, true, true]);
    controls.toggleSolo('track', 0);
    expect(apply).toHaveBeenLastCalledWith([true, false, true, true]);
    controls.toggleSolo('track', 1);
    expect(apply).toHaveBeenLastCalledWith([false, false, false, true]);
  });

  it('makes mute and solo mutually exclusive on each channel', () => {
    const { controls, apply } = setup();
    controls.toggleMute('track', 0);
    controls.toggleSolo('track', 0);
    expect(get(controls.state).channels[0]).toEqual({ muted: false, solo: true, effectiveMuted: false });
    controls.toggleMute('track', 0);
    expect(apply).toHaveBeenLastCalledWith([true, false, false, false]);
    expect(get(controls.state).channels[0].solo).toBe(false);
  });

  it('ignores stale tracks and invalid channels and resets all controls together', () => {
    const { controls, apply } = setup();
    controls.toggleMute('track', 2);
    const calls = apply.mock.calls.length;
    controls.toggleSolo('stale-track', 0);
    for (const index of [-1, 4, 0.5, NaN, Infinity]) controls.toggleMute('track', index);
    controls.reset('stale-track');
    expect(apply).toHaveBeenCalledTimes(calls);
    controls.reset('track');
    expect(apply).toHaveBeenLastCalledWith([false, false, false, false]);
  });

  it('retains choices through metadata refresh but clears them on a new load', () => {
    const { controls, apply } = setup();
    controls.toggleSolo('track', 1);
    const calls = apply.mock.calls.length;
    controls.setTrack('track', 4);
    expect(apply).toHaveBeenCalledTimes(calls);
    controls.setTrack('next-track', 4);
    expect(apply).toHaveBeenLastCalledWith([false, false, false, false]);
    controls.setTrack(null);
    expect(get(controls.state)).toEqual({ trackId: null, channels: [], remembered: false });
  });

  it('remembers explicit mute/solo choices across entries and saves subsequent edits and resets', () => {
    const memory = createPatternChannelMemory();
    const apply = vi.fn();
    const controls = createPatternChannelControls(apply, memory);
    controls.setTrack('queue-entry', 4, 'file:module');
    controls.toggleMute('queue-entry', 3);
    controls.toggleSolo('queue-entry', 1);
    expect(memory.getSnapshot()).toEqual({});
    controls.toggleRemember('queue-entry');
    expect(memory.getSnapshot()['file:module']).toEqual([
      { muted: false, solo: false }, { muted: false, solo: true },
      { muted: false, solo: false }, { muted: true, solo: false }
    ]);
    controls.setTrack('other', 4, 'file:other');
    expect(apply).toHaveBeenLastCalledWith([false, false, false, false]);
    controls.setTrack('library-entry', 4, 'file:module');
    expect(get(controls.state).remembered).toBe(true);
    expect(apply).toHaveBeenLastCalledWith([true, false, true, true]);
    controls.toggleSolo('library-entry', 1);
    expect(apply).toHaveBeenLastCalledWith([false, false, false, true]);
    controls.setTrack(null);
    controls.setTrack('reopened', 4, 'file:module');
    expect(apply).toHaveBeenLastCalledWith([false, false, false, true]);
    controls.reset('reopened');
    controls.setTrack(null);
    controls.setTrack('reopened', 4, 'file:module');
    expect(get(controls.state).remembered).toBe(true);
    expect(apply).toHaveBeenLastCalledWith([false, false, false, false]);
    controls.destroy();
  });

  it('forgetting preserves current controls but prevents restoring them on the next load', () => {
    const memory = createPatternChannelMemory();
    const apply = vi.fn();
    const controls = createPatternChannelControls(apply, memory);
    controls.setTrack('track', 2, 'file:module');
    controls.toggleSolo('track', 1);
    controls.toggleRemember('stale');
    expect(memory.getSnapshot()).toEqual({});
    controls.toggleRemember('track');
    controls.toggleRemember('track');
    expect(memory.getSnapshot()).toEqual({});
    expect(get(controls.state).remembered).toBe(false);
    expect(apply).toHaveBeenLastCalledWith([true, false]);
    controls.setTrack(null);
    controls.setTrack('track', 2, 'file:module');
    expect(apply).toHaveBeenLastCalledWith([false, false]);
    controls.destroy();
  });

  it('restores available channels without shifting indices when the channel count changes', () => {
    const memory = createPatternChannelMemory();
    memory.set({ module: [{ muted: true, solo: false }, { muted: false, solo: true }] });
    const apply = vi.fn();
    const controls = createPatternChannelControls(apply, memory);
    controls.setTrack('track', 4, 'module');
    expect(apply).toHaveBeenLastCalledWith([true, false, true, true]);
    controls.setTrack(null);
    controls.setTrack('track', 1, 'module');
    expect(apply).toHaveBeenLastCalledWith([true]);
    controls.destroy();
  });
});
