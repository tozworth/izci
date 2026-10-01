import { get } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { createPatternChannelControls } from './pattern-channel-controls';

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
    expect(get(controls.state)).toEqual({ trackId: null, channels: [] });
  });
});
