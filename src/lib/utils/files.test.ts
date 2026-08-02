import { describe, expect, it, vi } from 'vitest';
import { MODULE_EXTENSIONS, VIDEO_EXTENSIONS } from '$lib/types';

import {
  buildPlaylistItems,
  buildSeparatedSubsongItems,
  discoverDirectoryFiles,
  extractDroppedContent,
  extractDroppedFiles,
  formatDuration,
  inferArtistTitleFromFileName,
  inferExtension,
  inferKind,
  mergeInferredArtistTitle,
  getTrackDisplayTitle,
  getTrackPlaylistLabel,
  readFileHandleFiles,
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
  it('formats durations with an hours field when needed', () => {
    expect(formatDuration(88 * 60 + 12)).toBe('01:28:12');
    expect(formatDuration(728 * 60 + 43)).toBe('12:08:43');
    expect(formatDuration(3599.9)).toBe('59:59');
    expect(formatDuration(3600)).toBe('01:00:00');
  });

  it('infers supported file extensions and playback kinds', () => {
    expect(inferExtension('Track.FLAC')).toBe('flac');
    expect(inferExtension('README')).toBe('');
    expect(inferKind('flac')).toBe('stream');
    expect(inferKind('xm')).toBe('module');
    expect(MODULE_EXTENSIONS.every((extension) => inferKind(extension) === 'module')).toBe(true);
    expect(VIDEO_EXTENSIONS.every((extension) => inferKind(extension) === 'video')).toBe(true);
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

  it('builds distinct playlist entries for every module subsong', () => {
    const source = {
      id: 'module-id',
      name: 'Suite.xm',
      extension: 'xm',
      kind: 'module' as const,
      size: 123,
      lastModified: 456,
      metadata: {
        title: 'Suite',
        subsongs: 3,
        subsongNames: ['Intro', 'Main', 'Outro']
      }
    };

    const separated = buildSeparatedSubsongItems(source, 1);

    expect(separated.map((item) => item.subsong)).toEqual([0, 1, 2]);
    expect(separated[1].id).toBe('module-id');
    expect(new Set(separated.map((item) => item.id))).toHaveLength(3);
    expect(separated.map(getTrackPlaylistLabel)).toEqual([
      'Suite.xm - 1/3',
      'Suite.xm - 2/3',
      'Suite.xm - 3/3'
    ]);
    expect(separated.map(getTrackDisplayTitle)).toEqual(['Suite', 'Suite', 'Suite']);
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
    expect(items.every((item) => item.file === undefined && item.objectUrl === undefined)).toBe(true);
  });

  it('discovers directory handles and parent context without opening files', async () => {
    const track = fileHandle(new File(['track'], 'Track.flac'));
    const getFile = vi.spyOn(track, 'getFile');
    const album = directoryHandle('Album', [track]);
    const root = directoryHandle('Music', [album]);

    await expect(discoverDirectoryFiles(root)).resolves.toEqual([{
      fileHandle: track,
      parentHandle: album,
      path: 'Music/Album/Track.flac'
    }]);
    expect(getFile).not.toHaveBeenCalled();
  });

  it('attaches resolved folder context when reading launched file handles', async () => {
    const track = fileHandle(new File(['track'], 'Track.flac'));
    const files = await readFileHandleFiles([track], () => ({
      path: 'Music/Artist/Track.flac',
      sourceFolderId: 'music-id'
    }));

    expect(buildPlaylistItems(files)[0]).toMatchObject({
      fileHandle: track,
      path: 'Music/Artist/Track.flac',
      sourceFolderId: 'music-id'
    });
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
});
