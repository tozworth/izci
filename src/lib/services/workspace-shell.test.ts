import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspaceShellController } from './workspace-shell';
import type { TrackItem, WorkspaceCollection, WorkspaceResizeHandle } from '$lib/types';
import { workspacePanelState } from '$lib/stores/workspace-panel-state';
import { libraryViewSettings } from '$lib/stores/library-view-settings';

type SelectionCall =
  | ['clear', WorkspaceCollection]
  | ['select', WorkspaceCollection, string]
  | ['set', WorkspaceCollection]
  | ['selectAll', WorkspaceCollection];

function createSelectionCalls() {
  const calls: SelectionCall[] = [];

  return {
    calls,
    collectionSelection: {
      clear: (collection: WorkspaceCollection) => {
        calls.push(['clear', collection]);
      },
      select: (collection: WorkspaceCollection, id: string) => {
        calls.push(['select', collection, id]);
      },
      set: (collection: WorkspaceCollection) => {
        calls.push(['set', collection]);
      },
      selectAll: (collection: WorkspaceCollection) => {
        calls.push(['selectAll', collection]);
      }
    }
  };
}

function createShellInputs(overrides: Record<string, unknown> = {}) {
  return {
    innerWidth: 1200,
    queueItems: [],
    libraryItems: [],
    favoriteItems: [],
    queueSelectionIds: [],
    librarySelectionIds: [],
    librarySelectionAnchorId: null,
    favoriteSelectionIds: [],
    favoriteSelectionAnchorId: null,
    favoritePlayingId: null,
    playingTrackId: null,
    shuffleEnabled: false,
    repeatMode: 'off' as const,
    keepEmptyWorkspacePanelsOpen: false,
    ...overrides
  };
}

function createPointerEvent(clientX: number): PointerEvent {
  let prevented = false;

  return {
    clientX,
    preventDefault: () => {
      prevented = true;
    },
    get prevented() {
      return prevented;
    }
  } as unknown as PointerEvent & { prevented: boolean };
}

