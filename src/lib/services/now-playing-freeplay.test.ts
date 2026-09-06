import { describe, expect, it } from 'vitest';
import { createFreeplayFloaterPlacement, getFreeplayClientIcon } from './now-playing-freeplay';

describe('Now Playing Freeplay floaters', () => {
  it('keeps stable placements in the outer edge bands', () => {
    const first = createFreeplayFloaterPlacement('client-a', 0, 42);
    expect(createFreeplayFloaterPlacement('client-a', 0, 42)).toEqual(first);
    expect(['left', 'right', 'top', 'bottom']).toContain(first.edge);
    expect(first.offsetPercent).toBeGreaterThanOrEqual(5);
    expect(first.offsetPercent).toBeLessThanOrEqual(82);
  });

  it('chooses a device-shaped icon when the platform reveals one', () => {
    expect(getFreeplayClientIcon('Android')).toBe('smartphone');
    expect(getFreeplayClientIcon('iPad')).toBe('tablet_mac');
    expect(getFreeplayClientIcon('Windows')).toBe('computer');
  });
});
