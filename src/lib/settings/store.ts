export type {
  PersistentStoreController,
  PersistentStoreOptions,
  SettingsSnapshot,
  SettingsStoreController,
  SettingsStoreStatus
} from './contracts';
export type { RegisteredSettingsController } from './registry';
export { samePersistentValue } from './engine';
export { createPersistentStore, createSettingsStore, settingsRegistry } from './browser';

import { settingsRegistry } from './browser';

export const listRegisteredSettings = () => settingsRegistry.list();
export const getRegisteredSettingsController = (storageKey: string) => settingsRegistry.get(storageKey);
export const exportRegisteredSettings = () => settingsRegistry.exportValues();
export const restoreRegisteredSetting = (storageKey: string, value: unknown) =>
  settingsRegistry.restore(storageKey, value);
export const resetRegisteredSetting = (storageKey: string) => settingsRegistry.reset(storageKey);
export const flushSettingsStores = () => settingsRegistry.flushAll();
export const disposeSettingsStores = () => settingsRegistry.disposeAll();
