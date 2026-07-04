import { describe, expect, it } from 'vitest';
import { detectWindowDisplayState, type WindowGeometry } from './window-display-state';

const BASE_GEOMETRY: WindowGeometry = {
  outerWidth: 1000,
  outerHeight: 700,
  screenX: 200,
  screenY: 120,
  screen: {
    width: 1920,
    height: 1080,
    availWidth: 1920,
    availHeight: 1040,
    availLeft: 0,
    availTop: 0
  },
  fullscreenElement: false,
  fullscreenDisplayMode: false
};

function geometry(patch: Partial<WindowGeometry>): WindowGeometry {
  return {
    ...BASE_GEOMETRY,
    ...patch,
    screen: {
      ...BASE_GEOMETRY.screen,
      ...patch.screen
    }
  };
}

describe('detectWindowDisplayState', () => {
  it('detects maximized windows from available work-area bounds', () => {
    const state = detectWindowDisplayState(
      geometry({
        outerWidth: 1928,
        outerHeight: 1048,
        screenX: -8,
        screenY: -8
      })
    );

    expect(state.maximized).toBe(true);
    expect(state.fullscreen).toBe(false);
    expect(state.prefersNowPlaying).toBe(true);
  });

  it('detects fullscreen from browser fullscreen state', () => {
    const state = detectWindowDisplayState(
      geometry({
        fullscreenElement: true
      })
    );

    expect(state.maximized).toBe(false);
    expect(state.fullscreen).toBe(true);
    expect(state.prefersNowPlaying).toBe(true);
  });

  it('detects fullscreen from full screen geometry', () => {
    const state = detectWindowDisplayState(
      geometry({
        outerWidth: 1920,
        outerHeight: 1080,
        screenX: 0,
        screenY: 0
      })
    );

    expect(state.fullscreen).toBe(true);
    expect(state.prefersNowPlaying).toBe(true);
  });

  it('leaves ordinary windows inactive', () => {
    expect(detectWindowDisplayState(BASE_GEOMETRY)).toEqual({
      maximized: false,
      fullscreen: false,
      prefersNowPlaying: false
    });
  });
});
