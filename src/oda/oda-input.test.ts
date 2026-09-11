import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createOdaKeyRepeater,
  isOdaEditableTarget,
  isOdaRepeatableAction,
  normalizeOdaAction,
  shouldIgnoreOdaRepeat
} from './oda-input';

describe('normalizeOdaAction', () => {
  it('normalizes directional and activation keys', () => {
    expect(normalizeOdaAction({ key: 'ArrowUp' })).toBe('up');
    expect(normalizeOdaAction({ key: 'ArrowDown' })).toBe('down');
    expect(normalizeOdaAction({ key: 'ArrowLeft' })).toBe('left');
    expect(normalizeOdaAction({ key: 'ArrowRight' })).toBe('right');
    expect(normalizeOdaAction({ key: 'Enter' })).toBe('ok');
    expect(normalizeOdaAction({ key: ' ' })).toBe('ok');
    expect(normalizeOdaAction({ key: 'Escape' })).toBe('back');
    expect(normalizeOdaAction({ key: 'Backspace' })).toBe('back');
    expect(normalizeOdaAction({ key: 'BrowserBack' })).toBe('back');
  });

  it('normalizes media/remote aliases', () => {
    expect(normalizeOdaAction({ key: 'MediaPlayPause' })).toBe('play-pause');
    expect(normalizeOdaAction({ key: 'MediaStop' })).toBe('stop');
    expect(normalizeOdaAction({ key: 'MediaTrackPrevious' })).toBe('previous');
    expect(normalizeOdaAction({ key: 'TrackNext' })).toBe('next');
  });

  it('ignores unhandled keys', () => {
    expect(normalizeOdaAction({ key: 'a' })).toBeNull();
    expect(normalizeOdaAction({ key: 'F5' })).toBeNull();
  });
});

describe('Oda repeat rules', () => {
  it('ignores non-element targets for editable checks', () => {
    expect(isOdaEditableTarget(null)).toBe(false);
  });

  it('repeats only directional actions', () => {
    expect(isOdaRepeatableAction('left')).toBe(true);
    expect(isOdaRepeatableAction('right')).toBe(true);
    expect(isOdaRepeatableAction('up')).toBe(true);
    expect(isOdaRepeatableAction('down')).toBe(true);
    expect(isOdaRepeatableAction('ok')).toBe(false);
    expect(isOdaRepeatableAction('back')).toBe(false);
  });

  it('ignores repeat for activation/back actions', () => {
    expect(shouldIgnoreOdaRepeat('ok')).toBe(true);
    expect(shouldIgnoreOdaRepeat('back')).toBe(true);
    expect(shouldIgnoreOdaRepeat('play-pause')).toBe(true);
    expect(shouldIgnoreOdaRepeat('left')).toBe(false);
  });
});

describe('createOdaKeyRepeater', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createRepeater(initialDelay = 400, interval = 100) {
    const repeated = vi.fn();
    const repeater = createOdaKeyRepeater({
      getInitialDelayMs: () => initialDelay,
      getIntervalMs: () => interval,
      onRepeat: repeated
    });
    return { repeater, repeated };
  }

  it('performs immediately on first press, then after the initial delay', () => {
    const { repeater, repeated } = createRepeater();
    expect(repeater.begin({ key: 'ArrowRight' }, 'right')).toBe(true);
    expect(repeated).not.toHaveBeenCalled();

    vi.advanceTimersByTime(399);
    expect(repeated).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(repeated).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(repeated).toHaveBeenCalledTimes(2);
  });

  it('ignores OS repeat events', () => {
    const { repeater, repeated } = createRepeater();
    expect(repeater.begin({ key: 'ArrowRight', repeat: true }, 'right')).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(repeated).not.toHaveBeenCalled();
  });

  it('stops repeating after end()', () => {
    const { repeater, repeated } = createRepeater();
    repeater.begin({ key: 'ArrowDown' }, 'down');
    vi.advanceTimersByTime(500);
    expect(repeated).toHaveBeenCalledTimes(2);

    repeater.end();
    expect(repeater.isHolding()).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(repeated).toHaveBeenCalledTimes(2);
  });

  it('restarts the delay when the direction changes', () => {
    const { repeater, repeated } = createRepeater();
    repeater.begin({ key: 'ArrowUp' }, 'up');
    vi.advanceTimersByTime(300);
    repeater.begin({ key: 'ArrowRight' }, 'right');
    vi.advanceTimersByTime(399);
    expect(repeated).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(repeated).toHaveBeenCalledTimes(1);
  });

  it('never starts for non-repeatable actions', () => {
    const { repeater, repeated } = createRepeater();
    expect(repeater.begin({ key: 'Enter' }, 'ok')).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(repeated).not.toHaveBeenCalled();
    expect(repeater.isHolding()).toBe(false);
  });
});
