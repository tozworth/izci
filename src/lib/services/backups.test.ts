import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BACKUP_FORMAT_VERSION,
  decodeBackupArchive,
  encodeBackupArchive,
  restoreBackupArchive,
  type BackupArchiveData
} from './backups';
import { createPersistentStore } from '$lib/stores/persistent-store';

function archive(overrides: Partial<BackupArchiveData> = {}): BackupArchiveData {
  return {
    manifest: {
      kind: 'izci-backup',
      formatVersion: BACKUP_FORMAT_VERSION,
      createdAt: '2026-07-26T12:00:00.000Z',
      appVersion: '0.2.1',
      sourceOrigin: 'http://localhost:5173',
      contents: {
        settings: 1,
        libraryTracks: 1,
        folders: 1,
        favorites: 0,
        playbackProgress: 1
      }
    },
    settings: {
      'izci.playback-settings': { logarithmicVolume: true },
      'izci.file-launch.primary.v1': { owner: 'transient-window' }
    },
    library: [
      {
        id: 'track-1',
        name: 'Track.flac',
        extension: 'flac',
        kind: 'stream',
        size: 123,
        lastModified: 456,
        path: 'Music/Album/Track.flac',
        sourceFolderId: 'folder-1',
        metadata: { title: 'Track', playCount: 7, lastPlayed: 456 },
        rating: 3.5
      }
    ],
    folders: [
      {
        id: 'folder-1',
        name: 'Music',
        addedAt: 123,
        libraryMode: 'launch'
      }
    ],
    favorites: [],
    progress: [
      {
        identity: 'path:music/album/track.flac:123:456:subsong:all',
        currentTime: 42,
        duration: 240,
        updatedAt: 789
      }
    ],
    ...overrides
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('izci backup archives', () => {
  it('round-trips portable settings and library data through a zip', () => {
    const decoded = decodeBackupArchive(encodeBackupArchive(archive()));

    expect(decoded.manifest.sourceOrigin).toBe('http://localhost:5173');
    expect(decoded.settings).toEqual({
      'izci.playback-settings': { logarithmicVolume: true }
    });
    expect(decoded.library[0]).toMatchObject({
      id: 'track-1',
      path: 'Music/Album/Track.flac',
      metadata: { title: 'Track', playCount: 7, lastPlayed: 456 },
      rating: 3.5
    });
    expect(decoded.folders[0]).toMatchObject({ id: 'folder-1', libraryMode: 'launch' });
    expect(decoded.progress[0]).toMatchObject({ currentTime: 42, duration: 240 });
  });

  it('rejects archives from an unsupported format version', () => {
    const data = archive();
    data.manifest.formatVersion += 1;

    expect(() => decodeBackupArchive(encodeBackupArchive(data))).toThrow('unsupported-version');
  });

  it('rejects bytes that are not an izci backup zip', () => {
    expect(() => decodeBackupArchive(new Uint8Array([1, 2, 3]))).toThrow('invalid-backup');
  });

  it('updates stores in the window performing a settings restore', async () => {
    const values = new Map<string, string>();
    const storageListeners: Array<(event: Pick<StorageEvent, 'key'>) => void> = [];
    const indexedDB = {
      open: () => {
        const request: {
          result: IDBDatabase;
          onupgradeneeded: ((event: IDBVersionChangeEvent) => unknown) | null;
          onsuccess: ((event: Event) => unknown) | null;
          onerror: ((event: Event) => unknown) | null;
        } = {
          result: null as unknown as IDBDatabase,
          onupgradeneeded: null,
          onsuccess: null,
          onerror: null
        };
        const database = {
          objectStoreNames: { contains: () => false },
          createObjectStore: () => ({}),
          transaction: () => {
            const transaction: {
              objectStore: () => IDBObjectStore;
              error: DOMException | null;
              oncomplete: ((event: Event) => unknown) | null;
              onerror: ((event: Event) => unknown) | null;
              onabort: ((event: Event) => unknown) | null;
            } = {
              objectStore: () => ({ put: () => ({}) }) as unknown as IDBObjectStore,
              error: null,
              oncomplete: null,
              onerror: null,
              onabort: null
            };
            queueMicrotask(() => transaction.oncomplete?.(new Event('complete')));
            return transaction as unknown as IDBTransaction;
          },
          close: () => {}
        } as unknown as IDBDatabase;
        queueMicrotask(() => {
          request.result = database;
          request.onupgradeneeded?.(new Event('upgradeneeded') as IDBVersionChangeEvent);
          request.onsuccess?.(new Event('success'));
        });
        return request as unknown as IDBOpenDBRequest;
      }
    };
    class TestStorageEvent extends Event {
      readonly key: string | null;
      constructor(type: string, init: { key?: string | null } = {}) {
        super(type);
        this.key = init.key ?? null;
      }
    }
    vi.stubGlobal('StorageEvent', TestStorageEvent);
    vi.stubGlobal('window', {
      indexedDB,
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key)
      },
      addEventListener: (type: string, listener: (event: Pick<StorageEvent, 'key'>) => void) => {
        if (type === 'storage') storageListeners.push(listener);
      },
      dispatchEvent: (event: StorageEvent) => {
        for (const listener of storageListeners) listener(event);
        return true;
      }
    });

    const store = createPersistentStore({
      storageKey: 'izci.playback-settings',
      channelName: 'test-backup-settings',
      defaultValue: { logarithmicVolume: false },
      normalize: (value: unknown) => ({
        logarithmicVolume: Boolean((value as { logarithmicVolume?: unknown } | null)?.logarithmicVolume)
      })
    });
    expect(store.getSnapshot()).toEqual({ logarithmicVolume: false });

    const bytes = encodeBackupArchive(archive({
      settings: { 'izci.playback-settings': { logarithmicVolume: true } },
      library: [],
      folders: [],
      favorites: [],
      progress: []
    }));
    const file = { arrayBuffer: async () => bytes.buffer } as File;

    await restoreBackupArchive(file);

    expect(store.getSnapshot()).toEqual({ logarithmicVolume: true });
  });
});
