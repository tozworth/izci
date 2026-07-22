import { describe, expect, it } from 'vitest';
import {
  VIDEO_WINDOW_HEIGHT,
  VIDEO_WINDOW_WIDTH,
  resolveVideoWindowBounds
} from './window-video';
import type { NowPlayingWindowGeometry } from './window-now-playing';

const BASE_GEOMETRY: NowPlayingWindowGeometry = {
  innerWidth: 1000,
  innerHeight: 600,
  outerWidth: VIDEO_WINDOW_WIDTH,
  outerHeight: VIDEO_WINDOW_HEIGHT,
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

describe('resolveVideoWindowBounds', () => {
  it('keeps a window with a useful video viewport unchanged', () => {
    expect(resolveVideoWindowBounds(BASE_GEOMETRY)).toBeNull();
  });

  it('resizes an unsuitable player window to 1280 by 720', () => {
    expect(
      resolveVideoWindowBounds({
        ...BASE_GEOMETRY,
        innerWidth: 500,
        innerHeight: 300,
        outerWidth: 516,
        outerHeight: 338
      })
    ).toEqual({ left: 120, top: 80, width: 1280, height: 720 });
  });

  it('uses the exact video target even when only one axis is unsuitable', () => {
    expect(
      resolveVideoWindowBounds({
        ...BASE_GEOMETRY,
        innerWidth: 1300,
        innerHeight: 400,
        outerWidth: 1316,
        outerHeight: 438
      })
    ).toEqual({ left: 120, top: 80, width: 1280, height: 720 });
  });

  it('clamps the target to the available screen', () => {
    expect(
      resolveVideoWindowBounds({
        ...BASE_GEOMETRY,
        innerWidth: 500,
        innerHeight: 300,
        outerWidth: 516,
        outerHeight: 338,
        screenX: 500,
        screenY: 200,
        screen: {
          width: 1024,
          height: 700,
          availWidth: 1024,
          availHeight: 700,
          availLeft: 0,
          availTop: 0
        }
      })
    ).toEqual({ left: 0, top: 0, width: 1024, height: 700 });
  });
});
