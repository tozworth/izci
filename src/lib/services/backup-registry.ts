import '$lib/i18n';
import '$lib/stores/appearance-settings';
import '$lib/stores/experimental-settings';
import '$lib/stores/library-view-settings';
import '$lib/stores/loadout-ui-settings';
import '$lib/stores/loadouts';
import '$lib/stores/metadata-settings';
import '$lib/stores/module-playback-settings';
import '$lib/stores/pattern-viewer-settings';
import '$lib/stores/playback-settings';
import '$lib/stores/player-volume';
import '$lib/stores/raf-presets';
import '$lib/stores/raf-settings';
import '$lib/stores/track-settings';
import '$lib/stores/video-settings';
import '$lib/stores/visualizer-settings';
import '$lib/stores/workspace-panel-layout';
import '$lib/stores/workspace-panel-state';
import '$lib/services/playback-bookmarks';
import {
  getRegisteredSettingsController,
  type RegisteredSettingsController
} from '$lib/settings/store';

export type BackupInclusion = 'included' | 'excluded';
export type BackupSecurity = 'ordinary' | 'redacted-secret' | 'private-session' | 'transient';

export interface BackupRegistryEntry {
  readonly id: string;
  readonly storageKey: string;
  readonly inclusion: BackupInclusion;
  readonly security: BackupSecurity;
  readonly reason: string;
  export?(): unknown;
  restore?(value: unknown): void;
  reset?(): void;
}

function clone(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as unknown;
}

function requireOwner(storageKey: string): RegisteredSettingsController {
  const owner = getRegisteredSettingsController(storageKey);
  if (!owner) throw new Error(`backup-owner-unavailable:${storageKey}`);
  return owner;
}

function ordinary(id: string, storageKey: string): BackupRegistryEntry {
  return {
    id,
    storageKey,
    inclusion: 'included',
    security: 'ordinary',
    reason: 'Durable user-facing configuration',
    export: () => clone(requireOwner(storageKey).getSnapshot()),
    restore: (value) => { requireOwner(storageKey).set(clone(value)); },
    reset: () => { requireOwner(storageKey).reset(); }
  };
}

function experimentalSettings(): BackupRegistryEntry {
  const storageKey = 'izci.experimental-settings';
  const secretField = 'multiplayerTurnSecret';
  const withoutSecret = (value: unknown): Record<string, unknown> => {
    const projected = value && typeof value === 'object' && !Array.isArray(value)
      ? { ...value as Record<string, unknown> }
      : {};
    delete projected[secretField];
    return projected;
  };
  const currentSecret = (owner: RegisteredSettingsController): unknown => {
    const snapshot = owner.getSnapshot();
    return snapshot && typeof snapshot === 'object'
      ? (snapshot as Record<string, unknown>)[secretField]
      : '';
  };
  return {
    id: 'experimental-settings',
    storageKey,
    inclusion: 'included',
    security: 'redacted-secret',
    reason: 'Experimental preferences are portable; the TURN shared secret is not',
    export: () => withoutSecret(requireOwner(storageKey).getSnapshot()),
    restore: (value) => {
      const owner = requireOwner(storageKey);
      owner.set({ ...withoutSecret(value), [secretField]: currentSecret(owner) });
    },
    reset: () => {
      const owner = requireOwner(storageKey);
      const secret = currentSecret(owner);
      const defaults = withoutSecret(owner.reset());
      owner.set({ ...defaults, [secretField]: secret });
    }
  };
}

function excluded(
  id: string,
  storageKey: string,
  security: Exclude<BackupSecurity, 'ordinary' | 'redacted-secret'>,
  reason: string
): BackupRegistryEntry {
  return { id, storageKey, inclusion: 'excluded', security, reason };
}

