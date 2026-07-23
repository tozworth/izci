import type {
  WorkspaceCollection,
  WorkspacePanelActiveTabsSettings,
  WorkspacePanelId,
  WorkspacePanelStateSettings,
  WorkspacePanelTabsSettings,
  WorkspaceTab,
  WorkspaceTabPanelMemorySettings
} from '$lib/types';
import { WORKSPACE_PANEL_IDS, WORKSPACE_TABS } from '$lib/types';
import { createPersistentStore } from './persistent-store';

export const WORKSPACE_PANEL_STATE_STORAGE_KEY = 'izci.workspace-panel-state.v2';
export const WORKSPACE_PANEL_STATE_CHANNEL = 'izci-workspace-panel-state';

export const DEFAULT_WORKSPACE_PANEL_TABS: WorkspacePanelTabsSettings = {
  left: ['playlist'],
  center: ['library'],
  right: []
};

export const DEFAULT_WORKSPACE_ACTIVE_TABS: WorkspacePanelActiveTabsSettings = {
  left: 'playlist',
  center: 'library',
  right: null
};

export const DEFAULT_WORKSPACE_LAST_PANEL_BY_TAB: WorkspaceTabPanelMemorySettings = {
  playlist: 'left',
  library: 'center',
  details: 'right',
  lyrics: 'right',
  patterns: 'center',
  video: 'center'
};

export const DEFAULT_WORKSPACE_PANEL_STATE: WorkspacePanelStateSettings = {
  activeWorkspaceTab: 'playlist',
  activeCollection: 'playlist',
  panels: DEFAULT_WORKSPACE_PANEL_TABS,
  openPanels: ['left', 'center'],
  activeTabsByPanel: DEFAULT_WORKSPACE_ACTIVE_TABS,
  lastPanelByTab: DEFAULT_WORKSPACE_LAST_PANEL_BY_TAB,
  tabbedTabOrder: ['playlist', 'library']
};

function isWorkspaceTab(value: unknown): value is WorkspaceTab {
  return (
    value === 'playlist' ||
    value === 'library' ||
    value === 'details' ||
    value === 'lyrics' ||
    value === 'patterns' ||
    value === 'video'
  );
}

function isWorkspacePanelId(value: unknown): value is WorkspacePanelId {
  return value === 'left' || value === 'center' || value === 'right';
}

function normalizeWorkspaceTab(value: unknown): WorkspaceTab {
  return isWorkspaceTab(value) ? value : 'playlist';
}

function normalizeWorkspaceCollection(value: unknown): WorkspaceCollection {
  return value === 'library' ? 'library' : 'playlist';
}

function createEmptyPanels(): WorkspacePanelTabsSettings {
  return {
    left: [],
    center: [],
    right: []
  };
}

function clonePanels(panels: WorkspacePanelTabsSettings): WorkspacePanelTabsSettings {
  return {
    left: [...panels.left],
    center: [...panels.center],
    right: [...panels.right]
  };
}

function getOpenTabs(panels: WorkspacePanelTabsSettings): WorkspaceTab[] {
  const tabs: WorkspaceTab[] = [];

  for (const panelId of WORKSPACE_PANEL_IDS) {
    tabs.push(...panels[panelId]);
  }

  return tabs;
}

function isTabOpen(tab: WorkspaceTab, panels: WorkspacePanelTabsSettings): boolean {
  return WORKSPACE_PANEL_IDS.some((panelId) => panels[panelId].includes(tab));
}

function normalizePanelTabs(value: unknown): WorkspacePanelTabsSettings {
  const source = value && typeof value === 'object'
    ? (value as Partial<Record<WorkspacePanelId, unknown>>)
    : {};
  const panels = createEmptyPanels();
  const assignedTabs = new Set<WorkspaceTab>();

  for (const panelId of WORKSPACE_PANEL_IDS) {
    const rawTabs = Array.isArray(source[panelId]) ? source[panelId] : [];

    for (const tab of rawTabs) {
      if (!isWorkspaceTab(tab) || assignedTabs.has(tab)) {
        continue;
      }

      panels[panelId].push(tab);
      assignedTabs.add(tab);
    }
  }

  return panels;
}

function normalizeOpenPanels(
  value: unknown,
  panels: WorkspacePanelTabsSettings,
  hasSavedOpenPanels: boolean
): WorkspacePanelId[] {
  const openPanels = new Set<WorkspacePanelId>();

  if (hasSavedOpenPanels && Array.isArray(value)) {
    for (const panelId of value) {
      if (isWorkspacePanelId(panelId)) {
        openPanels.add(panelId);
      }
    }
  } else {
    for (const panelId of WORKSPACE_PANEL_IDS) {
      if (panels[panelId].length > 0) {
        openPanels.add(panelId);
      }
    }
  }

  for (const panelId of WORKSPACE_PANEL_IDS) {
    if (panels[panelId].length > 0) {
      openPanels.add(panelId);
    }
  }

  return WORKSPACE_PANEL_IDS.filter((panelId) => openPanels.has(panelId));
}

