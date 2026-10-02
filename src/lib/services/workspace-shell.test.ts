import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspaceShellController } from './workspace-shell';
import { workspacePanelState } from '$lib/stores/workspace-panel-state';

afterEach(() => workspacePanelState.reset());

describe('Visualizer docking', () => {
  it('opens, moves, closes, and reopens in the remembered panel without changing the collection', () => {
    const shell = createWorkspaceShellController({ getQueueContextActions: () => [], getLibraryContextActions: () => [] });
    shell.sync({
      innerWidth: 1600, queueItems: [], libraryItems: [], favoriteItems: [],
      queueSelectionIds: [], librarySelectionIds: [], librarySelectionAnchorId: null,
      favoriteSelectionIds: [], favoriteSelectionAnchorId: null, favoritePlayingId: null,
      playingTrackId: null, shuffleEnabled: false, repeatMode: 'off', keepEmptyWorkspacePanelsOpen: false
    });
    try {
      shell.showWorkspaceTab('visualizer');
      expect(shell.getSnapshot().workspaceTabs.find((tab) => tab.id === 'visualizer')?.label).toBe('Visualizer');
      expect(workspacePanelState.getSnapshot().panels.center).toContain('visualizer');
      shell.moveWorkspaceTab({ tabId: 'visualizer', sourcePanelId: 'center', targetPanelId: 'right', position: 'end' });
      expect(workspacePanelState.getSnapshot().lastPanelByTab.visualizer).toBe('right');
      shell.closeWorkspaceTab('visualizer');
      expect(shell.getSnapshot().workspaceTabs.some((tab) => tab.id === 'visualizer')).toBe(false);
      shell.showWorkspaceTab('visualizer');
      expect(workspacePanelState.getSnapshot().panels.right).toEqual(['visualizer']);
      expect(shell.getSnapshot().activeWorkspaceTab).toBe('visualizer');
      expect(shell.getSnapshot().activeCollection).toBe('queue');
    } finally {
      shell.destroy();
    }
  });
});
