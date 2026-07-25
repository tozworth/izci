import { describe, expect, it, vi } from 'vitest';
import {
  getDroppedDirectoryHandles,
  queryFilesystemFolderPermission,
  resolveFilesystemFileLocation,
  type FilesystemFolder
} from './filesystem-folders';

function directoryHandle(overrides: Partial<FileSystemDirectoryHandle> = {}): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: 'Music',
    async *values() {},
    ...overrides
  } as FileSystemDirectoryHandle;
}

function rememberedFolder(
  id: string,
  name: string,
  handle: FileSystemDirectoryHandle
): FilesystemFolder {
  return {
    id,
    name,
    handle,
    addedAt: 1,
    permission: 'granted',
    libraryMode: null,
    lastScanStatus: 'never'
  };
}

describe('filesystem folder helpers', () => {
  it('reports permission state without probing folders that are not granted', async () => {
    const values = vi.fn(() => ({ next: async () => ({ done: true, value: undefined }) }));
    const handle = directoryHandle({
      queryPermission: async () => 'prompt',
      values: values as unknown as FileSystemDirectoryHandle['values']
    });

    await expect(queryFilesystemFolderPermission(handle)).resolves.toBe('prompt');
    expect(values).not.toHaveBeenCalled();
  });

  it('marks granted handles unavailable when their directory cannot be enumerated', async () => {
    const handle = directoryHandle({
      queryPermission: async () => 'granted',
      values: (() => ({
        next: async () => {
          throw new DOMException('Missing', 'NotFoundError');
        }
      })) as unknown as FileSystemDirectoryHandle['values']
    });

    await expect(queryFilesystemFolderPermission(handle)).resolves.toBe('unavailable');
  });

  it('collects only reusable directory handles from a drop', async () => {
    const folder = directoryHandle();
    const file = { kind: 'file', name: 'Track.flac', getFile: async () => new File([], 'Track.flac') };
    const dataTransfer = {
      items: [
        { getAsFileSystemHandle: async () => folder },
        { getAsFileSystemHandle: async () => file },
        { getAsFileSystemHandle: async () => null }
      ]
    } as unknown as DataTransfer;

    await expect(getDroppedDirectoryHandles(dataTransfer)).resolves.toEqual([folder]);
  });

  it('resolves a launched file to its unique remembered folder and canonical path', async () => {
    const track = {
      kind: 'file',
      name: 'Track.flac',
      getFile: async () => new File([], 'Track.flac')
    } as FileSystemFileHandle;
    const music = rememberedFolder('music-id', 'Music', directoryHandle({
      resolve: async (candidate) => candidate === track ? ['Artist', 'Track.flac'] : null
    }));
    const other = rememberedFolder('other-id', 'Other', directoryHandle({
      name: 'Other',
      resolve: async () => null
    }));

    await expect(resolveFilesystemFileLocation(track, [music, other])).resolves.toEqual({
      folderId: 'music-id',
      path: 'Music/Artist/Track.flac'
    });
  });

  it('does not guess when a launched file belongs to multiple remembered roots', async () => {
    const track = {
      kind: 'file',
      name: 'Track.flac',
      getFile: async () => new File([], 'Track.flac')
    } as FileSystemFileHandle;
    const parent = rememberedFolder('parent-id', 'Music', directoryHandle({
      resolve: async () => ['Album', 'Track.flac']
    }));
    const nested = rememberedFolder('nested-id', 'Album', directoryHandle({
      name: 'Album',
      resolve: async () => ['Track.flac']
    }));

    await expect(resolveFilesystemFileLocation(track, [parent, nested])).resolves.toBeNull();
  });
});
