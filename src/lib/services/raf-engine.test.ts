import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rafSettings } from '$lib/stores/raf-settings';
import { playbackSettings } from '$lib/stores/playback-settings';
import type { RafGraphicEqSettings } from '$lib/types';
import { RafEngine, sameTopology } from './raf-engine';

class FakeParam {
  value = 1;
  ramps: number[] = [];
  cancelScheduledValues(): void {}
  setValueAtTime(value: number): void { this.value = value; }
  linearRampToValueAtTime(value: number): void { this.value = value; this.ramps.push(value); }
}

class FakeNode {
  connections: FakeNode[] = [];
  disconnectCalls = 0;
  connect(destination: FakeNode): FakeNode { this.connections.push(destination); return destination; }
  disconnect(): void { this.disconnectCalls += 1; }
}
class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeFilter extends FakeNode {
  type: BiquadFilterType = 'lowpass';
  frequency = new FakeParam();
  Q = new FakeParam();
  gain = new FakeParam();
}
class FakeContext {
  currentTime = 0;
  gains: FakeGain[] = [];
  filters: FakeFilter[] = [];
  createGain(): GainNode { const node = new FakeGain(); this.gains.push(node); return node as unknown as GainNode; }
  createBiquadFilter(): BiquadFilterNode { const node = new FakeFilter(); this.filters.push(node); return node as unknown as BiquadFilterNode; }
}

describe('RafEngine', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    playbackSettings.reset();
    rafSettings.reset();
  });

  afterEach(() => {
    rafSettings.reset();
    playbackSettings.reset();
    vi.useRealTimers();
  });

  it('keeps parameter updates on existing nodes and disposes replaced topology', () => {
    const context = new FakeContext();
    const engine = new RafEngine(context as unknown as BaseAudioContext);
    rafSettings.addEffect('graphic-eq');
    const effect = rafSettings.getSnapshot().effects[0] as RafGraphicEqSettings;
    const filterCount = context.filters.length;
    const oldFilters = [...context.filters];

    rafSettings.updateEffect(effect.id, (current) => ({ ...current, preampDb: 6 } as RafGraphicEqSettings));
    expect(context.filters).toHaveLength(filterCount);
    expect(context.gains.some((gain) => gain.gain.ramps.some((value) => value > 1))).toBe(true);

    rafSettings.removeEffect(effect.id);
    vi.advanceTimersByTime(30);
    expect(oldFilters.every((filter) => filter.disconnectCalls > 0)).toBe(true);
    engine.destroy();
  });

  it('treats only stable ID/type order as the same topology', () => {
    const first = [{ id: 'a', type: 'mid-side' as const, enabled: true, midGainDb: 0, sideGainDb: 0 }];
    expect(sameTopology(first, [{ ...first[0], enabled: false }])).toBe(true);
    expect(sameTopology(first, [{ ...first[0], id: 'b' }])).toBe(false);
  });

  it('keeps the Playback feature gate separate from rack power', () => {
    const context = new FakeContext();
    const engine = new RafEngine(context as unknown as BaseAudioContext);
    const dryGain = context.gains[2];

    expect(playbackSettings.getSnapshot().enableRaf).toBe(false);
    expect(dryGain.gain.ramps.at(-1)).toBe(1);

    playbackSettings.update({ enableRaf: true });
    expect(dryGain.gain.ramps.at(-1)).toBe(0);

    rafSettings.setEnabled(false);
    expect(playbackSettings.getSnapshot().enableRaf).toBe(true);
    expect(dryGain.gain.ramps.at(-1)).toBe(1);
    engine.destroy();
  });
});
