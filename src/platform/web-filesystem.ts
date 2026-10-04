import type { PlatformFilesystem } from '$lib/services/platform-files-types';
import { readDirectoryFiles, readFileHandleFiles, discoverDirectoryFiles } from './web-file-handles';
import { queryHandlePermission, requestHandlePermission, sameHandle } from './web-file-permissions';
import { useAndroidFileSnapshot } from './web-file-read-policy';
import { boundedFolderAccess } from './filesystem-access';

type PickerWindow = Window & {
  showOpenFilePicker?: (options?: OpenFilePickerOptions) => Promise<FileSystemFileHandle[]>;
  showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  showSaveFilePicker?: (options: import('$lib/services/platform-files-types').SaveFileOptions) => Promise<FileSystemFileHandle>;
};

function pickerWindow(target?: Window | null): PickerWindow | null {
  return target === undefined ? (typeof window === 'undefined' ? null : window) : target;
}

export function isFileHandle(value: unknown): value is FileSystemFileHandle {
  const source = value as Partial<FileSystemFileHandle> | null;
  return Boolean(source && source.kind === 'file' && typeof source.getFile === 'function');
}

export function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
  const source = value as Partial<FileSystemDirectoryHandle> | null;
  return Boolean(source && source.kind === 'directory' && typeof source.values === 'function');
}

export const filesystem: PlatformFilesystem = {
  accessModel: 'browser-grants',
  supportsFilePicker: (target) => Boolean(pickerWindow(target)?.showOpenFilePicker),
  supportsFolderPicker: (target) => Boolean(pickerWindow(target)?.showDirectoryPicker),
  supportsWritableFolders: () => Boolean(pickerWindow()?.showDirectoryPicker),
  preferSnapshotReads: useAndroidFileSnapshot,
  async pickFiles({ targetWindow, ...options } = {}) {
    const picker = pickerWindow(targetWindow);
    if (!picker?.showOpenFilePicker) throw new Error('File picking is unavailable.');
    return readFileHandleFiles(await picker.showOpenFilePicker(options));
  },
  async pickFolder({ targetWindow, ...options } = {}) {
    const picker = pickerWindow(targetWindow);
    if (!picker?.showDirectoryPicker) return null;
    const handle = await picker.showDirectoryPicker(options);
    return { name: handle.name, handle };
  },
  async pickWritableFolder() {
    const folder = await this.pickFolder({ mode: 'readwrite' });
    return folder?.handle ?? null;
  },
  async pickSaveFile(options) {
    return await pickerWindow()?.showSaveFilePicker?.(options) ?? null;
  },
  normalizeFileReference(value) {
    const source = value as { fileHandle?: unknown } | null;
    return isFileHandle(source?.fileHandle) ? { fileHandle: source!.fileHandle } : {};
  },
  normalizeFolderReference(value) {
    const source = value as { handle?: unknown } | null;
    const handle = isDirectoryHandle(value) ? value : source?.handle;
    return isDirectoryHandle(handle) ? { name: handle.name, handle } : null;
  },
  async readFile({ fileHandle }, { prompt = false } = {}) {
    if (!isFileHandle(fileHandle)) return null;
    const permission = await queryHandlePermission(fileHandle);
    if (permission !== 'granted' && (!prompt || await requestHandlePermission(fileHandle) !== 'granted')) return null;
    return fileHandle.getFile();
  },
  prepareFileAccess: async () => undefined,
  async readFolder({ handle }, options = {}) {
    if (!isDirectoryHandle(handle)) throw new Error('Folder access is unavailable.');
    return readDirectoryFiles(handle, options);
  },
  async discoverFolder({ handle }, options = {}) {
    if (!isDirectoryHandle(handle)) throw new Error('Folder access is unavailable.');
    const describe = (entry: import('./web-file-handles').DiscoveredDirectoryFile) => ({
      file: entry.fileHandle, parent: entry.parentHandle,
      reference: { fileHandle: entry.fileHandle }, path: entry.path
    });
    const entries = await discoverDirectoryFiles(handle, {
      maxDepth: options.maxDepth,
      onFileFound: entry => options.onFileFound?.(describe(entry))
    });
    return entries.map(describe);
  },
  async queryFolderPermission({ handle }, probe = false, timeoutMs) {
    if (!isDirectoryHandle(handle)) return 'unavailable';
    return boundedFolderAccess(async () => {
      const permission = await handle.queryPermission?.({ mode: 'read' }) ?? 'granted';
      if (permission !== 'granted' || !probe) return permission;
      await handle.values().next();
      return 'granted';
    }, timeoutMs);
  },
  async requestFolderPermission({ handle }) {
    if (!isDirectoryHandle(handle)) return 'unavailable';
    const permission = await requestHandlePermission(handle);
    return permission === 'granted' ? this.queryFolderPermission({ handle }, true) : permission;
  },
  async sameFolder(first, second) {
    return Boolean(first.handle && second.handle && await sameHandle(first.handle, second.handle));
  },
  async sameFile(first, second) {
    return Boolean(first.fileHandle && second.fileHandle && await sameHandle(first.fileHandle, second.fileHandle));
  },
  async resolveFilePath({ fileHandle }, { handle }) {
    if (!fileHandle || !handle?.resolve) return null;
    try { return await handle.resolve(fileHandle); } catch { return null; }
  },
  async getMediaAccess({ fileHandle }, context = {}) {
    let parent: FileSystemDirectoryHandle | null = null;
    const root = context.folders?.find(folder => folder.id === context.sourceFolderId)?.handle;
    if (root && context.path) {
      const parts = context.path.replaceAll('\\', '/').split('/').filter(Boolean);
      if (parts[0]?.toLocaleLowerCase() === root.name.toLocaleLowerCase()) parts.shift();
      parts.pop();
      try {
        parent = root;
        for (const part of parts) parent = await parent.getDirectoryHandle(part);
      } catch { parent = null; }
    }
    return { file: fileHandle ?? null, parent };
  }
};
