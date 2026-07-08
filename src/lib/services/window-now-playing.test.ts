import { describe, expect, it } from 'vitest';
import {
  NOW_PLAYING_COMFORTABLE_WINDOW_HEIGHT,
  NOW_PLAYING_COMFORTABLE_WINDOW_WIDTH,
  resolveNowPlayingWindowBounds,
  type NowPlayingWindowGeometry
} from './window-now-playing';

const BASE_GEOMETRY: NowPlayingWindowGeometry = {
  innerWidth: 1200,
  innerHeight: 760,
  outerWidth: NOW_PLAYING_COMFORTABLE_WINDOW_WIDTH,
  outerHeight: NOW_PLAYING_COMFORTABLE_WINDOW_HEIGHT,
  screenX: 120,
  screenY: 80,
  screen: {
    width: 1920,
    height: 1080,
    availWidth: 1920,
    availHeight: 1040,
    availLeft: 0,
    availTop: 0
  }
};

describe('resolveNowPlayingWindowBounds', () => {
  it('does not resize windows that are already eligible for Now Playing', () => {
    expect(resolveNowPlayingWindowBounds(BASE_GEOMETRY)).toBeNull();
  });

  it('grows a small player window to the comfortable Now Playing window size', () => {
    expect(
      resolveNowPlayingWindowBounds({
        ...BASE_GEOMETRY,
        innerWidth: 500,
        innerHeight: 120,
        outerWidth: 516,
        outerHeight: 158
      })
    ).toEqual({
      left: 120,
      top: 80,
      width: 1280,
      height: 800
    });
  });

  it('only grows window dimensions that are below the comfortable size', () => {
    expect(
      resolveNowPlayingWindowBounds({
        ...BASE_GEOMETRY,
        innerWidth: 850,
        innerHeight: 700,
        outerWidth: 1420,
        outerHeight: 740
      })
    ).toEqual({
      left: 120,
      top: 80,
      width: 1420,
      height: 800
    });
  });

  it('clamps growth and position to the available screen area', () => {
    expect(
      resolveNowPlayingWindowBounds({
        innerWidth: 700,
        innerHeight: 600,
        outerWidth: 716,
        outerHeight: 638,
        screenX: 900,
        screenY: 300,
        screen: {
          width: 1366,
          height: 768,
          availWidth: 1366,
          availHeight: 768,
          availLeft: 0,
          availTop: 0
        }
      })
    ).toEqual({
      left: 86,
      top: 0,
      width: 1280,
      height: 768
    });
  });
});
