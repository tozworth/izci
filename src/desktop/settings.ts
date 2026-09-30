import { createSettingsStore } from '$lib/stores/persistent-store';

export interface DesktopSettings { trayIcon: boolean; fileAssociations: boolean }
export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = { trayIcon: false, fileAssociations: true };

export function normalizeDesktopSettings(value: unknown): DesktopSettings {
  const source = value && typeof value === 'object' ? value as Partial<DesktopSettings> : {};
  return {
    trayIcon: source.trayIcon === true,
    fileAssociations: typeof source.fileAssociations === 'boolean' ? source.fileAssociations : true
  };
}

export const desktopSettings = createSettingsStore({
  storageKey: 'izci.desktop-settings', channelName: 'izci.desktop-settings',
  defaultValue: DEFAULT_DESKTOP_SETTINGS, normalize: normalizeDesktopSettings
});

export function resetDesktopAppearance(): void {
  desktopSettings.update({ trayIcon: DEFAULT_DESKTOP_SETTINGS.trayIcon });
}
export function resetDesktopTracks(): void {
  desktopSettings.update({ fileAssociations: DEFAULT_DESKTOP_SETTINGS.fileAssociations });
}
