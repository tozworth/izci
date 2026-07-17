import { describe, expect, it } from 'vitest';
import { filesystemFolders } from '$lib/services/filesystem-folders';
import type { PlaylistItem } from '$lib/types';
import { materializePlaylistItem } from './playlist-materialization';

describe('managed-folder materialization', () => {
  it('resolves a nested path from the remembered root without a persisted file handle', async () => {
    const file = new File(['module'], 'Track.mod');
    const fileHandle = {
      kind: 'file',
      name: file.name,
      getFile: async () => file
    } as FileSystemFileHandle;
    const albumHandle = {
      kind: 'directory',
      name: 'Album',
      getFileHandle: async (name: string) => {
        if (name !== file.name) throw new DOMException('Missing', 'NotFoundError');
        return fileHandle;
      }
    } as unknown as FileSystemDirectoryHandle;
    const rootHandle = {
      kind: 'directory',
      name: 'Music',
      queryPermission: async () => 'granted',
      async *values() {},
      getDirectoryHandle: async (name: string) => {
        if (name !== 'Album') throw new DOMException('Missing', 'NotFoundError');
        return albumHandle;
      }
    } as unknown as FileSystemDirectoryHandle;
    const folder = await filesystemFolders.remember(rootHandle, { libraryMode: 'manual' });
    const item: PlaylistItem = {
      id: 'managed-track',
      sourceFolderId: folder.id,
      path: 'Music/Album/Track.mod',
      name: 'Track.mod',
      extension: 'mod',
      kind: 'module',
      size: null,
      lastModified: null
    };

    await expect(materializePlaylistItem(item)).resolves.toMatchObject({
      id: 'managed-track',
      file,
      fileHandle,
      size: file.size,
      lastModified: file.lastModified,
      kind: 'module'
    });
  });

  it('rejects traversal components', async () => {
    const rootHandle = {
      kind: 'directory',
      name: 'Safe',
      queryPermission: async () => 'granted',
      async *values() {},
      getDirectoryHandle: async () => {
        throw new Error('must not walk');
      }
    } as unknown as FileSystemDirectoryHandle;
    const folder = await filesystemFolders.remember(rootHandle, { libraryMode: 'manual' });

    await expect(materializePlaylistItem({
      id: 'unsafe',
      sourceFolderId: folder.id,
      path: 'Safe/../Track.mod',
      name: 'Track.mod',
      extension: 'mod',
      kind: 'module',
      size: null,
      lastModified: null
    })).resolves.toBeNull();
  });
});