describe('workspace shell library navigation', () => {
  beforeEach(() => {
    workspacePanelState.reset();
    libraryViewSettings.reset();
  });

  afterEach(() => {
    workspacePanelState.reset();
    libraryViewSettings.reset();
  });

  it('keeps request tokens increasing after handled requests are cleared', () => {
    const controller = createWorkspaceShellController({
      getQueueContextActions: () => [],
      getLibraryContextActions: () => []
    });
    controller.sync(createShellInputs());
    const target = {
      view: 'albums' as const,
      groupKey: 'albums:album\u0000artist',
      trackId: 'library-track'
    };

    controller.showLibraryGroup(target);
    const firstToken = controller.getSnapshot().libraryGroupRequest?.token;
    expect(firstToken).toBe(1);

    controller.clearLibraryGroupRequest(firstToken!);
    expect(controller.getSnapshot().libraryGroupRequest).toBeNull();

    controller.showLibraryGroup(target);
    expect(controller.getSnapshot().libraryGroupRequest?.token).toBe(2);

    controller.destroy();
  });

  it('opens track details as the active tab and restores the queue on close', () => {
    const controller = createWorkspaceShellController({
      getQueueContextActions: () => [],
      getLibraryContextActions: () => []
    });
    controller.sync(createShellInputs());

    controller.showTrackDetails();
    let snapshot = controller.getSnapshot();
    expect(snapshot.activeWorkspaceTab).toBe('details');
    expect(snapshot.isDetailsPanelVisible).toBe(true);
    expect(snapshot.isRightPanelVisible).toBe(true);
    expect(snapshot.workspaceTabs.map((tab) => tab.id)).toContain('details');

    controller.closeTrackDetails();
    snapshot = controller.getSnapshot();
    expect(snapshot.activeWorkspaceTab).toBe('queue');
    expect(snapshot.isDetailsPanelVisible).toBe(false);
    expect(snapshot.isRightPanelVisible).toBe(false);
    expect(snapshot.workspaceTabs.map((tab) => tab.id)).toEqual(['queue', 'library']);

    controller.destroy();
  });

  it('focuses the library collection and reports keyboard focus through panel props', () => {
    const controller = createWorkspaceShellController({
      getQueueContextActions: () => [],
      getLibraryContextActions: () => []
    });
    controller.sync(createShellInputs());

    controller.focusCollection('library');
    const snapshot = controller.getSnapshot();
    expect(snapshot.activeCollection).toBe('library');
    expect(snapshot.activeWorkspaceTab).toBe('library');
    expect(snapshot.libraryPanelProps.keyboardActive).toBe(true);
    expect(snapshot.queuePanelProps.keyboardActive).toBe(false);

    const before = controller.getSnapshot();
    controller.focusCollection('library');
    expect(controller.getSnapshot()).toBe(before);

    controller.destroy();
  });

  it('publishes an empty queue immediately through the focused collection update', () => {
    const controller = createWorkspaceShellController({
      getQueueContextActions: () => [],
      getLibraryContextActions: () => []
    });
    const queueItem = {
      id: 'only-track',
      name: 'only-track.mp3',
      extension: 'mp3',
      kind: 'stream',
      size: 1,
      lastModified: 1
    } satisfies TrackItem;
    controller.sync(createShellInputs({ queueItems: [queueItem] }));

    controller.syncQueueItems([]);

    expect(controller.getSnapshot().queuePanelProps.items).toEqual([]);
    controller.destroy();
  });

  it('routes track selection through the adapter and clears the other collection', () => {
    const { calls, collectionSelection } = createSelectionCalls();
    const controller = createWorkspaceShellController({
      getQueueContextActions: () => [],
      getLibraryContextActions: () => [],
      collectionSelection
    });
    controller.sync(createShellInputs({ queueSelectionIds: ['q1'] }));

    controller.selectTrack('library', 'l1');

    expect(calls).toContainEqual(['clear', 'queue']);
    expect(calls).toContainEqual(['select', 'library', 'l1']);
    expect(controller.getSnapshot().activeCollection).toBe('library');

    controller.destroy();
  });

  it('collapses side panels into compact mode on narrow viewports', () => {
    const controller = createWorkspaceShellController({
      getQueueContextActions: () => [],
      getLibraryContextActions: () => []
    });
    controller.sync(createShellInputs({ innerWidth: 500 }));

    const snapshot = controller.getSnapshot();
    expect(snapshot.collapsedWorkspacePanels).toEqual(['left']);
    expect(snapshot.visibleWorkspacePanels).toEqual(['center']);
    expect(snapshot.isCompactWorkspace).toBe(true);
    expect(snapshot.widePanelWidths.left).toBe(0);
    expect(snapshot.widePanelWidths.center).toBeGreaterThan(0);

    controller.destroy();
  });

  it('guards resize handles against invisible panels and tracks resize state', () => {
    const controller = createWorkspaceShellController({
      getQueueContextActions: () => [],
      getLibraryContextActions: () => []
    });
    controller.sync(createShellInputs());

    const hiddenHandle: WorkspaceResizeHandle = { before: 'center', after: 'right' };
    const hiddenEvent = createPointerEvent(100);
    controller.beginPanelResize(hiddenEvent, hiddenHandle);
    expect(controller.getSnapshot().isResizing).toBe(false);
    expect((hiddenEvent as PointerEvent & { prevented: boolean }).prevented).toBe(false);

    const visibleHandle: WorkspaceResizeHandle = { before: 'left', after: 'center' };
    const visibleEvent = createPointerEvent(200);
    controller.beginPanelResize(visibleEvent, visibleHandle);
    expect(controller.getSnapshot().isResizing).toBe(true);
    expect((visibleEvent as PointerEvent & { prevented: boolean }).prevented).toBe(true);

    controller.endPanelResize();
    expect(controller.getSnapshot().isResizing).toBe(false);

    controller.destroy();
  });
});
