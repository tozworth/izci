import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceShellController } from './workspace-shell';
import { workspacePanelState } from '$lib/stores/workspace-panel-state';
import { normalizePlaybackSettings } from '$lib/stores/playback-settings';
import type { WorkspaceTabFocusMode } from '$lib/types';

afterEach(() => workspacePanelState.reset());

describe('Queue focus on track change', () => {
  it.each<{
    mode: WorkspaceTabFocusMode;
    initiallyOpen: boolean;
    focused: boolean;
    open: boolean;
  }>([
    { mode: 'off', initiallyOpen: true, focused: false, open: true },
    { mode: 'off', initiallyOpen: false, focused: false, open: false },
    { mode: 'focus-only', initiallyOpen: true, focused: true, open: true },
    { mode: 'focus-only', initiallyOpen: false, focused: false, open: false },
    { mode: 'open-and-focus', initiallyOpen: true, focused: true, open: true },
    { mode: 'open-and-focus', initiallyOpen: false, focused: true, open: true }
  ])('$mode with Queue open=$initiallyOpen', ({ mode, initiallyOpen, focused, open }) => {
    const select = vi.fn();
    const shell = createWorkspaceShellController({
      getQueueContextActions: () => [], getLibraryContextActions: () => [],
      collectionSelection: { clear: vi.fn(), select, set: vi.fn(), selectAll: vi.fn() }
    });
    shell.sync({
      innerWidth: 1600, queueItems: [], libraryItems: [], favoriteItems: [],
      queueSelectionIds: [], librarySelectionIds: [], librarySelectionAnchorId: null,
      favoriteSelectionIds: [], favoriteSelectionAnchorId: null, favoritePlayingId: null,
      playingTrackId: null, shuffleEnabled: false, repeatMode: 'off', keepEmptyWorkspacePanelsOpen: false
    });
    try {
      shell.setActiveWorkspaceTab('library');
      // Remember the non-default panel when reopening a closed Queue tab.
      shell.moveWorkspaceTab({ tabId: 'queue', sourcePanelId: 'left', targetPanelId: 'right', position: 'end' });
      shell.setActiveWorkspaceTab('library');
      if (!initiallyOpen) shell.closeWorkspaceTab('queue');
      const previousPanelState = workspacePanelState.getSnapshot();

      shell.selectTrack('queue', 'next-track', { focus: mode });

      expect(select).toHaveBeenCalledWith('queue', 'next-track', {});
      expect(shell.getSnapshot().activeWorkspaceTab).toBe(focused ? 'queue' : 'library');
      expect(shell.getSnapshot().activeCollection).toBe(focused ? 'queue' : 'library');
      expect(shell.getSnapshot().queuePanelProps.keyboardActive).toBe(focused);
      expect(workspacePanelState.getSnapshot().panels.right.includes('queue')).toBe(open);
      if (!focused) expect(workspacePanelState.getSnapshot()).toEqual(previousPanelState);

      // Explicit Queue navigation still opens and focuses it in every mode.
      shell.closeWorkspaceTab('queue');
      shell.showQueueTrack('next-track');
      expect(shell.getSnapshot().activeWorkspaceTab).toBe('queue');
      expect(workspacePanelState.getSnapshot().panels.right).toContain('queue');
    } finally {
      shell.destroy();
    }
  });

  it('defaults to opening and focusing Queue for missing or invalid settings', () => {
    expect(normalizePlaybackSettings({}).focusQueueOnTrackChange).toBe('open-and-focus');
    expect(normalizePlaybackSettings({ focusQueueOnTrackChange: 'invalid' }).focusQueueOnTrackChange).toBe('open-and-focus');
    for (const mode of ['off', 'focus-only', 'open-and-focus']) {
      expect(normalizePlaybackSettings({ focusQueueOnTrackChange: mode }).focusQueueOnTrackChange).toBe(mode);
    }
  });
});

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
