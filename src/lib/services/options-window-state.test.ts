import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getOptionsWindowState,
  rememberOptionsActiveView,
  rememberShowAdvancedTweaks
} from './options-window-state';

const STORAGE_KEY = 'izci.options-window-state';

describe('options window state', () => {
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

  it('hides advanced tweaks by default, including when persisted state omits it', () => {
    expect(getOptionsWindowState().showAdvancedTweaks).toBe(false);

    values.set(STORAGE_KEY, JSON.stringify({ activeView: 'tracks' }));
    expect(getOptionsWindowState()).toMatchObject({
      activeView: 'tracks',
      showAdvancedTweaks: false
    });
  });

  it('persists advanced visibility while preserving the rest of the window state', () => {
    rememberOptionsActiveView('metadata');
    rememberShowAdvancedTweaks(true);

    expect(getOptionsWindowState()).toMatchObject({
      activeView: 'metadata',
      showAdvancedTweaks: true
    });
  });
});
