import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TrackItem } from '$lib/types';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

describe('native launch File input', () => {
  const path = 'C:/Music/şarkı.hvl';
  let input: { files: File[]; remove: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.resetModules(); vi.resetAllMocks();
    input = { files: [new File(['module'], 'şarkı.hvl')], remove: vi.fn() };
    vi.stubGlobal('document', { createElement: vi.fn(() => input), body: { append: vi.fn() } });
    vi.stubGlobal('window', {});
    invoke.mockResolvedValue([path]);
  });
  afterEach(() => vi.unstubAllGlobals());
  it('transfers only paths over IPC and retains Chromium Files for playback', async () => {
    // Keep utils and its WeakMap in the same module lifetime as the file bridge.
    const { readDesktopFiles } = await import('./files');
    const { buildTrackItems: build } = await import('$lib/utils/files');
    const files = await readDesktopFiles([path]);
    expect(files[0]).toBe(input.files[0]);
    expect(invoke).toHaveBeenCalledWith('materialize_desktop_files', { paths: [path] });
    expect(build(files)[0]).toMatchObject({ path, nativeFile: { uri: 'file:///C:/Music/%C5%9Fark%C4%B1.hvl' }, kind: 'module' });
    expect(input.remove).toHaveBeenCalledOnce();
  });
  it('cleans up failed selections and permits later retries', async () => {
    const { readDesktopFiles } = await import('./files');
    invoke.mockRejectedValueOnce(new Error('File was removed'));
    await expect(readDesktopFiles([path])).rejects.toThrow('File was removed');
    await expect(readDesktopFiles([path])).resolves.toHaveLength(1);
    expect(input.remove).toHaveBeenCalledTimes(2);
  });
  it('preserves absolute UNC paths for restoration', async () => {
    const { readDesktopFiles } = await import('./files');
    const { buildTrackItems } = await import('$lib/utils/files');
    invoke.mockResolvedValue(['\\\\nas\\Music\\şarkı.hvl']);
    const files = await readDesktopFiles(['\\\\nas\\Music\\şarkı.hvl']);
    expect(buildTrackItems(files)[0].path).toBe('//nas/Music/şarkı.hvl');
  });

  it('reacquires read permission on the original stored handle through native activation', async () => {
    const { preparePlaybackRestoration } = await import('./files');
    const requestPermission = vi.fn(async () => 'granted' as const);
    const fileHandle = { queryPermission: vi.fn(async () => 'prompt'), requestPermission } as unknown as FileSystemFileHandle;
    invoke.mockImplementation(async (command) => {
      expect(command).toBe('prepare_desktop_playback_restoration');
      const callback = (window as unknown as { __izciRestoreFileAccess: () => Promise<string> }).__izciRestoreFileAccess;
      expect(await callback()).toBe('granted');
    });
    await preparePlaybackRestoration({ fileHandle } as TrackItem);
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'read' });
    expect(window).not.toHaveProperty('__izciRestoreFileAccess');
  });

  it('does not request access for native references or already granted handles', async () => {
    const { preparePlaybackRestoration } = await import('./files');
    await preparePlaybackRestoration({ nativeFile: { uri: 'file:///C:/Music/song.hvl' }, path } as TrackItem);
    await preparePlaybackRestoration({ fileHandle: { queryPermission: vi.fn(async () => 'granted') } } as unknown as TrackItem);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('releases the handle callback even when native activation fails', async () => {
    const { preparePlaybackRestoration } = await import('./files');
    invoke.mockRejectedValue(new Error('Permission denied'));
    const fileHandle = { queryPermission: vi.fn(async () => 'prompt'), requestPermission: vi.fn() } as unknown as FileSystemFileHandle;
    await expect(preparePlaybackRestoration({ fileHandle } as TrackItem)).rejects.toThrow('Permission denied');
    expect(window).not.toHaveProperty('__izciRestoreFileAccess');
  });

  it('serializes concurrent saved-handle requests and releases each callback', async () => {
    const { preparePlaybackRestoration } = await import('./files');
    let finishFirst!: () => void;
    const gate = new Promise<void>((resolve) => { finishFirst = resolve; });
    const first = vi.fn(async () => 'granted' as const);
    const second = vi.fn(async () => 'granted' as const);
    const handle = (requestPermission: typeof first) => ({
      queryPermission: vi.fn(async () => 'prompt'), requestPermission
    }) as unknown as FileSystemFileHandle;
    const observed: string[] = [];
    invoke.mockImplementation(async () => {
      const target = window as unknown as { __izciRestoreFileAccess: () => Promise<string> };
      if (observed.length === 0) {
        observed.push('first');
        await gate;
        expect(await target.__izciRestoreFileAccess()).toBe('granted');
        expect(first).toHaveBeenCalledOnce();
        expect(second).not.toHaveBeenCalled();
      } else {
        observed.push('second');
        expect(await target.__izciRestoreFileAccess()).toBe('granted');
        expect(second).toHaveBeenCalledOnce();
      }
    });
    const one = preparePlaybackRestoration({ fileHandle: handle(first) } as TrackItem);
    const two = preparePlaybackRestoration({ fileHandle: handle(second) } as TrackItem);
    await vi.waitFor(() => expect(observed).toEqual(['first']));
    finishFirst();
    await Promise.all([one, two]);
    expect(observed).toEqual(['first', 'second']);
    expect(window).not.toHaveProperty('__izciRestoreFileAccess');
  });
});
