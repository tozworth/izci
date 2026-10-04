import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getImportedFileSource, registerImportedFile } from '$lib/utils/file-sources';

const launch = vi.hoisted(() => ({
  deliver: null as ((files: File[]) => void | Promise<void>) | null,
  ready: vi.fn(), locate: vi.fn(), unsubscribe: vi.fn(),
  folders: [{ id: 'music', name: 'Music' }]
}));
vi.mock('$platform', () => ({
  consumeFileLaunchMarker: () => false,
  setLaunchedHandlesPreviewListener: vi.fn(),
  subscribeToLaunchedFiles: (listener: (files: File[]) => void | Promise<void>) => {
    launch.deliver = listener;
    return launch.unsubscribe;
  }
}));
vi.mock('./filesystem-folders', () => ({
  filesystemFolders: { ready: launch.ready, getSnapshot: () => launch.folders },
  resolveFilesystemFileLocation: launch.locate
}));

import { subscribeToLaunchedFiles } from './file-launch';

beforeEach(() => {
  vi.resetAllMocks();
  launch.ready.mockResolvedValue(undefined);
});

describe('launched-file folder association', () => {
  it('waits for remembered roots and associates the file before handing it to playback', async () => {
    let ready!: () => void;
    launch.ready.mockReturnValueOnce(new Promise<void>(resolve => { ready = resolve; }));
    launch.locate.mockResolvedValue({ folderId: 'music', path: 'Music/Artist/track.flac' });
    const handle = { kind: 'file', name: 'track.flac' } as FileSystemFileHandle;
    const file = registerImportedFile(new File(['audio'], 'track.flac'), { fileHandle: handle, path: handle.name });
    const listener = vi.fn((files: File[]) => {
      expect(getImportedFileSource(files[0])).toMatchObject({
        fileHandle: handle, path: 'Music/Artist/track.flac', sourceFolderId: 'music'
      });
    });
    subscribeToLaunchedFiles(listener);
    const delivered = launch.deliver!([file]);
    expect(listener).not.toHaveBeenCalled();
    expect(launch.locate).not.toHaveBeenCalled();
    ready();
    await delivered;
    expect(launch.locate).toHaveBeenCalledWith(expect.objectContaining({ fileHandle: handle }), launch.folders);
    expect(listener).toHaveBeenCalledWith([file]);
  });

  it('preserves loose Files and forwards platform unsubscription', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToLaunchedFiles(listener);
    const file = new File(['audio'], 'loose.flac');
    await launch.deliver!([file]);
    expect(listener).toHaveBeenCalledWith([file]);
    expect(launch.locate).not.toHaveBeenCalled();
    unsubscribe();
    expect(launch.unsubscribe).toHaveBeenCalledOnce();
  });
});
