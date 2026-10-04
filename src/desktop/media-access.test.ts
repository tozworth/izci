import { beforeEach, describe, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ invoke: vi.fn(), read: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: calls.invoke }));
vi.mock('./files', () => ({ readDesktopFiles: calls.read }));
import { getDesktopMediaAccess } from './media-access';
import { asFileSystemFileHandle } from '$lib/services/media-file-access';

beforeEach(() => {
  vi.resetAllMocks();
  calls.invoke.mockResolvedValue('token');
  calls.read.mockResolvedValue([new File(['source'], 'song.flac')]);
});

describe('transient desktop editing access', () => {
  it('reads native files and keeps native editing objects out of FSA handle handoffs', async () => {
    const { file } = await getDesktopMediaAccess({ uri: 'file:///C:/song.flac' });
    expect((await file.getFile()).name).toBe('song.flac');
    expect(calls.read).toHaveBeenCalledWith(['C:/song.flac']);
    expect(asFileSystemFileHandle(file)).toBeUndefined();
    expect(file.nativeFile).toEqual({ uri: 'file:///C:/song.flac' });
    const fsa = { kind: 'file', getFile: vi.fn() } as unknown as FileSystemFileHandle;
    expect(asFileSystemFileHandle(fsa)).toBe(fsa);
  });
  it('streams bounded write chunks and commits only after all bytes have arrived', async () => {
    const { file } = await getDesktopMediaAccess({ uri: 'file:///C:/Music/song.flac' });
    const writable = await file.createWritable!();
    await new Blob([new Uint8Array(600_000)]).stream().pipeTo(writable);
    const chunks = calls.invoke.mock.calls.filter(([name]) => name === 'update_desktop_media_write');
    expect(chunks.reduce((sum, [, args]) => sum + args.bytes.length, 0)).toBe(600_000);
    expect(chunks.every(([, args]) => args.bytes.length <= 256 * 1024)).toBe(true);
    expect(calls.invoke.mock.calls.at(-1)).toEqual(['finish_desktop_media_write', { token: 'token', commit: true }]);
  });
  it('supports direct Blob writes and discards failed writes without committing', async () => {
    const { file } = await getDesktopMediaAccess({ uri: 'file:///C:/Music/song.flac' });
    const writable = await file.createWritable!();
    calls.invoke.mockRejectedValueOnce(new Error('Disk full'));
    await expect(writable.write(new Blob(['edited']))).rejects.toThrow('Disk full');
    await writable.abort();
    expect(calls.invoke.mock.calls.at(-1)).toEqual(['finish_desktop_media_write', { token: 'token', commit: false }]);
    expect(calls.invoke).not.toHaveBeenCalledWith('finish_desktop_media_write', { token: 'token', commit: true });
  });
  it('updates native references after rename and retains drive-root parent paths', async () => {
    const { file, parent } = await getDesktopMediaAccess({ uri: 'file:///C:/song.flac' });
    calls.invoke.mockResolvedValueOnce('C:\\renamed.flac').mockResolvedValueOnce('C:\\renamed.flac');
    await file.move!('renamed.flac');
    expect(file.nativeFile).toEqual({ uri: 'file:///C:/renamed.flac' });
    await parent.getFileHandle('renamed.flac');
    expect(calls.invoke).toHaveBeenCalledWith('access_desktop_media_entry', { path: 'C:/renamed.flac', directory: false, create: false });
    await expect(parent.getFileHandle('../escape.flac')).rejects.toThrow();
  });
  it('reports a source changed during commit as a metadata conflict', async () => {
    const { file } = await getDesktopMediaAccess({ uri: 'file:///C:/Music/song.flac' });
    const writable = await file.createWritable!();
    calls.invoke.mockRejectedValueOnce('ExternalChangeError: The file changed during the native write');
    await expect(writable.close()).rejects.toMatchObject({ code: 'external-change' });
  });
});
