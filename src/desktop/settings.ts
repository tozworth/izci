import { createSettingsStore } from '$lib/stores/persistent-store';

export type DesktopShowIn = 'taskbar' | 'tray' | 'both';
export type DesktopTrayIcon = 'light' | 'dark';
export interface DesktopSettings { showIn: DesktopShowIn; trayIcon: DesktopTrayIcon; trackInfoBubble: boolean; fileAssociations: boolean; focusOnFileLaunch: boolean }
export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = { showIn: 'taskbar', trayIcon: 'light', trackInfoBubble: true, fileAssociations: true, focusOnFileLaunch: true };

export function normalizeDesktopSettings(value: unknown): DesktopSettings {
  const source = value && typeof value === 'object' ? value as Partial<DesktopSettings> : {};
  return {
    showIn: source.showIn === 'tray' || source.showIn === 'both' ? source.showIn : 'taskbar',
    trayIcon: source.trayIcon === 'dark' ? 'dark' : 'light',
    trackInfoBubble: typeof source.trackInfoBubble === 'boolean' ? source.trackInfoBubble : true,
    fileAssociations: typeof source.fileAssociations === 'boolean' ? source.fileAssociations : true,
    focusOnFileLaunch: typeof source.focusOnFileLaunch === 'boolean' ? source.focusOnFileLaunch : true
  };
}

export const desktopSettings = createSettingsStore({
  storageKey: 'izci.desktop-settings', channelName: 'izci.desktop-settings',
  defaultValue: DEFAULT_DESKTOP_SETTINGS, normalize: normalizeDesktopSettings
});

export function resetDesktopAppearance(): void {
  desktopSettings.update({ showIn: DEFAULT_DESKTOP_SETTINGS.showIn, trayIcon: DEFAULT_DESKTOP_SETTINGS.trayIcon, trackInfoBubble: DEFAULT_DESKTOP_SETTINGS.trackInfoBubble });
}
export function resetDesktopTracks(): void {
  desktopSettings.update({
    fileAssociations: DEFAULT_DESKTOP_SETTINGS.fileAssociations,
    focusOnFileLaunch: DEFAULT_DESKTOP_SETTINGS.focusOnFileLaunch
  });
}
