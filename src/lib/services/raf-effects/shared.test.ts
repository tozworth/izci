import { describe, expect, it } from 'vitest';
import { setAudioParam } from './shared';

class FakeParam {
  value = 0.5;
  cancelAndHoldCalls = 0;
  cancelledAt: number[] = [];
  values: Array<{ value: number; time: number }> = [];
  ramps: Array<{ value: number; time: number }> = [];

  cancelAndHoldAtTime(): void {
    this.cancelAndHoldCalls += 1;
  }

  cancelScheduledValues(time: number): void {
    this.cancelledAt.push(time);
  }

  setValueAtTime(value: number, time: number): void {
    this.value = value;
    this.values.push({ value, time });
  }

  linearRampToValueAtTime(value: number, time: number): void {
    this.value = value;
    this.ramps.push({ value, time });
  }
}

describe('setAudioParam', () => {
  it('anchors the current value without using cancelAndHoldAtTime', () => {
    const parameter = new FakeParam();

    setAudioParam(
      parameter as unknown as AudioParam,
      1,
      { currentTime: 2 } as BaseAudioContext,
      0.02
    );

    expect(parameter.cancelAndHoldCalls).toBe(0);
    expect(parameter.cancelledAt).toEqual([2]);
    expect(parameter.values).toEqual([{ value: 0.5, time: 2 }]);
    expect(parameter.ramps).toEqual([{ value: 1, time: 2.02 }]);
  });

  it('recovers a non-finite current parameter value from the finite target', () => {
    const parameter = new FakeParam();
    parameter.value = Number.NaN;

    setAudioParam(parameter as unknown as AudioParam, 0.75, { currentTime: 3 } as BaseAudioContext);

    expect(parameter.values).toEqual([{ value: 0.75, time: 3 }]);
    expect(parameter.ramps).toEqual([{ value: 0.75, time: 3.015 }]);
  });
});
