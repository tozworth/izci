import { describe, expect, it, vi } from 'vitest';
import { createFreeplayController } from './freeplay-controller';
import type { PlaylistItem } from '$lib/types';

function item(id: string, path: string): PlaylistItem {
  return {
    id,
    path,
    name: id,
    extension: 'flac',
    kind: 'stream',
    size: 100,
    lastModified: 0,
    metadata: {
      artist: 'Test Artist',
      title: id
    }
  } as PlaylistItem;
}

function createHarness(overrides: Partial<{
  isMultiplayerClient: boolean;
  isFreeplayClient: boolean;
  freeplayQueue: string[];
  remoteShuffleEnabled: boolean;
  playlistItems: PlaylistItem[];
  libraryItems: PlaylistItem[];
  favoriteItems: PlaylistItem[];
  activeViewIsFavorites: boolean;
}> = {}) {
  const state = {
    isMultiplayerClient: true,
    isFreeplayClient: true,
    freeplayQueue: [] as string[],
    remoteShuffleEnabled: false,
    playlistItems: [item('p1', 'a.flac'), item('p2', 'b.flac')],
    libraryItems: [item('l1', 'c.flac'), item('l2', 'd.flac')],
    favoriteItems: [item('f1', 'e.flac')],
    activeViewIsFavorites: false,
    ...overrides
  };
  const setFreeplayQueue = vi.fn((itemIds: string[]) => {
    state.freeplayQueue = itemIds;
  });
  const sendCommand = vi.fn(() => true);
  const showTrackDetails = vi.fn();
  const showLibraryGroup = vi.fn();
  const controller = createFreeplayController({
    getState: () => state,
    session: { sendCommand, setFreeplayQueue },
    handlers: { showTrackDetails, showLibraryGroup }
  });
  return { state, setFreeplayQueue, sendCommand, showTrackDetails, showLibraryGroup, controller };
}

describe('freeplay controller', () => {
  it('activateTrack is a no-op when not a multiplayer client', () => {
    const { controller, sendCommand } = createHarness({ isMultiplayerClient: false });
    expect(controller.activateTrack('playlist', 'p1')).toBe(false);
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it('activateTrack sends a collection.activate command on a client', () => {
    const { controller, sendCommand } = createHarness();
    expect(controller.activateTrack('library', 'l1')).toBe(true);
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'collection.activate',
      collection: 'library',
      itemId: 'l1'
    });
  });

  it('addToQueue appends ids not already queued', () => {
    const { controller, setFreeplayQueue } = createHarness({ freeplayQueue: ['p1'] });
    controller.addToQueue(['p1', 'p2']);
    expect(setFreeplayQueue).toHaveBeenCalledWith(['p1', 'p2']);
  });

  it('addToQueue is a no-op for an empty selection', () => {
    const { controller, setFreeplayQueue } = createHarness();
    controller.addToQueue([]);
    expect(setFreeplayQueue).not.toHaveBeenCalled();
  });

  it('removeFromQueue filters the removed ids', () => {
    const { controller, setFreeplayQueue } = createHarness({ freeplayQueue: ['p1', 'p2'] });
    controller.removeFromQueue(['p1']);
    expect(setFreeplayQueue).toHaveBeenCalledWith(['p2']);
  });

  it('playlist remove action removes from the queue', () => {
    const { controller, setFreeplayQueue } = createHarness({ freeplayQueue: ['p1', 'p2'] });
    controller.handlePlaylistContextAction('remove', ['p1']);
    expect(setFreeplayQueue).toHaveBeenCalledWith(['p2']);
  });

  it('playlist track-details action shows track details for a single selection', () => {
    const { controller, showTrackDetails } = createHarness();
    controller.handlePlaylistContextAction('track-details', ['p1']);
    expect(showTrackDetails).toHaveBeenCalledOnce();
  });

  it('library add-to-playlist action queues tracks', () => {
    const { controller, setFreeplayQueue } = createHarness();
    controller.handleLibraryContextAction('add-to-playlist', ['l1', 'l2']);
    expect(setFreeplayQueue).toHaveBeenCalledWith(['l1', 'l2']);
  });

  it('library shuffle-play action replaces the queue, toggles shuffle, and activates', () => {
    const { controller, setFreeplayQueue, sendCommand } = createHarness();
    controller.handleLibraryContextAction('shuffle-play', ['l1']);
    expect(setFreeplayQueue).toHaveBeenCalledWith(['l1']);
    expect(sendCommand).toHaveBeenCalledWith({ type: 'playlist.shuffle' });
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'collection.activate',
      collection: 'playlist',
      itemId: 'l1'
    });
  });

  it('library replace-playlist action skips the shuffle toggle when shuffle is already on', () => {
    const { controller, sendCommand } = createHarness({ remoteShuffleEnabled: true });
    controller.handleLibraryContextAction('replace-playlist', ['l1']);
    expect(sendCommand).not.toHaveBeenCalledWith({ type: 'playlist.shuffle' });
    expect(sendCommand).toHaveBeenCalledWith({
      type: 'collection.activate',
      collection: 'playlist',
      itemId: 'l1'
    });
  });

  it('library navigation actions route through showLibraryGroup for a single track', () => {
    const { controller, showLibraryGroup } = createHarness({
      libraryItems: [item('l1', 'c.flac'), item('l2', 'd.flac')]
    });
    // The freeplay library menu exposes go-to-library actions for single tracks.
    controller.handleLibraryContextAction('go-to-library-artist', ['l1']);
    expect(showLibraryGroup).toHaveBeenCalledOnce();
  });

  it('uses the favorites collection when the library view is on favorites', () => {
    const { controller, setFreeplayQueue } = createHarness({ activeViewIsFavorites: true });
    controller.handleLibraryContextAction('add-to-playlist', ['f1']);
    expect(setFreeplayQueue).toHaveBeenCalledWith(['f1']);
  });
});
