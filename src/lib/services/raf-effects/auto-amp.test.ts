import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RafAutoAmpMode, RafAutoAmpSettings } from '$lib/contracts/raf';
import { FakeContext, FakeParam } from './test-audio-context';
import {
  AutoAmpController,
  clampAutoGain,
  createAutoAmpNode,
  disposeAutoAmpNode,
  peakDecibels,
  updateAutoAmpNode
} from './auto-amp';

afterEach(() => vi.useRealTimers());

function settings(mode: RafAutoAmpMode, changes: Partial<RafAutoAmpSettings> = {}): RafAutoAmpSettings {
  return {
    id: 'amp',
    type: 'auto-amp',
    enabled: true,
    gainDb: 0,
    mode,
    targetDb: -1,
    maximumReductionDb: 24,
    maximumBoostDb: 18,
    peakHoldSeconds: 2,
    recoveryDbPerSecond: 2,
    lookaheadMs: 150,
    ...changes
  };
}

describe('AutoAmpController', () => {
  it('uses the persisted gain while automatic movement is off', () => {
    const controller = new AutoAmpController(settings('off', { gainDb: 4.5 }));
    expect(controller.processPeak(0, 1)).toBe(4.5);
    expect(controller.updateSettings(settings('off', { gainDb: -3 }))).toBe(-3);
  });

  it('keeps reduce and increase modes on their allowed side of unity', () => {
    const reduce = new AutoAmpController(settings('reduce'));
    expect(reduce.processPeak(0, 0.1)).toBe(-1);

    const reduceQuiet = new AutoAmpController(settings('reduce'));
    expect(reduceQuiet.processPeak(-20, 10)).toBe(0);

    const increase = new AutoAmpController(settings('increase'));
    expect(increase.processPeak(0, 0.1)).toBe(0);
    expect(increase.processPeak(-12, 10)).toBe(11);
  });

  it('cuts immediately but raises gain at the configured recovery rate', () => {
    const controller = new AutoAmpController(settings('dynamic', { peakHoldSeconds: 0, recoveryDbPerSecond: 2 }));
    expect(controller.processPeak(-20, 0.1)).toBeCloseTo(0.2);
    expect(controller.processPeak(-20, 0.5)).toBeCloseTo(1.2);
    expect(controller.processPeak(-0.25, 0.1)).toBeCloseTo(-0.75);
  });

  it('holds a recent peak before recovering toward quieter material', () => {
    const controller = new AutoAmpController(settings('dynamic', { peakHoldSeconds: 1, recoveryDbPerSecond: 2 }));
    expect(controller.processPeak(-1, 0.1)).toBe(0);
    expect(controller.processPeak(-15, 1)).toBe(0);
    expect(controller.processPeak(-15, 1)).toBeCloseTo(2);
  });

  it('ignores silence and honors configured automatic limits', () => {
    const controller = new AutoAmpController(settings('dynamic', {
      maximumReductionDb: 3,
      maximumBoostDb: 4,
      recoveryDbPerSecond: 12
    }));
    expect(controller.processPeak(-60, 1)).toBe(0);
    expect(controller.processPeak(-30, 1)).toBe(4);
    expect(controller.processPeak(6, 1)).toBe(-3);
    expect(clampAutoGain(10, settings('reduce'))).toBe(0);
    expect(clampAutoGain(-10, settings('increase'))).toBe(0);
  });
});

describe('peakDecibels', () => {
  it('reports the absolute sample peak', () => {
    expect(peakDecibels(new Float32Array([0.25, -0.5, 0.1]))).toBeCloseTo(-6.0206, 3);
    expect(peakDecibels(new Float32Array(4))).toBe(-Infinity);
  });
});

describe('Auto Amp node lifecycle', () => {
  it('does not run an analyser timer until an automatic mode is active', () => {
    vi.useFakeTimers();
    const context = new FakeContext();
    const manual = settings('off');
    const node = createAutoAmpNode(context as unknown as BaseAudioContext, manual);
    expect(node.timer).toBeNull();
    expect(node.directGain.gain.value).toBe(1);
    expect(node.delayedGain.gain.value).toBe(0);
    expect(node.delay.delayTime.value).toBeCloseTo(0.15);

    const automatic = { ...manual, mode: 'dynamic' as const };
    updateAutoAmpNode(node, automatic, context as unknown as BaseAudioContext, manual);
    expect(node.timer).not.toBeNull();
    expect((node.directGain.gain as unknown as FakeParam).ramps.at(-1)).toBe(0);
    expect((node.delayedGain.gain as unknown as FakeParam).ramps.at(-1)).toBe(1);

    updateAutoAmpNode(node, manual, context as unknown as BaseAudioContext, automatic);
    expect(node.timer).toBeNull();
    expect((node.directGain.gain as unknown as FakeParam).ramps.at(-1)).toBe(1);
    expect((node.delayedGain.gain as unknown as FakeParam).ramps.at(-1)).toBe(0);
    disposeAutoAmpNode(node);
  });

  it('updates the automatic lookahead without rebuilding the node', () => {
    vi.useFakeTimers();
    const context = new FakeContext();
    const initial = settings('dynamic');
    const node = createAutoAmpNode(context as unknown as BaseAudioContext, initial);
    const updated = { ...initial, lookaheadMs: 240 };

    updateAutoAmpNode(node, updated, context as unknown as BaseAudioContext, initial);

    expect((node.delay.delayTime as unknown as FakeParam).ramps.at(-1)).toBeCloseTo(0.24);
    disposeAutoAmpNode(node);
  });

  it('drops a quiet-section boost on the first analysis tick after a sudden peak', () => {
    vi.useFakeTimers();
    const context = new FakeContext();
    const automatic = settings('dynamic', { peakHoldSeconds: 0, recoveryDbPerSecond: 2 });
    const node = createAutoAmpNode(context as unknown as BaseAudioContext, automatic);
    context.analysers[0].sampleValue = 0.1;
    vi.advanceTimersByTime(5_000);
    expect(node.controller.gainDb).toBeGreaterThan(9);

    context.analysers[0].sampleValue = 1;
    vi.advanceTimersByTime(25);

    expect(node.controller.gainDb).toBe(-1);
    const gainParameter = node.gain.gain as unknown as FakeParam;
    expect(gainParameter.ramps.at(-1)).toBeCloseTo(10 ** (-1 / 20));
    expect(gainParameter.rampTimes.at(-1)).toBeCloseTo(context.currentTime + 0.11);
    expect(node.delay.delayTime.value).toBeCloseTo(0.15);
    disposeAutoAmpNode(node);
  });
});
