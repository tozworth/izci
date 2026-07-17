import { describe, expect, it, vi } from 'vitest';
import { MODULE_EXTENSIONS } from '$lib/types';

import {
  buildPlaylistItems,
  extractDroppedContent,
  extractDroppedFiles,
  inferArtistTitleFromFileName,
  inferExtension,
  inferKind,
  mergeInferredArtistTitle,
  readDirectoryFiles,
  stripFileExtension
} from './files';

function fileHandle(file: File): FileSystemFileHandle {
  return {
    kind: 'file',
    name: file.name,
    getFile: async () => file
  } as FileSystemFileHandle;
}

function directoryHandle(name: string, children: FileSystemHandle[]): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    async *values() {
      yield* children;
    }
  } as FileSystemDirectoryHandle;
}

describe('file helpers', () => {
  it('infers supported file extensions and playback kinds', () => {
    expect(inferExtension('Track.FLAC')).toBe('flac');
    expect(inferExtension('README')).toBe('');
    expect(inferKind('flac')).toBe('stream');
    expect(inferKind('xm')).toBe('module');
    expect(MODULE_EXTENSIONS.every((extension) => inferKind(extension) === 'module')).toBe(true);
    expect(inferKind('txt')).toBeNull();
  });

  it('strips only the final filename extension', () => {
    expect(stripFileExtension('Artist - Song.live.FLAC')).toBe('Artist - Song.live');
    expect(stripFileExtension('module')).toBe('module');
  });

  it('infers artist and title from the configured filename pattern', () => {
    expect(inferArtistTitleFromFileName('Skee Mask - Flyby Vfr.flac')).toEqual({
      artist: 'Skee Mask',
      title: 'Flyby Vfr'
    });
    expect(inferArtistTitleFromFileName('No separator.flac')).toBeNull();
  });

  it('merges inferred artist/title without overwriting existing metadata', () => {
    expect(mergeInferredArtistTitle({}, 'Artist - Title.opus')).toEqual({
      artist: 'Artist',
      title: 'Title'
    });
    expect(mergeInferredArtistTitle({ title: 'Tagged Title' }, 'Artist - Filename Title.opus')).toEqual({
      artist: 'Artist',
      title: 'Tagged Title'
    });
    expect(mergeInferredArtistTitle({}, 'Artist - Title.opus', false)).toEqual({});
  });

  it('recursively reads directory handles and preserves nested paths and file handles', async () => {
    const rootTrack = fileHandle(new File(['root'], 'Root.xm'));
    const nestedTrack = fileHandle(new File(['nested'], 'Nested.mod'));
    const root = directoryHandle('Music', [
      rootTrack,
      directoryHandle('Artist', [directoryHandle('Album', [nestedTrack])])
    ]);

    const files = await readDirectoryFiles(root);
    const items = buildPlaylistItems(files);

    expect(items.map((item) => ({ name: item.name, path: item.path }))).toEqual([
      { name: 'Nested.mod', path: 'Music/Artist/Album/Nested.mod' },
      { name: 'Root.xm', path: 'Music/Root.xm' }
    ]);
    expect(items.find((item) => item.name === 'Nested.mod')?.fileHandle).toBe(nestedTrack);
  });

  it('limits directory traversal by subfolder depth', async () => {
    const root = directoryHandle('Music', [
      fileHandle(new File(['root'], 'Root.mod')),
      directoryHandle('Artist', [
        fileHandle(new File(['artist'], 'Artist.mod')),
        directoryHandle('Album', [fileHandle(new File(['album'], 'Album.mod'))])
      ])
    ]);

    await expect(readDirectoryFiles(root, { maxDepth: 0 })).resolves.toMatchObject([
      { name: 'Root.mod' }
    ]);
    await expect(readDirectoryFiles(root, { maxDepth: 1 })).resolves.toMatchObject([
      { name: 'Root.mod' },
      { name: 'Artist.mod' }
    ]);
  });

  it('recursively reads legacy Chromium directory entries used by drag and drop', async () => {
    const nestedFile = new File(['nested'], 'Legacy.it');
    const fileEntry = {
      isFile: true,
      isDirectory: false,
      name: nestedFile.name,
      fullPath: '/Music/Sub/Legacy.it',
      file: (resolve: (file: File) => void) => resolve(nestedFile)
    };
    const subdirectoryEntry = {
      isFile: false,
      isDirectory: true,
      name: 'Sub',
      fullPath: '/Music/Sub',
      createReader: () => {
        let exhausted = false;
        return {
          readEntries: (resolve: (entries: object[]) => void) => {
            resolve(exhausted ? [] : [fileEntry]);
            exhausted = true;
          }
        };
      }
    };
    const rootEntry = {
      isFile: false,
      isDirectory: true,
      name: 'Music',
      fullPath: '/Music',
      createReader: () => {
        let exhausted = false;
        return {
          readEntries: (resolve: (entries: object[]) => void) => {
            resolve(exhausted ? [] : [subdirectoryEntry]);
            exhausted = true;
          }
        };
      }
    };
    const dataTransfer = {
      items: [
        {
          webkitGetAsEntry: () => rootEntry,
          getAsFile: () => null
        }
      ],
      files: []
    } as unknown as DataTransfer;

    const files = await extractDroppedFiles(dataTransfer);
    const items = buildPlaylistItems(files);

    expect(items).toHaveLength(1);
    expect(items[0].path).toBe('Music/Sub/Legacy.it');
  });

  it('collects reusable directory handles and their files in one drop traversal', async () => {
    const track = fileHandle(new File(['track'], 'Track.flac'));
    const folder = directoryHandle('Music', [track]);
    let handleReads = 0;
    const dataTransfer = {
      items: [
        {
          getAsFileSystemHandle: async () => {
            handleReads += 1;
            return folder;
          }
        }
      ],
      files: []
    } as unknown as DataTransfer;

    const dropped = await extractDroppedContent(dataTransfer);

    expect(handleReads).toBe(1);
    expect(dropped.directoryHandles).toEqual([folder]);
    expect(dropped.files).toMatchObject([{ name: 'Track.flac' }]);
    expect(buildPlaylistItems(dropped.files)[0].path).toBe('Music/Track.flac');
  });

  it('hands managed directory drops off without opening their files', async () => {
    const getFile = vi.fn(async () => new File(['track'], 'Track.flac'));
    const track = fileHandle(new File(['track'], 'Track.flac'));
    track.getFile = getFile;
    const folder = directoryHandle('Music', [track]);
    const dataTransfer = {
      items: [{ getAsFileSystemHandle: async () => folder }],
      files: []
    } as unknown as DataTransfer;

    const dropped = await extractDroppedContent(dataTransfer, { materializeDirectories: false });

    expect(dropped.directoryHandles).toEqual([folder]);
    expect(dropped.files).toEqual([]);
    expect(getFile).not.toHaveBeenCalled();
  });
});
