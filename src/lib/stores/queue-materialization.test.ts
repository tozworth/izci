import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackItem } from '$lib/types';
import { materializeTrackItem } from './queue-materialization';
import { ANDROID_FILE_SNAPSHOT_MAX_BYTES } from '$lib/utils/file-read-policy';

afterEach(() => vi.unstubAllGlobals());

describe('media playback materialization memory', () => {
  it.each(['Windows NT 10.0', 'Macintosh', 'X11; Linux x86_64'])('keeps %s audio disk-backed', async (userAgent) => {
    vi.stubGlobal('navigator', { userAgent });
    const file = new File(['audio'], 'track.flac');
    const fullRead = vi.spyOn(file, 'arrayBuffer');
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:disk-backed');
    vi.stubGlobal('URL', { createObjectURL });
    const track = { ...moduleItem({ getFile: async () => file } as FileSystemFileHandle), kind: 'stream' as const };
    const loaded = await materializeTrackItem(track);
    expect(loaded?.objectUrl).toBe('blob:disk-backed');
    expect(createObjectURL).toHaveBeenCalledWith(file);
    expect(fullRead).not.toHaveBeenCalled();
  });

  it.each(['video', 'image', 'module'] as const)('never copies %s payloads on Android', async (kind) => {
    vi.stubGlobal('navigator', { userAgent: 'Android' });
    const extension = kind === 'video' ? 'mp4' : kind === 'image' ? 'png' : 'xm';
    const file = new File(['media'], `track.${extension}`);
    const fullRead = vi.spyOn(file, 'arrayBuffer');
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:disk-backed');
    vi.stubGlobal('URL', { createObjectURL });
    const track = { ...moduleItem({ getFile: async () => file } as FileSystemFileHandle), kind, extension };
    const loaded = await materializeTrackItem(track);
    expect(fullRead).not.toHaveBeenCalled();
    if (kind === 'module') expect(loaded?.objectUrl).toBeUndefined();
    else expect(createObjectURL).toHaveBeenCalledWith(file);
  });

  it('snapshots small Android audio and leaves large audio on its File URL', async () => {
    vi.stubGlobal('navigator', { userAgent: 'Android' });
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:audio');
    vi.stubGlobal('URL', { createObjectURL });
    const file = new File(['audio'], 'track.opus');
    const fullRead = vi.spyOn(file, 'arrayBuffer');
    const track = { ...moduleItem({ getFile: async () => file } as FileSystemFileHandle), kind: 'stream' as const };
    await materializeTrackItem(track);
    expect(fullRead).toHaveBeenCalledOnce();
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(createObjectURL.mock.calls[0][0]).not.toBe(file);
    Object.defineProperty(file, 'size', { value: ANDROID_FILE_SNAPSHOT_MAX_BYTES + 1 });
    fullRead.mockClear();
    await materializeTrackItem(track);
    expect(createObjectURL).toHaveBeenLastCalledWith(file);
    expect(fullRead).not.toHaveBeenCalled();
  });
});

function moduleItem(handle: FileSystemFileHandle): TrackItem {
  return {
    id: 'remembered-module',
    name: 'remembered.xm',
    extension: 'xm',
    kind: 'module',
    size: 1,
    lastModified: 1,
    fileHandle: handle,
    path: 'Music/remembered.xm'
  };
}

describe('playlist materialization permission characterization', () => {
  it('stops reading a remembered handle after its permission is lost', async () => {
    let permission: FileSystemPermissionState = 'granted';
    const getFile = vi.fn(async () => new File(['module'], 'remembered.xm', { lastModified: 2 }));
    const requestPermission = vi.fn(async () => 'denied' as const);
    const handle = {
      kind: 'file',
      name: 'remembered.xm',
      queryPermission: vi.fn(async () => permission),
      requestPermission,
      getFile
    } as unknown as FileSystemFileHandle;
    const remembered = moduleItem(handle);

    await expect(materializeTrackItem(remembered)).resolves.toMatchObject({
      id: 'remembered-module',
      file: expect.any(File),
      lastModified: 2
    });

    permission = 'denied';
    await expect(materializeTrackItem(remembered)).resolves.toBeNull();
    expect(getFile).toHaveBeenCalledOnce();
    expect(requestPermission).not.toHaveBeenCalled();

    await expect(materializeTrackItem(remembered, true)).resolves.toBeNull();
    expect(requestPermission).toHaveBeenCalledOnce();
    expect(getFile).toHaveBeenCalledOnce();
  });
});
