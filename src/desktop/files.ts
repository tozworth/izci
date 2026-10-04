import { invoke } from '@tauri-apps/api/core';
import { registerImportedFile } from '$lib/utils/file-sources';
import type { FileReference } from '$lib/services/platform-files-types';
import { desktopFileReference } from './file-references';

type RestorationWindow = Window & {
  __izciRestoreFileAccess?: () => Promise<FileSystemPermissionState>;
};

let pendingPermission: Promise<unknown> = Promise.resolve();

export function preparePlaybackRestoration(track: FileReference): Promise<void> {
  // Playback, metadata, and artwork can restore different handles together.
  // The native command invokes one window callback, so serialize its ownership.
  const result = pendingPermission.then(() => restoreFileAccess(track));
  pendingPermission = result.catch(() => undefined);
  return result;
}

async function restoreFileAccess(track: FileReference): Promise<void> {
  const handle = track.fileHandle;
  if (!handle || typeof handle.queryPermission !== 'function'
    || await handle.queryPermission({ mode: 'read' }) === 'granted') return;
  const requestPermission = handle.requestPermission?.bind(handle);
  if (!requestPermission) return;
  const target = window as RestorationWindow;
  // Pass the existing IndexedDB handle by a short-lived callback. The native
  // shell activates this fixed operation; no paths or synthetic handles enter it.
  target.__izciRestoreFileAccess = () => requestPermission({ mode: 'read' });
  try {
    await invoke('prepare_desktop_playback_restoration');
  } finally {
    delete target.__izciRestoreFileAccess;
  }
}

let pending: Promise<unknown> = Promise.resolve();

// WebView2 populates an ordinary Chromium file input with OS-selected paths.
// Its Files remain disk-backed, including large videos; no media bytes cross IPC.
export function readDesktopFiles(paths: string[]): Promise<File[]> {
  const read = async () => {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true; input.hidden = true;
    input.id = 'izci-desktop-file-input';
    document.body.append(input);
    try {
      const resolvedPaths = await invoke<string[]>('materialize_desktop_files', { paths });
      const files = Array.from(input.files ?? []);
      if (files.length !== resolvedPaths.length) throw new Error('Desktop file selection was incomplete.');
      return files.map((file, index) => registerImportedFile(file, {
        path: resolvedPaths[index], nativeFile: desktopFileReference(resolvedPaths[index])
      }));
    } finally { input.remove(); }
  };
  const result = pending.then(read);
  pending = result.catch(() => undefined);
  return result;
}
