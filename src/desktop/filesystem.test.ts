import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ invoke: vi.fn(), read: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: calls.invoke }));
vi.mock('./files', () => ({ readDesktopFiles: calls.read }));
import { nativeFilesystem } from './filesystem';

beforeEach(() => vi.resetAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('desktop native filesystem dispatch', () => {
  it('selects files natively and maps cancellation to the shared import abort', async () => {
    calls.invoke.mockResolvedValueOnce(['C:/Music/song.flac']).mockResolvedValueOnce(null);
    const files = [new File([], 'song.flac')];
    calls.read.mockResolvedValue(files);
    expect(await nativeFilesystem.pickFiles()).toEqual(files);
    expect(calls.invoke).toHaveBeenCalledWith('pick_desktop_paths', { folder: false });
    expect(calls.read).toHaveBeenCalledWith(['C:/Music/song.flac']);
    await expect(nativeFilesystem.pickFiles()).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls.read).toHaveBeenCalledOnce();
  });
  it('returns a serializable folder reference without a browser handle', async () => {
    calls.invoke.mockResolvedValue('unused').mockResolvedValueOnce(['C:\\Music']);
    expect(await nativeFilesystem.pickFolder()).toEqual({ uri: 'file:///C:/Music', name: 'Music' });
  });
  it('batches native folder materialization and keeps the depth setting', async () => {
    const paths = Array.from({ length: 1100 }, (_, index) => `C:/Music/${index}.flac`);
    calls.invoke.mockResolvedValue(paths);
    calls.read.mockImplementation(async (batch: string[]) => batch.map(path => new File([], path.split('/').at(-1)!)));
    expect(await nativeFilesystem.readFolder({ uri: 'file:///C:/Music', name: 'Music' }, 8)).toHaveLength(1100);
    expect(calls.invoke).toHaveBeenCalledWith('read_desktop_folder', { path: 'C:/Music', maxDepth: 8 });
    expect(calls.read.mock.calls.map(([batch]) => batch.length)).toEqual([512, 512, 76]);
  });
  it('never opens a picker during access checks and only accepts reselecting the same root', async () => {
    const folder = { uri: 'file:///C:/Music', name: 'Music' };
    calls.invoke.mockResolvedValueOnce('unavailable').mockResolvedValueOnce(['C:/Other']);
    expect(await nativeFilesystem.queryFolderPermission(folder, false)).toBe('unavailable');
    expect(calls.invoke).toHaveBeenCalledOnce();
    expect(await nativeFilesystem.requestFolderPermission(folder)).toBe('denied');
    calls.invoke.mockResolvedValueOnce(['c:/music']).mockResolvedValueOnce('granted');
    expect(await nativeFilesystem.requestFolderPermission(folder)).toBe('granted');
  });
});
