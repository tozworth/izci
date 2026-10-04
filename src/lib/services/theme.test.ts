import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppearanceSettings } from '$lib/types';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function startTheme(settings: Partial<AppearanceSettings>) {
  const storageKey = 'izci.appearance-settings';
  const storage = new Map([[storageKey, JSON.stringify(settings)]]);
  const cssProperties = new Map<string, string>();
  const windowEvents = new EventTarget();
  const mediaQuery = Object.assign(new EventTarget(), { matches: true });
  const root = {
    dataset: {} as Record<string, string>,
    style: { setProperty: (key: string, value: string) => cssProperties.set(key, value) }
  };
  const themeColor = { content: '' };

  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value)
    },
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
    matchMedia: () => mediaQuery
  });
  vi.stubGlobal('document', { documentElement: root, querySelector: () => themeColor });

  const { appearanceSettings } = await import('$lib/stores/appearance-settings');
  const { initializeTheme } = await import('./theme');
  initializeTheme();

  return { appearanceSettings, storage, storageKey, cssProperties, windowEvents, mediaQuery, root, themeColor };
}

describe('Accented theme', () => {
  it('restores and remembers its own palette while preserving neutral window chrome in either scheme', async () => {
    const { appearanceSettings, root, themeColor, cssProperties, storage, storageKey } = await startTheme({
      colorThemeMode: 'dark',
      lightColorTheme: 'accented',
      darkColorTheme: 'accented',
      accentedHue: 325,
      accentedSaturation: 32,
      chameleonHue: 130,
      chameleonSaturation: 80
    });

    expect(root.dataset).toEqual({ theme: 'accented', colorScheme: 'dark' });
    expect(themeColor.content).toBe('#101113');
    expect(cssProperties.get('--accented-hue')).toBe('325');
    expect(cssProperties.get('--accented-saturation')).toBe('32%');

    appearanceSettings.update({ accentedHue: 20, accentedSaturation: 55, darkColorTheme: 'chameleon' });
    expect(root.dataset.theme).toBe('chameleon');
    expect(cssProperties.get('--chameleon-hue')).toBe('130');
    expect(cssProperties.get('--chameleon-accent-saturation')).toBe('80%');
    expect(themeColor.content).toBe('hsl(130 26% 11%)');

    appearanceSettings.update({ darkColorTheme: 'accented', colorThemeMode: 'light' });
    expect(root.dataset).toEqual({ theme: 'accented', colorScheme: 'light' });
    expect(themeColor.content).toBe('#e4e3e0');
    expect(cssProperties.get('--accented-hue')).toBe('20');
    expect(cssProperties.get('--accented-saturation')).toBe('55%');
    expect(JSON.parse(storage.get(storageKey)!)).toMatchObject({
      lightColorTheme: 'accented', darkColorTheme: 'accented',
      accentedHue: 20, accentedSaturation: 55, chameleonHue: 130, chameleonSaturation: 80
    });
  });

  it('follows system appearance and applies palette changes received from another window', async () => {
    const { appearanceSettings, root, themeColor, cssProperties, storage, storageKey, mediaQuery, windowEvents } = await startTheme({
      colorThemeMode: 'system', lightColorTheme: 'accented', darkColorTheme: 'accented'
    });

    expect(root.dataset.colorScheme).toBe('dark');
    mediaQuery.matches = false;
    mediaQuery.dispatchEvent(new Event('change'));
    expect(root.dataset.colorScheme).toBe('light');
    expect(themeColor.content).toBe('#e4e3e0');

    storage.set(storageKey, JSON.stringify({ ...appearanceSettings.getSnapshot(), accentedHue: 91, accentedSaturation: 0 }));
    windowEvents.dispatchEvent(Object.assign(new Event('storage'), { key: storageKey }));
    expect(cssProperties.get('--accented-hue')).toBe('91');
    expect(cssProperties.get('--accented-saturation')).toBe('0%');
    expect(themeColor.content).toBe('#e4e3e0');
  });
});
