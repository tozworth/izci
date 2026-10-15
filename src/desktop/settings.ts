import { createSettingsStore } from '$lib/stores/persistent-store';

export type DesktopShowIn = 'taskbar' | 'tray' | 'both';
export type DesktopTrayIcon = 'light' | 'dark';
export const MIN_DESKTOP_ZOOM = 50;
export const MAX_DESKTOP_ZOOM = 200;
export const DEFAULT_DESKTOP_ZOOM = 100;

export interface DesktopSettings { zoomPercent: number; showIn: DesktopShowIn; trayIcon: DesktopTrayIcon; launchOnBoot: boolean; closeToTray: boolean; trackInfoBubble: boolean; fileAssociations: boolean; focusOnFileLaunch: boolean }
export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = { zoomPercent: DEFAULT_DESKTOP_ZOOM, showIn: 'taskbar', trayIcon: 'light', launchOnBoot: false, closeToTray: false, trackInfoBubble: true, fileAssociations: true, focusOnFileLaunch: true };

export function normalizeDesktopSettings(value: unknown): DesktopSettings {
  const source = value && typeof value === 'object' ? value as Partial<DesktopSettings> : {};
  return {
    zoomPercent: typeof source.zoomPercent === 'number' && Number.isFinite(source.zoomPercent)
      ? Math.min(MAX_DESKTOP_ZOOM, Math.max(MIN_DESKTOP_ZOOM, Math.round(source.zoomPercent)))
      : DEFAULT_DESKTOP_ZOOM,
    showIn: source.showIn === 'tray' || source.showIn === 'both' ? source.showIn : 'taskbar',
    trayIcon: source.trayIcon === 'dark' ? 'dark' : 'light',
    launchOnBoot: typeof source.launchOnBoot === 'boolean' ? source.launchOnBoot : false,
    closeToTray: typeof source.closeToTray === 'boolean' ? source.closeToTray : false,
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
  desktopSettings.update({ zoomPercent: DEFAULT_DESKTOP_ZOOM, showIn: DEFAULT_DESKTOP_SETTINGS.showIn, trayIcon: DEFAULT_DESKTOP_SETTINGS.trayIcon, launchOnBoot: DEFAULT_DESKTOP_SETTINGS.launchOnBoot, closeToTray: DEFAULT_DESKTOP_SETTINGS.closeToTray, trackInfoBubble: DEFAULT_DESKTOP_SETTINGS.trackInfoBubble });
}
export function resetDesktopTracks(): void {
  desktopSettings.update({
    fileAssociations: DEFAULT_DESKTOP_SETTINGS.fileAssociations,
    focusOnFileLaunch: DEFAULT_DESKTOP_SETTINGS.focusOnFileLaunch
  });
}
