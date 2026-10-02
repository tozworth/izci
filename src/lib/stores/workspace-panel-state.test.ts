import { afterEach, describe, expect, it } from 'vitest';
import { getDefaultWorkspacePanelForTab, workspacePanelState } from './workspace-panel-state';

afterEach(() => workspacePanelState.reset());

describe('Visualizer workspace tab persistence', () => {
  it('restores the tab, active panel, order, and remembered docking position', () => {
    const state = workspacePanelState.update({
      panels: { left: ['queue'], center: ['library'], right: ['visualizer'] },
      activeWorkspaceTab: 'visualizer',
      activeTabsByPanel: { left: 'queue', center: 'library', right: 'visualizer' },
      lastPanelByTab: { ...workspacePanelState.getSnapshot().lastPanelByTab, visualizer: 'right' },
      tabbedTabOrder: ['queue', 'visualizer', 'library']
    });
    expect(workspacePanelState.set(JSON.parse(JSON.stringify(state)))).toMatchObject({
      panels: { right: ['visualizer'] }, activeWorkspaceTab: 'visualizer',
      activeTabsByPanel: { right: 'visualizer' }, lastPanelByTab: { visualizer: 'right' },
      tabbedTabOrder: ['queue', 'visualizer', 'library']
    });
    expect(getDefaultWorkspacePanelForTab('visualizer')).toBe('center');
  });
});
