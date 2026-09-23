import { describe, expect, it, vi } from 'vitest';
import type { TrackItem } from '$lib/types';
import { createFreeplayUiActions } from './freeplay-ui-actions';

const track = (id: string): TrackItem => ({
  id, name: id, extension: 'opus', kind: 'stream', size: 1, lastModified: 1
});

describe('shared multiplayer context actions', () => {
  it('routes remote queue and library actions through host commands', () => {
    const sendCommand = vi.fn();
    const actions = createFreeplayUiActions({
      getIsFreeplayClient: () => false,
      getFreeplayQueue: () => [],
      setFreeplayQueue: vi.fn(),
      sendCommand,
      getShuffleEnabled: () => false,
      getQueueItems: () => [track('queued')],
      getLibraryItems: () => [track('library')],
      getFavoriteItems: () => [],
      getActiveView: () => 'allMedia',
      copyTrackFilenames: vi.fn(async () => undefined),
      showLibraryGroup: vi.fn(),
      showTrackDetails: vi.fn(),
      activateTrack: vi.fn(() => true)
    });

    actions.handleQueueContextAction('play-next', ['queued']);
    actions.handleQueueContextAction('remove', ['queued']);
    actions.handleQueueContextAction('randomize-queue', ['queued']);
    actions.handleLibraryContextAction('add-to-queue', ['library']);
    actions.handleLibraryContextAction('replace-queue', ['library']);
    actions.handleLibraryContextAction('play-next', ['library']);

    expect(sendCommand.mock.calls.map(([command]) => command)).toEqual([
      { type: 'queue.play-next', collection: 'queue', itemIds: ['queued'] },
      { type: 'queue.remove', itemIds: ['queued'] },
      { type: 'queue.randomize' },
      { type: 'queue.add', itemIds: ['library'] },
      { type: 'queue.replace', itemIds: ['library'] },
      { type: 'queue.play-next', collection: 'library', itemIds: ['library'] }
    ]);
  });
});