function normalizeActiveTabsByPanel(
  value: unknown,
  panels: WorkspacePanelTabsSettings
): WorkspacePanelActiveTabsSettings {
  const source = value && typeof value === 'object'
    ? (value as Partial<Record<WorkspacePanelId, unknown>>)
    : {};
  const activeTabs = { ...DEFAULT_WORKSPACE_ACTIVE_TABS };

  for (const panelId of WORKSPACE_PANEL_IDS) {
    const candidate = source[panelId];
    activeTabs[panelId] =
      isWorkspaceTab(candidate) && panels[panelId].includes(candidate)
        ? candidate
        : panels[panelId][0] ?? null;
  }

  return activeTabs;
}

function normalizeTabbedTabOrder(
  value: unknown,
  panels: WorkspacePanelTabsSettings
): WorkspaceTab[] {
  const openTabs = new Set(getOpenTabs(panels));
  const order: WorkspaceTab[] = [];

  if (Array.isArray(value)) {
    for (const tab of value) {
      if (!isWorkspaceTab(tab) || !openTabs.has(tab) || order.includes(tab)) {
        continue;
      }

      order.push(tab);
    }
  }

  for (const tab of getOpenTabs(panels)) {
    if (!order.includes(tab)) {
      order.push(tab);
    }
  }

  return order;
}

function normalizeLastPanelByTab(
  value: unknown,
  panels: WorkspacePanelTabsSettings
): WorkspaceTabPanelMemorySettings {
  const source = value && typeof value === 'object'
    ? (value as Partial<Record<WorkspaceTab, unknown>>)
    : {};
  const lastPanelByTab = { ...DEFAULT_WORKSPACE_LAST_PANEL_BY_TAB };

  for (const tab of WORKSPACE_TABS) {
    const savedPanelId = source[tab];

    if (isWorkspacePanelId(savedPanelId)) {
      lastPanelByTab[tab] = savedPanelId;
    }
  }

  for (const panelId of WORKSPACE_PANEL_IDS) {
    for (const tab of panels[panelId]) {
      lastPanelByTab[tab] = panelId;
    }
  }

  return lastPanelByTab;
}

function getFallbackOpenTab(
  activeTabsByPanel: WorkspacePanelActiveTabsSettings,
  tabbedTabOrder: WorkspaceTab[]
): WorkspaceTab | null {
  for (const tab of tabbedTabOrder) {
    if (isWorkspaceTab(tab)) {
      return tab;
    }
  }

  for (const panelId of WORKSPACE_PANEL_IDS) {
    const tab = activeTabsByPanel[panelId];

    if (tab) {
      return tab;
    }
  }

  return null;
}

function normalizePanelState(value: unknown): WorkspacePanelStateSettings {
  const source =
    value && typeof value === 'object'
      ? (value as Partial<WorkspacePanelStateSettings> & Record<string, unknown>)
      : {};
  const panels = source.panels && typeof source.panels === 'object'
    ? normalizePanelTabs(source.panels)
    : clonePanels(DEFAULT_WORKSPACE_PANEL_TABS);
  const openPanels = normalizeOpenPanels(
    source.openPanels,
    panels,
    Object.prototype.hasOwnProperty.call(source, 'openPanels')
  );
  const activeTabsByPanel = normalizeActiveTabsByPanel(source.activeTabsByPanel, panels);
  const lastPanelByTab = normalizeLastPanelByTab(source.lastPanelByTab, panels);
  const tabbedTabOrder = normalizeTabbedTabOrder(source.tabbedTabOrder, panels);
  const requestedActiveTab = normalizeWorkspaceTab(source.activeWorkspaceTab);
  const fallbackOpenTab = getFallbackOpenTab(activeTabsByPanel, tabbedTabOrder);
  const activeWorkspaceTab = isTabOpen(requestedActiveTab, panels)
    ? requestedActiveTab
    : fallbackOpenTab ?? requestedActiveTab;
  const activeCollection =
    activeWorkspaceTab === 'playlist' || activeWorkspaceTab === 'library'
      ? activeWorkspaceTab
      : normalizeWorkspaceCollection(source.activeCollection);

  return {
    activeWorkspaceTab,
    activeCollection,
    panels,
    openPanels,
    activeTabsByPanel,
    lastPanelByTab,
    tabbedTabOrder
  };
}

export function getDefaultWorkspacePanelForTab(tab: WorkspaceTab): WorkspacePanelId {
  return DEFAULT_WORKSPACE_LAST_PANEL_BY_TAB[tab];
}

const store = createPersistentStore({
  storageKey: WORKSPACE_PANEL_STATE_STORAGE_KEY,
  channelName: WORKSPACE_PANEL_STATE_CHANNEL,
  defaultValue: DEFAULT_WORKSPACE_PANEL_STATE,
  normalize: normalizePanelState
});

export const workspacePanelState = {
  subscribe: store.subscribe,
  getSnapshot: store.getSnapshot,
  set(nextValue: WorkspacePanelStateSettings): WorkspacePanelStateSettings {
    return store.set(nextValue);
  },
  update(patch: Partial<WorkspacePanelStateSettings>): WorkspacePanelStateSettings {
    return store.update((settings) => ({ ...settings, ...patch }));
  },
  reset: store.reset
};
