import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

describe('Linux disk-backed file import', () => {
  let input: { files: File[]; addEventListener: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  let change: () => void;
  beforeEach(() => {
    vi.resetModules(); vi.resetAllMocks();
    input = { files: [new File(['music'], 'şarkı.wav')],
      addEventListener: vi.fn((_event, callback) => { change = callback; }), remove: vi.fn() };
    vi.stubGlobal('document', { createElement: () => input, body: { append: vi.fn() } });
    invoke.mockImplementation(async () => { change(); return ['/Music/şarkı.wav']; });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('retains the browser File and native reference without copying bytes over IPC', async () => {
    const { readLinuxFiles } = await import('./filesystem');
    const { getImportedFileSource } = await import('$lib/utils/file-sources');
    const files = await readLinuxFiles(['/Music/şarkı.wav']);
    expect(files[0]).toBe(input.files[0]);
    expect(getImportedFileSource(files[0])).toEqual({
      path: '/Music/şarkı.wav', nativeFile: { uri: 'file:///Music/%C5%9Fark%C4%B1.wav' }
    });
    expect(invoke).toHaveBeenCalledWith('materialize_desktop_files', { paths: ['/Music/şarkı.wav'] });
    expect(input.remove).toHaveBeenCalledOnce();
  });

  it('waits for FileList change when native IPC finishes first', async () => {
    const { readLinuxFiles } = await import('./filesystem');
    invoke.mockResolvedValue(['/Music/şarkı.wav']);
    let finished = false;
    const result = readLinuxFiles(['/Music/şarkı.wav']).then(files => { finished = true; return files; });
    await vi.waitFor(() => expect(input.addEventListener).toHaveBeenCalled());
    expect(finished).toBe(false);
    change();
    await expect(result).resolves.toHaveLength(1);
  });

  it('cleans up native failures and allows a retry', async () => {
    const { readLinuxFiles } = await import('./filesystem');
    invoke.mockRejectedValueOnce(new Error('File removed'));
    await expect(readLinuxFiles(['/Music/şarkı.wav'])).rejects.toThrow('File removed');
    await expect(readLinuxFiles(['/Music/şarkı.wav'])).resolves.toHaveLength(1);
    expect(input.remove).toHaveBeenCalledTimes(2);
  });

  it('treats picker cancellation as an AbortError', async () => {
    const { nativeFilesystem } = await import('./filesystem');
    invoke.mockResolvedValue(null);
    await expect(nativeFilesystem.pickFiles()).rejects.toMatchObject({ name: 'AbortError' });
  });
});
