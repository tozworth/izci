import { describe, expect, it, vi } from 'vitest';
import type { MediaEntity } from '$lib/contracts/catalog';
import type { CurrentMediaSourceHandle, ScannedLibraryFolderEntry } from './library-folder-plan';
import { planLibraryFolderReconciliation } from './library-folder-plan';

interface TestHandle extends FileSystemFileHandle {
  readonly entryKey: string;
}

function handle(
  entryKey: string,
  behavior: 'compare' | 'fail' | 'unavailable' = 'compare'
): TestHandle {
  const result = {
    kind: 'file',
    name: `${entryKey}.flac`,
    entryKey,
    getFile: vi.fn()
  } as unknown as TestHandle;
  if (behavior === 'compare') {
    result.isSameEntry = vi.fn(async (other) => (
      (other as TestHandle).entryKey === entryKey
    ));
  } else if (behavior === 'fail') {
    result.isSameEntry = vi.fn(async () => {
      throw new DOMException('stale handle');
    });
  } else {
    Object.defineProperty(result, 'isSameEntry', { value: undefined });
  }
  return result;
}

function entity(id: string, overrides: Partial<MediaEntity> = {}): MediaEntity {
  return {
    id,
    path: `Music/${id}.flac`,
    name: `${id}.flac`,
    format: 'flac',
    kind: 'stream',
    size: 100,
    lastModified: 1,
    ...overrides
  };
}

function scan(entityValue: MediaEntity, fileHandle: FileSystemFileHandle): ScannedLibraryFolderEntry {
  return { entity: entityValue, fileHandle };
}

function source(entityId: string, fileHandle: FileSystemFileHandle): CurrentMediaSourceHandle {
  return { entityId, fileHandle };
}

const baseOptions = {
  folderId: 'music-root',
  activeFolderIds: ['music-root', 'other-root']
} as const;

