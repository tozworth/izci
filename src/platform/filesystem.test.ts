import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getImportedFileSource, registerImportedFile } from '$lib/utils/file-sources';
import { getNativeMediaUrl } from '$lib/utils/native-media-files';

const bridge = vi.hoisted(() => ({ windows: vi.fn(), android: vi.fn(), restore: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.windows }));
vi.mock('../android/bridge', () => ({ invokeAndroid: bridge.android }));
vi.mock('../desktop/files', () => ({
  preparePlaybackRestoration: bridge.restore,
  readDesktopFiles: async (paths: string[]) => paths.map(path => registerImportedFile(new File([], path.split('/').at(-1)!), {
    path, nativeFile: { uri: `file:///${path}` }
  }))
}));

import { filesystem as pwa } from './web-filesystem';
import { filesystem as windows } from '../desktop/filesystem';
import { filesystem as android } from '../android/files';
import { createNativeFilesystem } from './native-filesystem';

function fileHandle(file = new File(['module'], 'song.xm')): FileSystemFileHandle {
  return { kind: 'file', name: file.name, getFile: vi.fn(async () => file) } as unknown as FileSystemFileHandle;
}
function directoryHandle(): FileSystemDirectoryHandle {
  return { kind: 'directory', name: 'Music', values: async function* () {} } as FileSystemDirectoryHandle;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('filesystem implementations', () => {
  it('keeps genuine FSA handles in the PWA and rejects shell references', async () => {
    const handle = fileHandle();
    const directory = directoryHandle();
    vi.stubGlobal('window', { showOpenFilePicker: vi.fn(async () => [handle]), showDirectoryPicker: vi.fn(async () => directory) });
    const [file] = await pwa.pickFiles({ multiple: true });
    expect(getImportedFileSource(file)).toMatchObject({ fileHandle: handle });
    expect(await pwa.pickFolder()).toEqual({ name: 'Music', handle: directory });
    expect(pwa.normalizeFileReference({ nativeFile: { uri: 'file:///C:/Music/song.xm' } })).toEqual({});
    expect(pwa.normalizeFolderReference({ nativeFolder: { uri: 'content://provider/tree/Music', name: 'Music' } })).toBeNull();
  });

  it('uses Windows path references for picking and exposes its existing editing capabilities', async () => {
    bridge.windows.mockResolvedValueOnce(['C:/Music/song.xm']).mockResolvedValueOnce(['C:/Music']);
    const [file] = await windows.pickFiles();
    expect(getImportedFileSource(file)).toMatchObject({ nativeFile: { uri: 'file:///C:/Music/song.xm' } });
    expect(getImportedFileSource(file)?.fileHandle).toBeUndefined();
    const folder = await windows.pickFolder();
    expect(folder).toEqual({ name: 'Music', nativeFolder: { uri: 'file:///C:/Music', name: 'Music' } });
    expect(windows.supportsWritableFolders()).toBe(true);
    const access = await windows.getMediaAccess(getImportedFileSource(file)!);
    expect(access.file?.createWritable).toBeTypeOf('function');
    expect(access.parent?.getDirectoryHandle).toBeTypeOf('function');
    expect(windows.normalizeFileReference({ nativeFile: { uri: 'content://provider/document/song' } })).toEqual({});
  });

  it('uses SAF grants and ranged media URLs without inventing handles or reading media bytes', async () => {
    vi.stubGlobal('location', { origin: 'https://appassets.androidplatform.net' });
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    bridge.android.mockResolvedValueOnce([{ uri: 'content://provider/document/song', name: 'song.flac', size: 100, lastModified: 1, mime: 'audio/flac' }]);
    const [file] = await android.pickFiles();
    expect(getImportedFileSource(file)).toMatchObject({ nativeFile: { uri: 'content://provider/document/song' } });
    expect(getImportedFileSource(file)?.fileHandle).toBeUndefined();
    expect(getNativeMediaUrl(file)).toContain('/__saf?uri=');
    expect(fetch).not.toHaveBeenCalled();
    expect(android.normalizeFileReference({ fileHandle: fileHandle() })).toEqual({});
    expect(android.normalizeFileReference({ nativeFile: { uri: 'file:///C:/Music/song.flac' } })).toEqual({});
    expect(android.supportsWritableFolders()).toBe(false);
  });

  it('retains real WebView drag/drop handles through the Windows browser-access implementation', async () => {
    const handle = fileHandle();
    expect(windows.normalizeFileReference({ fileHandle: handle })).toEqual({ fileHandle: handle });
    expect(await windows.readFile({ fileHandle: handle })).toBeInstanceOf(File);
    expect(bridge.restore).toHaveBeenCalledWith({ fileHandle: handle });
  });

  it('reuses native Files during metadata reads without another bridge materialization', async () => {
    const file = new File(['audio'], 'song.flac');
    expect(await windows.readFile({ nativeFile: { uri: 'file:///C:/Music/song.flac' }, file })).toBe(file);
    expect(await android.readFile({ nativeFile: { uri: 'content://provider/document/song' }, file })).toBe(file);
    expect(bridge.windows).not.toHaveBeenCalled();
    expect(bridge.android).not.toHaveBeenCalled();
  });

  it('keeps an available genuine browser save dialog in the Windows shell', async () => {
    const handle = fileHandle();
    const picker = vi.fn(async () => handle);
    vi.stubGlobal('window', { showSaveFilePicker: picker });
    expect(await windows.pickSaveFile({ suggestedName: 'output.wav' })).toBe(handle);
    expect(picker).toHaveBeenCalledWith({ suggestedName: 'output.wav' });
    expect(await android.pickSaveFile({ suggestedName: 'output.wav' })).toBeNull();
  });

  it('returns one File to tools requesting a single native selection', async () => {
    bridge.windows.mockResolvedValueOnce(['C:/Music/first.xm', 'C:/Music/second.xm']);
    expect(await windows.pickFiles({ multiple: false })).toHaveLength(1);
  });

  it('never prompts during passive FSA reads, but honors an explicit permission request', async () => {
    const handle = { ...fileHandle(), queryPermission: vi.fn(async () => 'prompt' as const), requestPermission: vi.fn(async () => 'granted' as const) };
    expect(await pwa.readFile({ fileHandle: handle })).toBeNull();
    expect(handle.requestPermission).not.toHaveBeenCalled();
    expect(handle.getFile).not.toHaveBeenCalled();
    expect(await pwa.readFile({ fileHandle: handle }, { prompt: true })).toBeInstanceOf(File);
    expect(handle.requestPermission).toHaveBeenCalledOnce();
  });

  it('bounds access probing after a user grants a folder, without bounding the permission prompt', async () => {
    vi.useFakeTimers();
    const handle = { ...directoryHandle(), requestPermission: vi.fn(async () => 'granted' as const), values: () => ({ next: () => new Promise(() => {}) }) } as unknown as FileSystemDirectoryHandle;
    const check = pwa.requestFolderPermission({ handle });
    expect(handle.requestPermission).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(3001);
    expect(await check).toBe('unavailable');
  });

  it('normalizes unbounded tool scans before crossing either native JSON bridge', async () => {
    bridge.windows.mockResolvedValue([]);
    bridge.android.mockResolvedValue([]);
    await windows.readFolder({ nativeFolder: { uri: 'file:///C:/Music', name: 'Music' } });
    await android.readFolder({ nativeFolder: { uri: 'content://provider/tree/Music', name: 'Music' } }, { maxDepth: Infinity });
    expect(bridge.windows).toHaveBeenCalledWith('read_desktop_folder', { path: 'C:/Music', maxDepth: 64 });
    expect(bridge.android).toHaveBeenCalledWith('readFolder', { uri: 'content://provider/tree/Music', maxDepth: 64 });
  });

  it('keeps native access checks passive and bounded when a provider stalls', async () => {
    const query = vi.fn(() => new Promise<never>(() => {}));
    const request = vi.fn();
    const filesystem = createNativeFilesystem({ referenceScheme: 'content:', queryFolderPermission: query, requestFolderPermission: request } as never, { accessModel: 'persisted-grants' });
    expect(await filesystem.queryFolderPermission({ nativeFolder: { uri: 'content://provider/tree/Music', name: 'Music' } }, true, 10)).toBe('unavailable');
    expect(request).not.toHaveBeenCalled();
  });

  it('discovers PWA folders without reading unsupported files or losing parent access', async () => {
    const handle = fileHandle();
    const directory = { ...directoryHandle(), values: async function* () { yield handle; } } as FileSystemDirectoryHandle;
    const discovered = await pwa.discoverFolder({ handle: directory });
    expect(handle.getFile).not.toHaveBeenCalled();
    expect(discovered).toEqual([{ file: handle, parent: directory, path: 'Music/song.xm', reference: { fileHandle: handle } }]);
  });
});
