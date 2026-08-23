import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TroubadourWorkbenchState } from './troubadour-controller';
import type { RenamePreviewRow } from './rename-job';

const { applyRename, publishTroubadourBatchResult } = vi.hoisted(() => ({
  applyRename: vi.fn(),
  publishTroubadourBatchResult: vi.fn()
}));

vi.mock('./rename-job', async (importOriginal) => ({
  ...await importOriginal<typeof import('./rename-job')>(),
  applyRename
}));
vi.mock('$lib/services/troubadour-sync', () => ({ publishTroubadourBatchResult }));
vi.mock('$lib/services/logging', () => ({ logInfo: vi.fn() }));

import { createTroubadourRenamePipeline } from './troubadour-rename';
import { createHistory } from './history';

function row(name: string): RenamePreviewRow {
  const file = new File(['audio'], name.replace('.flac', '.mp3'));
  return {
    id: 'item-1',
    file,
    fileHandle: {} as FileSystemFileHandle,
    parentHandle: {} as FileSystemDirectoryHandle,
    path: file.name,
    proposedBaseName: name.replace('.flac', ''),
    extension: 'flac',
    expectedLastModified: file.lastModified,
    expectedSize: file.size,
    proposedName: name,
    proposedPath: name,
    enabled: true,
    problems: [],
    warnings: []
  };
}

describe('Troubadour rename pipeline', () => {
  beforeEach(() => {
    applyRename.mockReset();
    publishTroubadourBatchResult.mockReset();
  });

  it('uses the refreshed preview after saving tags', async () => {
    const stale = row('Before.flac');
    const refreshed = row('After.flac');
    const state = {
      items: [{
        id: 'item-1',
        contextId: 'context-1',
        references: [],
        file: stale.file,
        fileHandle: stale.fileHandle,
        parentHandle: stale.parentHandle,
        path: stale.path,
        extension: 'mp3',
        kind: 'stream',
        state: 'ready',
        document: null,
        patch: {},
        artworkEdits: [],
        albumId: null,
        error: '',
        jobProgress: null
      }],
      albums: [],
      selectedIds: ['item-1']
    } as unknown as TroubadourWorkbenchState;
    const history = createHistory({ items: state.items, albums: state.albums });
    const saveSelectedOrAll = vi.fn(async () => []);
    const refreshPreview = vi.fn(async () => [refreshed]);
    applyRename.mockResolvedValue({
      id: refreshed.id,
      success: false,
      originalPath: refreshed.path,
      path: refreshed.path,
      name: refreshed.file.name,
      file: refreshed.file,
      fileHandle: refreshed.fileHandle,
      error: 'test stop'
    });
    const pipeline = createTroubadourRenamePipeline({
      state: () => state,
      history: () => history,
      setHistory: vi.fn(),
      setJob: vi.fn(),
      setStaged: vi.fn(),
      setState: vi.fn(),
      setBusyComplete: vi.fn(),
      saveSelectedOrAll,
      beginBatch: () => new AbortController().signal
    });

    await pipeline.applyRenamesAndPublish([stale], { saveFirst: true, refreshPreview });

    expect(saveSelectedOrAll).toHaveBeenCalledOnce();
    expect(refreshPreview).toHaveBeenCalledTimes(2);
    expect(applyRename).toHaveBeenCalledWith(refreshed, expect.any(AbortSignal), undefined);
  });
});