describe('managed-folder reconciliation planning', () => {
  it('keeps a stable exact-path scan on its durable identity and metadata', async () => {
    const current = entity('stable', {
      path: 'Music/Artist/Track.flac',
      name: 'Track.flac',
      sourceFolderId: 'music-root',
      metadata: { title: 'Kept', artist: 'Artist', playCount: 8 },
      rating: 4.5
    });
    const scannedHandle = handle('stable');

    const plan = await planLibraryFolderReconciliation({
      ...baseOptions,
      catalog: [current],
      scanned: [scan(entity('temporary', {
        path: '\\Music\\Artist\\Track.flac',
        name: 'Track.flac'
      }), scannedHandle)],
      currentSourceHandles: []
    });

    expect(plan.nextCatalog).toEqual([current]);
    expect(plan.nextCatalog[0]).toBe(current);
    expect(plan.addedItems).toEqual([]);
    expect(plan.updatedItems).toEqual([]);
    expect(plan.removedItems).toEqual([]);
    expect(plan.sourceRegistrations).toEqual([{
      entityId: 'stable',
      fileHandle: scannedHandle,
      permission: 'granted'
    }]);
    expect(plan.sourceDeletions).toEqual(['temporary']);
  });

  it('refreshes changed content while retaining the stable ID, rating, and only play count metadata', async () => {
    const current = entity('stable', {
      sourceFolderId: 'music-root',
      metadata: { title: 'Stale', duration: 10, playCount: 7 },
      rating: 3.5
    });

    const plan = await planLibraryFolderReconciliation({
      ...baseOptions,
      catalog: [current],
      scanned: [scan(entity('temporary', {
        path: current.path,
        size: 250,
        lastModified: 2,
        metadata: { title: 'Uncommitted scan metadata', playCount: 99 },
        rating: 1
      }), handle('stable'))],
      currentSourceHandles: []
    });

    expect(plan.updatedItems).toEqual([expect.objectContaining({
      id: 'stable',
      size: 250,
      lastModified: 2,
      metadata: { playCount: 7 },
      rating: 3.5
    })]);
    expect(plan.nextCatalog[0].metadata).toEqual({ playCount: 7 });
  });

  it('recognizes a move by handle and retains all existing metadata and rating', async () => {
    const currentHandle = handle('same-entry');
    const scannedHandle = handle('same-entry');
    const metadata = { title: 'Curated', album: 'Album', playCount: 4 };
    const current = entity('stable', {
      path: 'Music/Old.flac',
      name: 'Old.flac',
      sourceFolderId: 'music-root',
      metadata,
      rating: 5
    });

    const plan = await planLibraryFolderReconciliation({
      ...baseOptions,
      catalog: [current],
      scanned: [scan(entity('temporary', {
        path: 'Music/New.flac',
        name: 'New.flac'
      }), scannedHandle)],
      currentSourceHandles: [source('stable', currentHandle)]
    });

    expect(plan.nextCatalog).toEqual([{
      ...current,
      path: 'Music/New.flac',
      name: 'New.flac'
    }]);
    expect(plan.updatedItems[0].metadata).toBe(metadata);
    expect(plan.addedItems).toEqual([]);
    expect(plan.removedItems).toEqual([]);
    expect(currentHandle.isSameEntry).toHaveBeenCalledWith(scannedHandle);
  });

  it('recognizes a changed move but retains only the old play count metadata', async () => {
    const current = entity('stable', {
      path: 'Music/Old.flac',
      name: 'Old.flac',
      sourceFolderId: 'music-root',
      metadata: { title: 'Stale', playCount: 6 },
      rating: 2.5
    });

    const plan = await planLibraryFolderReconciliation({
      ...baseOptions,
      catalog: [current],
      scanned: [scan(entity('temporary', {
        path: 'Music/New.flac',
        name: 'New.flac',
        size: 101,
        lastModified: 2
      }), handle('same-entry'))],
      currentSourceHandles: [source('stable', handle('same-entry'))]
    });

    expect(plan.nextCatalog[0]).toMatchObject({
      id: 'stable',
      path: 'Music/New.flac',
      size: 101,
      metadata: { playCount: 6 },
      rating: 2.5
    });
    expect(plan.updatedItems).toHaveLength(1);
  });

  it('collapses case-insensitive duplicate scan paths with deterministic diagnostics', async () => {
    const upper = scan(entity('upper', {
      path: 'Music/ALBUM/Track.flac',
      name: 'Track.flac'
    }), handle('upper'));
    const lower = scan(entity('lower', {
      path: 'music/album/track.flac',
      name: 'track.flac',
      size: 200
    }), handle('lower'));

    const forward = await planLibraryFolderReconciliation({
      ...baseOptions,
      catalog: [],
      scanned: [lower, upper],
      currentSourceHandles: []
    });
    const reverse = await planLibraryFolderReconciliation({
      ...baseOptions,
      catalog: [],
      scanned: [upper, lower],
      currentSourceHandles: []
    });

    expect(forward.nextCatalog).toEqual(reverse.nextCatalog);
    expect(forward.nextCatalog.map((item) => item.id)).toEqual(['upper']);
    expect(forward.duplicates).toEqual([{
      identity: 'music/album/track.flac',
      kept: { entityId: 'upper', path: 'Music/ALBUM/Track.flac' },
      discarded: [{ entityId: 'lower', path: 'music/album/track.flac' }]
    }]);
    expect(forward.sourceDeletions).toEqual(['lower']);
  });

  it('removes only missing entities owned by the scanned folder', async () => {
    const missing = entity('missing', { sourceFolderId: 'music-root' });
    const other = entity('other', {
      path: 'Other/Track.flac',
      sourceFolderId: 'other-root'
    });
    const manual = entity('manual', { path: 'Loose/Track.flac' });

    const plan = await planLibraryFolderReconciliation({
      ...baseOptions,
      catalog: [missing, other, manual],
      scanned: [],
      currentSourceHandles: []
    });

    expect(plan.nextCatalog).toEqual([other, manual]);
    expect(plan.removedItems).toEqual([missing]);
    expect(plan.sourceDeletions).toEqual(['missing']);
  });

  it.each([
    ['unowned', undefined],
    ['inactive-folder', 'forgotten-root']
  ])('adopts an exact-path %s entity without replacing its durable identity', async (_label, sourceFolderId) => {
    const existing = entity('legacy', {
      path: 'Music/Track.flac',
      name: 'Track.flac',
      sourceFolderId,
      metadata: { title: 'Kept', playCount: 3 },
      rating: 4
    });

    const plan = await planLibraryFolderReconciliation({
      ...baseOptions,
      catalog: [existing],
      scanned: [scan(entity('temporary', {
        path: existing.path,
        name: existing.name
      }), handle('legacy'))],
      currentSourceHandles: []
    });

    expect(plan.addedItems).toEqual([]);
    expect(plan.nextCatalog).toEqual([{ ...existing, sourceFolderId: 'music-root' }]);
    expect(plan.updatedItems).toEqual([{ ...existing, sourceFolderId: 'music-root' }]);
  });

  it.each(['fail', 'unavailable'] as const)(
    'does not guess a move when isSameEntry is %s',
    async (behavior) => {
      const old = entity('old', {
        path: 'Music/Old.flac',
        name: 'Old.flac',
        sourceFolderId: 'music-root',
        metadata: { title: 'Must not transfer', playCount: 9 }
      });
      const fresh = entity('fresh', {
        path: 'Music/New.flac',
        name: 'New.flac'
      });

      const plan = await planLibraryFolderReconciliation({
        ...baseOptions,
        catalog: [old],
        scanned: [scan(fresh, handle('same-entry'))],
        currentSourceHandles: [source('old', handle('same-entry', behavior))]
      });

      expect(plan.addedItems).toEqual([{ ...fresh, sourceFolderId: 'music-root' }]);
      expect(plan.removedItems).toEqual([old]);
      expect(plan.nextCatalog).toEqual([{ ...fresh, sourceFolderId: 'music-root' }]);
    }
  );

  it('produces path-sorted additions regardless of discovery order', async () => {
    const scans = [
      scan(entity('z', { path: '\\Music\\Zulu.flac', name: 'Zulu.flac' }), handle('z')),
      scan(entity('a', { path: '/Music//alpha.flac', name: 'alpha.flac' }), handle('a')),
      scan(entity('m', { path: 'Music/Middle.flac', name: 'Middle.flac' }), handle('m'))
    ];

    const forward = await planLibraryFolderReconciliation({
      ...baseOptions,
      catalog: [],
      scanned: scans,
      currentSourceHandles: []
    });
    const reverse = await planLibraryFolderReconciliation({
      ...baseOptions,
      catalog: [],
      scanned: [...scans].reverse(),
      currentSourceHandles: []
    });

    expect(forward.nextCatalog).toEqual(reverse.nextCatalog);
    expect(forward.nextCatalog.map((item) => item.path)).toEqual([
      'Music/alpha.flac',
      'Music/Middle.flac',
      'Music/Zulu.flac'
    ]);
  });

  it('uses only an injected ID source to resolve a new-entity collision', async () => {
    const unrelated = entity('collision', {
      path: 'Other/Existing.flac',
      sourceFolderId: 'other-root'
    });
    const createId = vi.fn(() => 'allocated');

    const plan = await planLibraryFolderReconciliation({
      ...baseOptions,
      catalog: [unrelated],
      scanned: [scan(entity('collision', { path: 'Music/New.flac' }), handle('new'))],
      currentSourceHandles: [],
      createId
    });

    expect(createId).toHaveBeenCalledOnce();
    expect(plan.addedItems[0].id).toBe('allocated');
    expect(plan.nextCatalog.map((item) => item.id)).toEqual(['collision', 'allocated']);
    expect(plan.sourceDeletions).toEqual([]);
  });
});
