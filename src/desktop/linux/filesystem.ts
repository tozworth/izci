import { invoke } from '@tauri-apps/api/core';
import type { NativeFilesystem, NativeFolderPermission } from '$lib/services/platform-files-types';
import { registerImportedFile } from '$lib/utils/file-sources';
import { desktopFileReference, desktopFilePath } from '../file-references';
import { createNativeFilesystem } from '../../platform/native-filesystem';
import { filesystem as browserFiles } from '../../platform/web-filesystem';

let pending: Promise<unknown> = Promise.resolve();

export function readLinuxFiles(paths: string[]): Promise<File[]> {
  const read = async () => {
    const files: File[] = [];
    for (let offset = 0; offset < paths.length; offset += 512) {
      const input = document.createElement('input');
      input.type = 'file'; input.multiple = true; input.hidden = true;
      input.id = 'izci-desktop-file-input';
      document.body.append(input);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const changed = new Promise<void>((resolve, reject) => {
        input.addEventListener('change', () => resolve(), { once: true });
        timer = setTimeout(() => reject(new Error('WebKit file selection timed out.')), 10000);
      });
      try {
        const [selected] = await Promise.all([
          invoke<string[]>('materialize_desktop_files', { paths: paths.slice(offset, offset + 512) }), changed
        ]);
        const batch = Array.from(input.files ?? []);
        if (batch.length !== selected.length) throw new Error('Desktop file selection was incomplete.');
        files.push(...batch.map((file, index) => registerImportedFile(file, {
          path: selected[index], nativeFile: desktopFileReference(selected[index])
        })));
      } finally { clearTimeout(timer); input.remove(); }
    }
    return files;
  };
  const result = pending.then(read);
  pending = result.catch(() => undefined);
  return result;
}

async function pickPaths(folder: boolean): Promise<string[]> {
  const paths = await invoke<string[] | null>('pick_desktop_paths', { folder });
  if (!paths) throw new DOMException('Cancelled', 'AbortError');
  return paths;
}

export const nativeFilesystem: NativeFilesystem = {
  referenceScheme: 'file:',
  async pickFiles() { return readLinuxFiles(await pickPaths(false)); },
  async pickFolder() {
    const [path] = await pickPaths(true);
    if (!path) throw new Error('The selected folder is unavailable.');
    return { ...desktopFileReference(path), name: path.split('/').at(-1) || path };
  },
  async readFolder(folder, maxDepth) {
    return readLinuxFiles(await invoke<string[]>('read_desktop_folder', { path: desktopFilePath(folder), maxDepth }));
  },
  queryFolderPermission(folder, probe) {
    return invoke<NativeFolderPermission>('query_desktop_folder_permission', { path: desktopFilePath(folder), probe });
  },
  async requestFolderPermission(folder) {
    return await this.queryFolderPermission(folder, true) === 'granted' ? 'granted' : 'denied';
  },
  async materializeFile(reference) { return (await readLinuxFiles([desktopFilePath(reference)]))[0]; }
};

export const filesystem = createNativeFilesystem(nativeFilesystem, { accessModel: 'os-permissions', browserFiles });
