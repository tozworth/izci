import type {
  FileReference, FolderReference, NativeFilesystem, PlatformFilesystem
} from '$lib/services/platform-files-types';
import { isNativeFileReference, isNativeFolderReference } from '$lib/services/platform-files-types';
import { nativeFileIdentity } from '$lib/utils/native-media-files';
import type { MediaDirectoryAccess } from '$lib/services/media-file-access';
import { getImportedFileSource } from '$lib/utils/file-sources';
import { boundedFolderAccess } from './filesystem-access';

/** Shared shell-reference plumbing. Each bridge owns I/O and OS grant behavior. */
export function createNativeFilesystem(
  native: NativeFilesystem,
  options: {
    accessModel: 'os-permissions' | 'persisted-grants';
    writableFolder?: (folder: import('$lib/services/platform-files-types').NativeFolderReference) => MediaDirectoryAccess;
    /** Real browser handles can be supplied by WebView drag/drop or tool handoffs. */
    browserFiles?: PlatformFilesystem;
    prepareFileAccess?: (reference: FileReference) => Promise<void>;
  }
): PlatformFilesystem {
  const fileReference = (value: unknown): FileReference => {
    const source = value as Partial<FileReference> | null;
    return isNativeFileReference(source?.nativeFile, native.referenceScheme)
      ? { nativeFile: { uri: source!.nativeFile!.uri } } : options.browserFiles?.normalizeFileReference(value) ?? {};
  };
  const folderReference = (value: unknown) => {
    const source = value as Partial<FolderReference> | null;
    const folder = isNativeFolderReference(value, native.referenceScheme) ? value : source?.nativeFolder;
    if (!isNativeFolderReference(folder, native.referenceScheme)) return options.browserFiles?.normalizeFolderReference(value) ?? null;
    return { name: folder.name, nativeFolder: { uri: folder.uri, name: folder.name } };
  };
  return {
    accessModel: options.accessModel,
    supportsFilePicker: () => true,
    supportsFolderPicker: () => true,
    supportsWritableFolders: () => Boolean(options.writableFolder),
    preferSnapshotReads: () => false,
    async pickFiles(pickerOptions) {
      const files = await native.pickFiles();
      return pickerOptions?.multiple === false ? files.slice(0, 1) : files;
    },
    async pickFolder() {
      const nativeFolder = await native.pickFolder();
      return { name: nativeFolder.name, nativeFolder };
    },
    async pickWritableFolder() {
      if (!options.writableFolder) return null;
      return options.writableFolder(await native.pickFolder());
    },
    // Preserve genuine browser save dialogs when a shell supports them.
    pickSaveFile: async saveOptions => options.browserFiles?.pickSaveFile(saveOptions) ?? null,
    normalizeFileReference: fileReference,
    normalizeFolderReference: folderReference,
    async readFile(reference, readOptions) {
      const normalized = fileReference(reference);
      if (normalized.nativeFile) return reference.file ?? native.materializeFile(normalized.nativeFile);
      if (normalized.fileHandle && options.browserFiles) {
        await options.prepareFileAccess?.(normalized);
        return options.browserFiles.readFile(normalized, readOptions);
      }
      return null;
    },
    prepareFileAccess: options.prepareFileAccess ?? (async () => undefined),
    async readFolder(reference, readOptions = {}) {
      const folder = folderReference(reference);
      if (!folder?.nativeFolder) {
        if (options.browserFiles) return options.browserFiles.readFolder(reference, readOptions);
        throw new Error('Folder access is unavailable.');
      }
      const depth = readOptions.maxDepth ?? 64;
      return native.readFolder(folder.nativeFolder, Number.isFinite(depth) ? Math.max(0, Math.min(64, Math.trunc(depth))) : 64);
    },
    async discoverFolder(reference, discoveryOptions = {}) {
      if (!folderReference(reference)?.nativeFolder && options.browserFiles) {
        return options.browserFiles.discoverFolder(reference, discoveryOptions);
      }
      const files = await this.readFolder(reference, discoveryOptions);
      const entries = await Promise.all(files.map(async currentFile => {
        const source = getImportedFileSource(currentFile) ?? {};
        const reference = fileReference(source);
        const access = await this.getMediaAccess(reference);
        const entry = { file: access.file,
          parent: access.parent, reference, path: source.path ?? currentFile.name, currentFile };
        discoveryOptions.onFileFound?.(entry);
        return entry;
      }));
      return entries;
    },
    async queryFolderPermission(reference, probe = false, timeoutMs) {
      const folder = folderReference(reference);
      if (folder?.nativeFolder) return boundedFolderAccess(() => native.queryFolderPermission(folder.nativeFolder!, probe), timeoutMs);
      return options.browserFiles?.queryFolderPermission(reference, probe, timeoutMs) ?? 'unavailable';
    },
    async requestFolderPermission(reference) {
      const folder = folderReference(reference);
      return folder?.nativeFolder ? native.requestFolderPermission(folder.nativeFolder)
        : options.browserFiles?.requestFolderPermission(reference) ?? 'unavailable';
    },
    async sameFolder(first, second) {
      const a = folderReference(first), b = folderReference(second);
      if (a?.nativeFolder && b?.nativeFolder) return nativeFileIdentity(a.nativeFolder.uri) === nativeFileIdentity(b.nativeFolder.uri);
      return options.browserFiles?.sameFolder(first, second) ?? false;
    },
    async sameFile(first, second) {
      const a = fileReference(first), b = fileReference(second);
      if (a.nativeFile && b.nativeFile) return nativeFileIdentity(a.nativeFile.uri) === nativeFileIdentity(b.nativeFile.uri);
      return options.browserFiles?.sameFile(first, second) ?? false;
    },
    resolveFilePath: async (reference, folder) => options.browserFiles?.resolveFilePath(reference, folder) ?? null,
    async getMediaAccess(reference, context) {
      const file = fileReference(reference);
      return file.nativeFile && native.getMediaAccess
        ? native.getMediaAccess(file.nativeFile)
        : await options.browserFiles?.getMediaAccess(reference, context) ?? { file: null, parent: null };
    }
  };
}
