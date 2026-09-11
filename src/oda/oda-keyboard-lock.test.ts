import { afterEach, describe, expect, it, vi } from 'vitest';
import { lockOdaEscapeKey, unlockOdaEscapeKey } from './oda-keyboard-lock';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('oda-keyboard-lock', () => {
  it('no-ops without DOM APIs', () => {
    expect(() => {
      lockOdaEscapeKey();
      unlockOdaEscapeKey();
    }).not.toThrow();
  });

  it('locks Escape only while fullscreen', () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('document', { fullscreenElement: {} });
    vi.stubGlobal('navigator', { keyboard: { lock } });

    lockOdaEscapeKey();
    expect(lock).toHaveBeenCalledWith(['Escape']);
  });

  it('skips the lock when not fullscreen', () => {
    const lock = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('document', { fullscreenElement: null });
    vi.stubGlobal('navigator', { keyboard: { lock } });

    lockOdaEscapeKey();
    expect(lock).not.toHaveBeenCalled();
  });

  it('skips the lock without the Keyboard Lock API', () => {
    vi.stubGlobal('document', { fullscreenElement: {} });
    vi.stubGlobal('navigator', {});

    expect(() => lockOdaEscapeKey()).not.toThrow();
  });

  it('unlocks best-effort', () => {
    const unlock = vi.fn();
    vi.stubGlobal('navigator', { keyboard: { unlock } });

    unlockOdaEscapeKey();
    expect(unlock).toHaveBeenCalledTimes(1);
  });
});
