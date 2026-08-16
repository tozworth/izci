import { describe, expect, it } from 'vitest';
import { closeActiveRightPanel, cycleWorkspaceTab } from './app-shortcuts';
import type { WorkspacePanelId, WorkspaceTab } from '$lib/types';
import type { WorkspacePanelDefinition } from '$lib/components/workspace/types';

function makePanel(overrides: Partial<WorkspacePanelDefinition> = {}): WorkspacePanelDefinition {
  return {
    id: 'right' as WorkspacePanelId,
    tabs: [],
    activeTab: null,
    backdropPanelId: 'right',
    isOpen: true,
    isResponsiveCollapsed: false,
    ...overrides
  };
}

describe('cycleWorkspaceTab', () => {
  it('returns false and does not switch with fewer than two tabs', () => {
    const switched: WorkspaceTab[] = [];
    expect(cycleWorkspaceTab(1, ['queue'], 'queue', (tab) => switched.push(tab))).toBe(false);
    expect(switched).toEqual([]);
    expect(cycleWorkspaceTab(-1, [], null, (tab) => switched.push(tab))).toBe(false);
    expect(switched).toEqual([]);
  });

  it('advances forward and wraps around', () => {
    const switched: WorkspaceTab[] = [];
    const setActive = (tab: WorkspaceTab) => switched.push(tab);
    expect(cycleWorkspaceTab(1, ['queue', 'library', 'details'], 'queue', setActive)).toBe(true);
    expect(cycleWorkspaceTab(1, ['queue', 'library', 'details'], 'details', setActive)).toBe(true);
    expect(switched).toEqual(['library', 'queue']);
  });

  it('steps backward and wraps around', () => {
    const switched: WorkspaceTab[] = [];
    const setActive = (tab: WorkspaceTab) => switched.push(tab);
    expect(cycleWorkspaceTab(-1, ['queue', 'library', 'details'], 'queue', setActive)).toBe(true);
    expect(switched).toEqual(['details']);
  });

  it('falls back to the first tab when the active tab is unknown', () => {
    const switched: WorkspaceTab[] = [];
    const setActive = (tab: WorkspaceTab) => switched.push(tab);
    expect(cycleWorkspaceTab(1, ['queue', 'library'], null, setActive)).toBe(true);
    expect(switched).toEqual(['library']);
  });
});

describe('closeActiveRightPanel', () => {
  it('closes the active tab of the right panel', () => {
    const closed: WorkspaceTab[] = [];
    const panels = [
      makePanel({
        activeTab: 'details' as WorkspaceTab,
        tabs: [{ id: 'queue' as WorkspaceTab, icon: 'queue_music', label: 'Queue' }, { id: 'details' as WorkspaceTab, icon: 'info', label: 'Details' }]
      })
    ];
    closeActiveRightPanel(panels, (tab) => closed.push(tab));
    expect(closed).toEqual(['details']);
  });

  it('falls back to the first tab when nothing is active', () => {
    const closed: WorkspaceTab[] = [];
    const panels = [
      makePanel({
        activeTab: null,
        tabs: [{ id: 'queue' as WorkspaceTab, icon: 'queue_music', label: 'Queue' }, { id: 'details' as WorkspaceTab, icon: 'info', label: 'Details' }]
      })
    ];
    closeActiveRightPanel(panels, (tab) => closed.push(tab));
    expect(closed).toEqual(['queue']);
  });

  it('is a no-op when the right panel has no tabs', () => {
    const closed: WorkspaceTab[] = [];
    closeActiveRightPanel([], (tab) => closed.push(tab));
    expect(closed).toEqual([]);
  });
});
