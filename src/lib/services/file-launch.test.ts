import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  FILE_LAUNCH_WINDOW_QUERY_KEY,
  consumeFileLaunchMarker,
  setLaunchedHandlesPreviewListener,
  subscribeToLaunchedFiles
} from '../../platform/pwa/file-launch';

function stubWindow(search: string): { replaceState: ReturnType<typeof vi.fn> } {
  const replaceState = vi.fn();
  vi.stubGlobal('window', {
    location: { search, pathname: '/', hash: '' },
    history: { replaceState }
  });
  return { replaceState };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('consumeFileLaunchMarker', () => {
  it('returns false without a window', () => {
    expect(consumeFileLaunchMarker()).toBe(false);
  });

  it('returns false without the marker and leaves history alone', () => {
    const { replaceState } = stubWindow('?other=1');
    expect(consumeFileLaunchMarker()).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('detects the marker and strips it from the URL', () => {
    const { replaceState } = stubWindow(`?${FILE_LAUNCH_WINDOW_QUERY_KEY}`);
    expect(consumeFileLaunchMarker()).toBe(true);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
  });

  it('preserves unrelated query params and hashes when stripping', () => {
    vi.stubGlobal('window', {
      location: { search: `?view=a&${FILE_LAUNCH_WINDOW_QUERY_KEY}`, pathname: '/', hash: '#top' },
      history: { replaceState: vi.fn() }
    });
    expect(consumeFileLaunchMarker()).toBe(true);
    expect(vi.mocked(window.history.replaceState)).toHaveBeenCalledWith(null, '', '/?view=a#top');
  });
});

describe('launched-handles preview', () => {
  function stubLaunchWindow(): {
    consumer: (params: LaunchParams) => void;
    store: Map<string, string>;
  } {
    const store = new Map<string, string>();
    let consumer: ((params: LaunchParams) => void) | null = null;
    vi.stubGlobal('window', {
      launchQueue: {
        setConsumer: vi.fn((next: (params: LaunchParams) => void) => {
          consumer = next;
        })
      },
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        }
      },
      addEventListener: vi.fn(),
      clearInterval: vi.fn(),
      setInterval: vi.fn(() => 0),
      setTimeout: (fn: () => void) => setTimeout(fn, 0),
      clearTimeout: (id: unknown) => clearTimeout(id as NodeJS.Timeout)
    });
    return {
      get consumer() {
        if (!consumer) throw new Error('launchQueue consumer was not set');
        return consumer;
      },
      store
    };
  }

  function fileHandle(name: string): FileSystemFileHandle {
    return {
      kind: 'file',
      name,
      getFile: async () => new File(['media'], name)
    } as FileSystemFileHandle;
  }

  afterEach(() => {
    setLaunchedHandlesPreviewListener(null);
  });

  it('notifies the preview synchronously for file launches and ignores handle-less ones', async () => {
    const launch = stubLaunchWindow();
    const preview = vi.fn();
    setLaunchedHandlesPreviewListener(preview);
    const received: File[][] = [];
    const unsubscribe = subscribeToLaunchedFiles((files) => {
      received.push(files);
    });
    try {
      const handles = [fileHandle('clip.mp4')];
      launch.consumer({ files: handles });
      // Synchronous: fires before the async relay probe and file reads.
      expect(preview).toHaveBeenCalledTimes(1);
      expect(preview).toHaveBeenCalledWith(handles);
      await vi.waitFor(() => expect(received).toHaveLength(1));
      expect(received[0].map((file) => file.name)).toEqual(['clip.mp4']);

      launch.consumer({
        files: [{ kind: 'directory', name: 'Music' } as unknown as FileSystemFileHandle]
      });
      expect(preview).toHaveBeenCalledTimes(1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(received).toHaveLength(1);
    } finally {
      unsubscribe();
    }
  });
});
