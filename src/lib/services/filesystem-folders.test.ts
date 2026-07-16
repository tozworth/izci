import { describe, expect, it, vi } from 'vitest';
import {
  getDroppedDirectoryHandles,
  queryFilesystemFolderPermission
} from './filesystem-folders';

function directoryHandle(overrides: Partial<FileSystemDirectoryHandle> = {}): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name: 'Music',
    async *values() {},
    ...overrides
  } as FileSystemDirectoryHandle;
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
});
