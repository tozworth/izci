import { describe, expect, it, vi } from 'vitest';
import { enumerateSupportedFiles } from './library-folder-index';

type TestEntry = FileSystemFileHandle | FileSystemDirectoryHandle;

function fileHandle(name: string, getFile = vi.fn()): FileSystemFileHandle {
  return { kind: 'file', name, getFile } as unknown as FileSystemFileHandle;
}

function directoryHandle(name: string, entries: TestEntry[]): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    async *values() {
      for (const entry of entries) yield entry;
    }
  } as FileSystemDirectoryHandle;
}

async function collect(
  root: FileSystemDirectoryHandle,
  options: { maxDepth?: number; signal?: AbortSignal } = {}
) {
  const values = [];
  for await (const value of enumerateSupportedFiles(root, {
    maxDepth: options.maxDepth ?? Number.POSITIVE_INFINITY,
    signal: options.signal
  })) values.push(value);
  return values;
}

describe('managed-folder handle-only enumeration', () => {
  it('yields supported paths without opening known files', async () => {
    const getFlac = vi.fn();
    const getText = vi.fn();
    const root = directoryHandle('Music', [
      directoryHandle('Artist', [fileHandle('Track.flac', getFlac), fileHandle('Notes.txt', getText)])
    ]);

    await expect(collect(root)).resolves.toEqual([
      {
        path: 'Music/Artist/Track.flac',
        name: 'Track.flac',
        extension: 'flac',
        kind: 'stream'
      }
    ]);
    expect(getFlac).not.toHaveBeenCalled();
    expect(getText).not.toHaveBeenCalled();
  });

  it('respects the nesting limit', async () => {
    const root = directoryHandle('Music', [
      fileHandle('Root.mod'),
      directoryHandle('One', [
        fileHandle('One.xm'),
        directoryHandle('Two', [fileHandle('Two.it')])
      ])
    ]);

    await expect(collect(root, { maxDepth: 1 })).resolves.toMatchObject([
      { path: 'Music/Root.mod' },
      { path: 'Music/One/One.xm' }
    ]);
  });

  it('observes cancellation between entries', async () => {
    const controller = new AbortController();
    const root = directoryHandle('Music', [fileHandle('One.flac'), fileHandle('Two.flac')]);
    const iterator = enumerateSupportedFiles(root, { maxDepth: 1, signal: controller.signal });

    await expect(iterator.next()).resolves.toMatchObject({ value: { name: 'One.flac' } });
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('records a child failure and continues sibling enumeration', async () => {
    const broken = {
      kind: 'directory',
      name: 'Broken',
      async *values() {
        throw new DOMException('Disconnected', 'NotFoundError');
      }
    } as unknown as FileSystemDirectoryHandle;
    const errors: string[] = [];
    const root = directoryHandle('Music', [broken, fileHandle('After.opus')]);
    const values = [];

    for await (const value of enumerateSupportedFiles(root, {
      maxDepth: 2,
      onError: (error) => errors.push(error.path)
    })) values.push(value);

    expect(errors).toEqual(['Music/Broken']);
    expect(values).toMatchObject([{ path: 'Music/After.opus' }]);
  });
});
