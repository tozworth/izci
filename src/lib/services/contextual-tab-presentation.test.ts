import { describe, expect, it, vi } from 'vitest';
import {
  createContextualTabPresentationController,
  resolvePatternTabAvailability
} from './contextual-tab-presentation';
import type { ModulePatternSnapshot, PlaylistItem } from '$lib/types';

const moduleTrack = { id: 'module', kind: 'module' } as PlaylistItem;
const streamTrack = { id: 'stream', kind: 'stream' } as PlaylistItem;
const emptyPatternSnapshot: ModulePatternSnapshot = {
  trackId: null,
  song: null,
  order: 0,
  pattern: 0,
  row: 0
};

describe('contextual tab presentation', () => {
  it('makes Patterns available only after the playing module exposes pattern data', () => {
    expect(resolvePatternTabAvailability(streamTrack, emptyPatternSnapshot, 'playing')).toBe(
      'unavailable'
    );
    expect(resolvePatternTabAvailability(moduleTrack, emptyPatternSnapshot, 'loading')).toBe(
      'loading'
    );
    expect(
      resolvePatternTabAvailability(
        moduleTrack,
        {
          ...emptyPatternSnapshot,
          trackId: moduleTrack.id,
          song: {
            channels: [],
            instruments: [],
            samples: [],
            orders: [],
            patterns: [{ name: '00', rows: [] }],
            numSubsongs: 1
          }
        },
        'playing'
      )
    ).toBe('available');
  });

  it('leaves a manually managed tab unchanged', () => {
    const show = vi.fn();
    const close = vi.fn();
    const controller = createContextualTabPresentationController({
      isVisible: () => true,
      show,
      close
    });

    controller.sync({ key: 'track', availability: 'available', automation: 'manual' });
    controller.sync({ key: 'track', availability: 'unavailable', automation: 'manual' });

    expect(show).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('opens once per availability transition without overriding a manual close', () => {
    const show = vi.fn();
    const controller = createContextualTabPresentationController({
      isVisible: () => false,
      show,
      close: vi.fn()
    });

    const input = { key: 'module', availability: 'available' as const, automation: 'open' as const };
    controller.sync(input);
    controller.sync(input);

    expect(show).toHaveBeenCalledTimes(1);
  });

  it('waits through loading and closes only in open-and-close mode', () => {
    const close = vi.fn();
    const controller = createContextualTabPresentationController({
      isVisible: () => true,
      show: vi.fn(),
      close
    });

    controller.sync({ key: 'module', availability: 'loading', automation: 'open-close' });
    controller.sync({ key: 'stream', availability: 'unavailable', automation: 'open' });
    controller.sync({ key: 'stream', availability: 'unavailable', automation: 'open-close' });

    expect(close).toHaveBeenCalledTimes(1);
  });
});
