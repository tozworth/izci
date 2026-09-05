import type { DockTabMoveDetail } from '$lib/components/docking/types';
import { findDockTabZone, moveDockTab } from '$lib/services/dock-layout';
import { createPersistentStore } from './persistent-store';

export const TROUBADOUR_DOCK_SCOPE = 'troubadour-workspace';
const TROUBADOUR_WORKSPACE_STORAGE_KEY = 'izci.troubadour-workspace.v1';
const TROUBADOUR_WORKSPACE_CHANNEL = 'izci-troubadour-workspace';

export const TROUBADOUR_TABS = [
  'files',
  'albums',
  'metadata',
  'rename',
  'lyrics',
  'loudness',
  'spectrogram'
] as const;

export type TroubadourTab = typeof TROUBADOUR_TABS[number];

const TROUBADOUR_DOCK_ZONE_IDS = [
  'top-left',
  'top-right',
  'left-top',
  'left-bottom',
  'middle-top',
  'middle-bottom',
  'right-top',
  'right-bottom',
  'bottom-left',
  'bottom-right'
] as const;

export type TroubadourDockZoneId = typeof TROUBADOUR_DOCK_ZONE_IDS[number];
export type TroubadourDockRegionId = 'top' | 'left' | 'middle' | 'right' | 'bottom';

interface TroubadourDockRegion {
  id: TroubadourDockRegionId;
  zones: readonly [TroubadourDockZoneId, TroubadourDockZoneId];
  split: 'horizontal' | 'vertical';
}

export const TROUBADOUR_DOCK_REGIONS: readonly TroubadourDockRegion[] = [
  { id: 'top', zones: ['top-left', 'top-right'], split: 'horizontal' },
  { id: 'left', zones: ['left-top', 'left-bottom'], split: 'vertical' },
  { id: 'middle', zones: ['middle-top', 'middle-bottom'], split: 'vertical' },
  { id: 'right', zones: ['right-top', 'right-bottom'], split: 'vertical' },
  { id: 'bottom', zones: ['bottom-left', 'bottom-right'], split: 'horizontal' }
];

type TroubadourDockZones = Record<TroubadourDockZoneId, TroubadourTab[]>;
type TroubadourDockActiveTabs = Record<TroubadourDockZoneId, TroubadourTab | null>;

export interface TroubadourDockLayout {
  rows: Record<'top' | 'middle' | 'bottom', number>;
  columns: Record<'left' | 'middle' | 'right', number>;
  splits: Record<TroubadourDockRegionId, number>;
}

export interface TroubadourWorkspaceState {
  zones: TroubadourDockZones;
  activeTabsByZone: TroubadourDockActiveTabs;
  layout: TroubadourDockLayout;
}

const DEFAULT_TROUBADOUR_DOCK_LAYOUT: TroubadourDockLayout = {
  rows: { top: 0.2, middle: 0.6, bottom: 0.2 },
  columns: { left: 0.28, middle: 0.46, right: 0.26 },
  splits: { top: 0.5, left: 0.5, middle: 0.58, right: 0.5, bottom: 0.5 }
};

