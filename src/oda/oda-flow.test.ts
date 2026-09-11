import { describe, expect, it, vi } from 'vitest';
import type { TrackItem } from '$lib/types';
import type { OdaRoute } from '$lib/services/oda-session';
import { createOdaFocusController } from './oda-focus';
import {
  resolveOdaRouteDefaultFocusId,
  resolveOdaRouteFocusModel,
  type OdaRouteFocusContext
} from './oda-route-focus';

let sequence = 0;

function track(id: string, kind: TrackItem['kind'] = 'stream', metadata: TrackItem['metadata'] = {}): TrackItem {
  sequence += 1;
  return {
    id,
    name: `${id}.flac`,
    extension: 'flac',
    kind,
    size: 1,
    lastModified: 1,
    path: `/music/${id}.flac`,
    metadata
  };
}

const MUSIC = [track('m1'), track('m2')];

const CONTEXT: OdaRouteFocusContext = {
  musicItems: MUSIC,
  videoItems: [],
  imageItems: [],
  recentsItems: [],
  queueItems: [],
  optionCategoryIds: ['option:oda'],
  homeWaterfallSections: [
    { id: 'images', cardIds: ['browse-images'] },
    { id: 'music', cardIds: ['browse-music', 'artists'] }
  ]
};

/**
 * A small controller-level harness that mirrors OdaShell's route/focus loop
 * without a DOM. It confirms the pure navigation map chains across a
 * keyboard-only home -> browse -> playback path.
 */
function createHarness() {
  let route: OdaRoute = { name: 'home' };
  const stack: OdaRoute[] = [];
  const activations: string[] = [];
  const timers: Array<{ callback: () => void; cancelled: boolean }> = [];

  const focus = createOdaFocusController({
    getWrap: () => false,
    getRepeatInitialDelayMs: () => 400,
    getRepeatIntervalMs: () => 100,
    getHoldBack: () => ({ action: 'none', thresholdMs: 800 }),
    onFocusChange: () => {},
    schedule: (callback) => {
      timers.push({ callback, cancelled: false });
      return timers.length - 1;
    },
    cancel: (handle) => {
      if (timers[handle]) timers[handle].cancelled = true;
    }
  });

  function applyRoute(next: OdaRoute): void {
    route = next;
    focus.setModel(resolveOdaRouteFocusModel(route, CONTEXT));
    focus.setFocus(resolveOdaRouteDefaultFocusId(route, CONTEXT));
  }

  function push(next: OdaRoute): void {
    stack.push(route);
    applyRoute(next);
  }

  function back(): void {
    const previous = stack.pop();
    if (previous) applyRoute(previous);
  }

  focus.setHandlers({
    onActivate: (focusId) => {
      if (!focusId) return;
      activations.push(focusId);
    },
    onBack: back,
    onHoldBack: () => {},
    onTransport: (action) => activations.push(`transport:${action}`)
  });

  applyRoute(route);

  return {
    focus,
    activations,
    getRoute: () => route,
    push,
    key: (keyName: string) => focus.handleKeydown({ key: keyName } as KeyboardEvent)
  };
}

describe('Oda keyboard flow', () => {
  it('walks from the home waterfall into a music browse route', () => {
    const harness = createHarness();
    expect(harness.focus.getFocus()).toBe('section:images');

    harness.key('ArrowDown');
    expect(harness.focus.getFocus()).toBe('section:music');

    harness.key('ArrowRight');
    expect(harness.focus.getFocus()).toBe('card:music:browse-music');

    harness.key('Enter');
    expect(harness.activations).toContain('card:music:browse-music');
    expect(harness.getRoute().name).toBe('home');
  });

  it('drills into a browse group and returns on Back', () => {
    const harness = createHarness();
    harness.push({ name: 'browse', medium: 'music', view: 'artists' });

    const groupFocusId = harness.focus.getFocus();
    expect(groupFocusId?.startsWith('group:')).toBe(true);

    harness.push({
      name: 'browse',
      medium: 'music',
      view: 'artists',
      groupKey: groupFocusId!.slice('group:'.length)
    });
    expect(harness.focus.getFocus()).toBe('item:m1');

    harness.key('ArrowDown');
    expect(harness.focus.getFocus()).toBe('item:m2');

    // Back returns to the group list and restores the group focus.
    harness.focus.handleKeyup({ key: 'Escape' } as KeyboardEvent);
    expect(harness.getRoute()).toEqual({ name: 'browse', medium: 'music', view: 'artists' });
  });

  it('routes transport keys in a theater and moves focus across Now Playing', () => {
    const harness = createHarness();
    harness.push({ name: 'video-theater' });

    expect(harness.focus.getFocus()).toBe('th:play-pause');
    expect(harness.key('MediaPlayPause')).toBe(true);
    expect(harness.activations).toContain('transport:play-pause');

    harness.push({ name: 'now-playing' });
    expect(harness.focus.getFocus()).toBe('np:play-pause');
    harness.key('ArrowLeft');
    expect(harness.focus.getFocus()).toBe('np:previous');
  });
});
