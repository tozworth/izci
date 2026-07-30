import { describe, expect, it, vi } from 'vitest';
import {
  converterOutputExists,
  converterOutputKey,
  resolveConverterOutputLocation,
  writeConverterOutput
} from './converter-output';

describe('converter output handling', () => {
  it('creates the requested relative directory path', async () => {
    const album = { getDirectoryHandle: vi.fn() } as unknown as FileSystemDirectoryHandle;
    const artist = {
      getDirectoryHandle: vi.fn().mockResolvedValue(album)
    } as unknown as FileSystemDirectoryHandle;
    const root = {
      getDirectoryHandle: vi.fn().mockResolvedValue(artist)
    } as unknown as FileSystemDirectoryHandle;
    const location = await resolveConverterOutputLocation(root, ['Artist', '.', 'Album'], 'track.flac');
    expect(root.getDirectoryHandle).toHaveBeenCalledWith('Artist', { create: true });
    expect(artist.getDirectoryHandle).toHaveBeenCalledWith('Album', { create: true });
    expect(location).toEqual({ directory: album, fileName: 'track.flac' });
  });

  it('reports a missing output without treating it as an error', async () => {
    const error = new Error('missing');
    error.name = 'NotFoundError';
    const directory = {
      getFileHandle: vi.fn().mockRejectedValue(error)
    } as unknown as FileSystemDirectoryHandle;
    await expect(converterOutputExists({ directory, fileName: 'track.flac' })).resolves.toBe(false);
  });

  it('writes through a File System Access writable', async () => {
    const write = vi.fn();
    const close = vi.fn();
    const directory = {
      getFileHandle: vi.fn().mockResolvedValue({
        createWritable: vi.fn().mockResolvedValue({ write, close })
      })
    } as unknown as FileSystemDirectoryHandle;
    const blob = new Blob(['media']);
    await writeConverterOutput({ directory, fileName: 'track.flac' }, blob);
    expect(write).toHaveBeenCalledWith(blob);
    expect(close).toHaveBeenCalledOnce();
  });

  it('uses case-insensitive keys for in-batch collision detection', () => {
    expect(converterOutputKey(['Album'], 'Track.FLAC')).toBe(converterOutputKey(['album'], 'track.flac'));
  });
});