export const DEFAULT_TROUBADOUR_WORKSPACE_STATE: TroubadourWorkspaceState = {
  zones: {
    'top-left': [],
    'top-right': [],
    'left-top': ['files'],
    'left-bottom': [],
    'middle-top': ['albums'],
    'middle-bottom': ['metadata', 'rename', 'lyrics', 'loudness', 'spectrogram'],
    'right-top': [],
    'right-bottom': [],
    'bottom-left': [],
    'bottom-right': []
  },
  activeTabsByZone: {
    'top-left': null,
    'top-right': null,
    'left-top': 'files',
    'left-bottom': null,
    'middle-top': 'albums',
    'middle-bottom': 'metadata',
    'right-top': null,
    'right-bottom': null,
    'bottom-left': null,
    'bottom-right': null
  },
  layout: DEFAULT_TROUBADOUR_DOCK_LAYOUT
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isTroubadourTab(value: unknown): value is TroubadourTab {
  return typeof value === 'string' && (TROUBADOUR_TABS as readonly string[]).includes(value);
}

function isTroubadourDockZoneId(value: unknown): value is TroubadourDockZoneId {
  return typeof value === 'string' && (TROUBADOUR_DOCK_ZONE_IDS as readonly string[]).includes(value);
}

function createEmptyZones(): TroubadourDockZones {
  return {
    'top-left': [],
    'top-right': [],
    'left-top': [],
    'left-bottom': [],
    'middle-top': [],
    'middle-bottom': [],
    'right-top': [],
    'right-bottom': [],
    'bottom-left': [],
    'bottom-right': []
  };
}

function normalizeZones(value: unknown): TroubadourDockZones {
  const source = isObject(value) ? value : {};
  const zones = createEmptyZones();
  const assignedTabs = new Set<TroubadourTab>();

  for (const zoneId of TROUBADOUR_DOCK_ZONE_IDS) {
    const candidateTabs = Array.isArray(source[zoneId]) ? source[zoneId] : [];

    for (const tab of candidateTabs) {
      if (isTroubadourTab(tab) && !assignedTabs.has(tab)) {
        zones[zoneId].push(tab);
        assignedTabs.add(tab);
      }
    }
  }

  for (const zoneId of TROUBADOUR_DOCK_ZONE_IDS) {
    for (const tab of DEFAULT_TROUBADOUR_WORKSPACE_STATE.zones[zoneId]) {
      if (!assignedTabs.has(tab)) {
        zones[zoneId].push(tab);
        assignedTabs.add(tab);
      }
    }
  }

  return zones;
}

function normalizeActiveTabs(value: unknown, zones: TroubadourDockZones): TroubadourDockActiveTabs {
  const source = isObject(value) ? value : {};

  return Object.fromEntries(
    TROUBADOUR_DOCK_ZONE_IDS.map((zoneId) => {
      const candidate = source[zoneId];
      return [
        zoneId,
        isTroubadourTab(candidate) && zones[zoneId].includes(candidate)
          ? candidate
          : zones[zoneId][0] ?? null
      ];
    })
  ) as TroubadourDockActiveTabs;
}

function finiteLayoutValue(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function normalizeLayout(value: unknown): TroubadourDockLayout {
  const source = isObject(value) ? value : {};
  const rows = isObject(source.rows) ? source.rows : {};
  const columns = isObject(source.columns) ? source.columns : {};
  const splits = isObject(source.splits) ? source.splits : {};

  return {
    rows: {
      top: finiteLayoutValue(rows.top, DEFAULT_TROUBADOUR_DOCK_LAYOUT.rows.top, 0.05, 10),
      middle: finiteLayoutValue(rows.middle, DEFAULT_TROUBADOUR_DOCK_LAYOUT.rows.middle, 0.05, 10),
      bottom: finiteLayoutValue(rows.bottom, DEFAULT_TROUBADOUR_DOCK_LAYOUT.rows.bottom, 0.05, 10)
    },
    columns: {
      left: finiteLayoutValue(columns.left, DEFAULT_TROUBADOUR_DOCK_LAYOUT.columns.left, 0.05, 10),
      middle: finiteLayoutValue(columns.middle, DEFAULT_TROUBADOUR_DOCK_LAYOUT.columns.middle, 0.05, 10),
      right: finiteLayoutValue(columns.right, DEFAULT_TROUBADOUR_DOCK_LAYOUT.columns.right, 0.05, 10)
    },
    splits: {
      top: finiteLayoutValue(splits.top, DEFAULT_TROUBADOUR_DOCK_LAYOUT.splits.top, 0.12, 0.88),
      left: finiteLayoutValue(splits.left, DEFAULT_TROUBADOUR_DOCK_LAYOUT.splits.left, 0.12, 0.88),
      middle: finiteLayoutValue(splits.middle, DEFAULT_TROUBADOUR_DOCK_LAYOUT.splits.middle, 0.12, 0.88),
      right: finiteLayoutValue(splits.right, DEFAULT_TROUBADOUR_DOCK_LAYOUT.splits.right, 0.12, 0.88),
      bottom: finiteLayoutValue(splits.bottom, DEFAULT_TROUBADOUR_DOCK_LAYOUT.splits.bottom, 0.12, 0.88)
    }
  };
}

export function normalizeTroubadourWorkspaceState(value: unknown): TroubadourWorkspaceState {
  const source = isObject(value) ? value : {};
  const zones = normalizeZones(source.zones);
  const activeTabsByZone = normalizeActiveTabs(source.activeTabsByZone, zones);
  const layout = normalizeLayout(source.layout);

  return { zones, activeTabsByZone, layout };
}

const store = createPersistentStore({
  storageKey: TROUBADOUR_WORKSPACE_STORAGE_KEY,
  channelName: TROUBADOUR_WORKSPACE_CHANNEL,
  defaultValue: DEFAULT_TROUBADOUR_WORKSPACE_STATE,
  normalize: normalizeTroubadourWorkspaceState
});

export const troubadourWorkspaceState = {
  subscribe: store.subscribe,
  getSnapshot: store.getSnapshot,
  setLayout(layout: TroubadourDockLayout): TroubadourWorkspaceState {
    return store.set({ ...store.getSnapshot(), layout });
  },
  setActiveTab(tab: TroubadourTab): TroubadourWorkspaceState {
    const current = store.getSnapshot();
    const zoneId = findDockTabZone(current.zones, TROUBADOUR_DOCK_ZONE_IDS, tab);

    if (!zoneId) {
      return current;
    }

    return store.set({
      ...current,
      activeTabsByZone: { ...current.activeTabsByZone, [zoneId]: tab }
    });
  },
  moveTab(detail: DockTabMoveDetail): TroubadourWorkspaceState {
    const current = store.getSnapshot();

    if (
      !isTroubadourTab(detail.tabId) ||
      !isTroubadourDockZoneId(detail.targetZoneId)
    ) {
      return current;
    }

    const sourceZoneId = findDockTabZone(current.zones, TROUBADOUR_DOCK_ZONE_IDS, detail.tabId);
    const zones = moveDockTab(current.zones, TROUBADOUR_DOCK_ZONE_IDS, detail);

    if (!sourceZoneId || zones === current.zones) {
      return current;
    }

    const activeTabsByZone = { ...current.activeTabsByZone };
    activeTabsByZone[detail.targetZoneId] = detail.tabId;

    if (
      sourceZoneId !== detail.targetZoneId &&
      activeTabsByZone[sourceZoneId] === detail.tabId
    ) {
      activeTabsByZone[sourceZoneId] = zones[sourceZoneId][0] ?? null;
    }

    return store.set({ ...current, zones, activeTabsByZone });
  },
  reset: store.reset
};
