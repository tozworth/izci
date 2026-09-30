import { createSettingsStore } from '$lib/stores/persistent-store';

export type DesktopShowIn = 'taskbar' | 'tray' | 'both';
export interface DesktopSettings { showIn: DesktopShowIn; fileAssociations: boolean }
export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = { showIn: 'taskbar', fileAssociations: true };

export function normalizeDesktopSettings(value: unknown): DesktopSettings {
  const source = value && typeof value === 'object' ? value as Partial<DesktopSettings> : {};
  return {
    showIn: source.showIn === 'tray' || source.showIn === 'both' ? source.showIn : 'taskbar',
    fileAssociations: typeof source.fileAssociations === 'boolean' ? source.fileAssociations : true
  };
}

export const desktopSettings = createSettingsStore({
  storageKey: 'izci.desktop-settings', channelName: 'izci.desktop-settings',
  defaultValue: DEFAULT_DESKTOP_SETTINGS, normalize: normalizeDesktopSettings
});

export function resetDesktopAppearance(): void {
  desktopSettings.update({ showIn: DEFAULT_DESKTOP_SETTINGS.showIn });
}
export function resetDesktopTracks(): void {
  desktopSettings.update({ fileAssociations: DEFAULT_DESKTOP_SETTINGS.fileAssociations });
}
