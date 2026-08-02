import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspaceShellController } from './workspace-shell';
import { workspacePanelState } from '$lib/stores/workspace-panel-state';
import { libraryViewSettings } from '$lib/stores/library-view-settings';

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
      getPlaylistContextActions: () => [],
      getLibraryContextActions: () => []
    });
    controller.sync({
      innerWidth: 1200,
      playlistItems: [],
      libraryItems: [],
      favoriteItems: [],
      playlistSelectionIds: [],
      librarySelectionIds: [],
      librarySelectionAnchorId: null,
      favoriteSelectionIds: [],
      favoriteSelectionAnchorId: null,
      favoritePlayingId: null,
      playingTrackId: null,
      shuffleEnabled: false,
      repeatMode: 'off',
      keepEmptyWorkspacePanelsOpen: false
    });
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
});