export const BACKUP_REGISTRY: readonly BackupRegistryEntry[] = [
  ordinary('appearance-settings', 'izci.appearance-settings'),
  experimentalSettings(),
  ordinary('library-view-settings', 'izci.library-view-settings.v6'),
  ordinary('loadout-ui-settings', 'izci.loadout-ui-settings'),
  ordinary('loadouts', 'izci.loadouts'),
  ordinary('locale', 'izci.locale'),
  ordinary('metadata-settings', 'izci.metadata-settings'),
  ordinary('module-playback-settings', 'izci.module-playback-settings.v1'),
  ordinary('pattern-viewer-settings', 'izci.pattern-viewer-settings'),
  ordinary('playback-settings', 'izci.playback-settings'),
  ordinary('playback-bookmarks', 'izci-playback-bookmarks'),
  ordinary('player-volume', 'izci.player-volume.v1'),
  ordinary('raf-presets', 'izci.raf-presets'),
  ordinary('raf-settings', 'izci.raf-settings'),
  ordinary('track-settings', 'izci.track-settings'),
  ordinary('video-settings', 'izci.video-settings'),
  ordinary('visualizer-settings', 'izci.visualizer-settings'),
  ordinary('workspace-panel-layout', 'izci.workspace-panel-layout.v2'),
  ordinary('workspace-panel-state', 'izci.workspace-panel-state.v2'),
  excluded('logging-settings', 'izci.logging-settings.v1', 'transient', 'Diagnostic presentation is not user data'),
  excluded('multiplayer-freeplay-state', 'izci.multiplayer-freeplay-state', 'private-session', 'Peer session state is origin-local'),
  excluded('multiplayer-last-session', 'izci.multiplayer-last-session', 'private-session', 'Room restoration state is transient coordination'),
  excluded('multiplayer-pairings', 'izci.multiplayer-pairings', 'private-session', 'Peer trust state is origin-local'),
  excluded('multiplayer-recents', 'izci.multiplayer-recents', 'private-session', 'Recent rooms are private session history'),
  excluded('troubadour-settings', 'izci.troubadour-settings', 'transient', 'Tool-local workbench configuration stays with its window'),
  excluded('troubadour-workspace', 'izci.troubadour-workspace.v1', 'transient', 'Tool workspace state is presentation state'),
  excluded('converter-settings', 'izci:converter-settings', 'transient', 'Tool-local conversion defaults stay with the tool'),
  excluded('logs-column-widths', 'izci.logs-column-widths.v2', 'transient', 'Log presentation is excluded'),
  excluded('logs-column-visibility', 'izci.logs-column-visibility.v2', 'transient', 'Log presentation is excluded'),
  excluded('logs-sort', 'izci.logs-sort.v2', 'transient', 'Log presentation is excluded'),
  excluded('logs-levels', 'izci.logs-levels.v2', 'transient', 'Log presentation is excluded')
] as const;

export const BACKED_UP_SETTINGS_KEYS = BACKUP_REGISTRY
  .filter((entry) => entry.inclusion === 'included')
  .map((entry) => entry.storageKey);

const includedByKey = new Map(
  BACKUP_REGISTRY
    .filter((entry) => entry.inclusion === 'included')
    .map((entry) => [entry.storageKey, entry])
);

export function isBackedUpSetting(storageKey: string): boolean {
  return includedByKey.has(storageKey);
}

export function sanitizeBackupSetting(storageKey: string, value: unknown): unknown {
  if (storageKey !== 'izci.experimental-settings') return clone(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const sanitized = { ...value as Record<string, unknown> };
  delete sanitized.multiplayerTurnSecret;
  return sanitized;
}

export function exportBackupSettings(): Record<string, unknown> {
  return Object.fromEntries(BACKED_UP_SETTINGS_KEYS.map((storageKey) => {
    const entry = includedByKey.get(storageKey)!;
    return [storageKey, entry.export!()];
  }));
}

export function restoreBackupSettings(settings: Record<string, unknown>): number {
  let restored = 0;
  for (const storageKey of BACKED_UP_SETTINGS_KEYS) {
    const entry = includedByKey.get(storageKey)!;
    if (Object.prototype.hasOwnProperty.call(settings, storageKey)) {
      entry.restore!(settings[storageKey]);
      restored += 1;
    } else {
      entry.reset!();
    }
  }
  return restored;
}
