import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPopupWindowSize, rememberPopupWindowSize } from './popup-window-state';

const STORAGE_KEY = 'izci.popup-window-sizes';

describe('popup window state', () => {
  let values: Map<string, string>;

  beforeEach(() => {
    values = new Map();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value)
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses each popup definition as its default size', () => {
    expect(getPopupWindowSize('options')).toEqual({ width: 680, height: 460 });
    expect(getPopupWindowSize('troubadour')).toEqual({ width: 1280, height: 820 });
  });

  it('stores sizes independently for every popup', () => {
    rememberPopupWindowSize('audioCompare', 1010.4, 700.6);
    rememberPopupWindowSize('editor', 900, 640);

    expect(getPopupWindowSize('audioCompare')).toEqual({ width: 1010, height: 701 });
    expect(getPopupWindowSize('editor')).toEqual({ width: 900, height: 640 });
    expect(JSON.parse(values.get(STORAGE_KEY)!)).toEqual({
      audioCompare: { width: 1010, height: 701 },
      editor: { width: 900, height: 640 }
    });
  });

  it('falls back to the popup default for invalid stored dimensions', () => {
    values.set(STORAGE_KEY, JSON.stringify({ converter: { width: 10, height: 'large' } }));
    expect(getPopupWindowSize('converter')).toEqual({ width: 1120, height: 720 });
  });
});
