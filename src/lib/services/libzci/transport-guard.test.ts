import { describe, expect, it } from 'vitest';
import { guardTransportCommand } from './transport-guard';

describe('transport command guard', () => {
  it('lets pause/stop/dispose through without access', () => {
    for (const kind of ['pause', 'stop', 'dispose']) {
      expect(guardTransportCommand(kind, '')).toEqual({ allowed: true, restoreFirst: false });
      expect(guardTransportCommand(kind, 'access-required: denied')).toEqual({ allowed: true, restoreFirst: false });
    }
  });

  it('plays with restore-first unless granted', () => {
    expect(guardTransportCommand('play', 'granted')).toEqual({ allowed: true, restoreFirst: false });
    const gated = guardTransportCommand('play', '');
    expect(gated.allowed).toBe(true);
    expect(gated.restoreFirst).toBe(true);
  });

  it('requires granted access for seeks and controls', () => {
    expect(guardTransportCommand('seek', 'granted')).toEqual({ allowed: true, restoreFirst: false });
    expect(guardTransportCommand('seek', '').allowed).toBe(false);
    expect(guardTransportCommand('volume', 'checking').allowed).toBe(false);
    expect(guardTransportCommand('subsong', 'granted').allowed).toBe(true);
  });
});
