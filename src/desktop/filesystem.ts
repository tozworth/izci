import { invoke } from '@tauri-apps/api/core';
import type { NativeFilesystem, NativeFolderPermission } from '$lib/services/platform-files-types';
import { nativeFileIdentity } from '$lib/utils/native-media-files';
import { desktopFilePath, desktopFileReference } from './file-references';
import { readDesktopFiles, preparePlaybackRestoration } from './files';
import { getDesktopMediaAccess, getDesktopDirectoryAccess } from './media-access';
import { createNativeFilesystem } from '../platform/native-filesystem';
import { filesystem as browserFiles } from '../platform/web-filesystem';

async function pickPaths(folder: boolean): Promise<string[]> {
  const paths = await invoke<string[] | null>('pick_desktop_paths', { folder });
  if (!paths) throw new DOMException('Cancelled', 'AbortError');
  return paths;
}

async function materializePaths(paths: string[]): Promise<File[]> {
  const files: File[] = [];
  // The WebView bridge is bounded; large selections/catalogs use batches.
  for (let offset = 0; offset < paths.length; offset += 512) {
    files.push(...await readDesktopFiles(paths.slice(offset, offset + 512)));
  }
  return files;
}

export const nativeFilesystem: NativeFilesystem = {
  referenceScheme: 'file:',
  getMediaAccess: getDesktopMediaAccess,
  async pickFiles() { return materializePaths(await pickPaths(false)); },
  async pickFolder() {
    const [path] = await pickPaths(true);
    if (!path) throw new Error('The selected folder is unavailable.');
    return { ...desktopFileReference(path), name: path.replaceAll('\\', '/').replace(/\/$/, '').split('/').at(-1) || path };
  },
  async readFolder(folder, maxDepth) {
    const paths = await invoke<string[]>('read_desktop_folder', { path: desktopFilePath(folder), maxDepth });
    return materializePaths(paths);
  },
  queryFolderPermission(folder, probe) {
    return invoke<NativeFolderPermission>('query_desktop_folder_permission', { path: desktopFilePath(folder), probe });
  },
  async requestFolderPermission(folder) {
    // Windows permissions are owned by the OS; reselecting never bypasses them.
    try {
      const selected = await this.pickFolder();
      if (nativeFileIdentity(selected.uri) !== nativeFileIdentity(folder.uri)) return 'denied';
      return await this.queryFolderPermission(folder, true) === 'granted' ? 'granted' : 'denied';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'denied';
      throw error;
    }
  },
  async materializeFile(reference) { return (await readDesktopFiles([desktopFilePath(reference)]))[0]; }
};

export const filesystem = createNativeFilesystem(nativeFilesystem, {
  accessModel: 'os-permissions',
  writableFolder: getDesktopDirectoryAccess,
  browserFiles,
  prepareFileAccess: preparePlaybackRestoration
});
