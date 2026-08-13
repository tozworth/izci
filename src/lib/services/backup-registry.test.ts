import { afterEach, describe, expect, it } from 'vitest';
import { experimentalSettings } from '$lib/stores/experimental-settings';
import { listRegisteredSettings } from '$lib/settings/store';
import {
  BACKED_UP_SETTINGS_KEYS,
  BACKUP_REGISTRY,
  exportBackupSettings,
  restoreBackupSettings,
  sanitizeBackupSetting
} from './backup-registry';

afterEach(() => {
  experimentalSettings.update({ multiplayerTurnSecret: '' });
});

describe('backup owner registry', () => {
  it('classifies every key and gives included owners complete lifecycle callbacks', () => {
    expect(new Set(BACKUP_REGISTRY.map((entry) => entry.storageKey)).size).toBe(BACKUP_REGISTRY.length);
    for (const entry of BACKUP_REGISTRY) {
      expect(entry.reason.length).toBeGreaterThan(0);
      if (entry.inclusion === 'included') {
        expect(entry.export).toBeTypeOf('function');
        expect(entry.restore).toBeTypeOf('function');
        expect(entry.reset).toBeTypeOf('function');
      }
    }
    expect(BACKED_UP_SETTINGS_KEYS).toContain('izci.library-view-settings.v6');
    expect(BACKED_UP_SETTINGS_KEYS).toContain('izci-playback-bookmarks');
    expect(BACKED_UP_SETTINGS_KEYS).not.toContain('izci.library-view-settings.v5');
    const classified = new Set(BACKUP_REGISTRY.map((entry) => entry.storageKey));
    expect(listRegisteredSettings().map((entry) => entry.storageKey).filter((key) => !classified.has(key)))
      .toEqual([]);
  });

  it('never exports or accepts the Multiplayer TURN secret', () => {
    experimentalSettings.update({
      multiplayer: true,
      multiplayerTurnSecret: 'do-not-export'
    });
    const exported = exportBackupSettings();
    expect(exported['izci.experimental-settings']).not.toHaveProperty('multiplayerTurnSecret');

    const sanitized = sanitizeBackupSetting('izci.experimental-settings', {
      multiplayer: false,
      multiplayerTurnSecret: 'archive-secret'
    });
    expect(sanitized).not.toHaveProperty('multiplayerTurnSecret');
    restoreBackupSettings({ ...exported, 'izci.experimental-settings': sanitized });
    expect(experimentalSettings.getSnapshot()).toMatchObject({
      multiplayer: false,
      multiplayerTurnSecret: 'do-not-export'
    });
  });
});
