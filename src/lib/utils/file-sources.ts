import type { NativeFileReference } from '$lib/services/platform-files-types';

export interface ImportedFileSource {
  fileHandle?: FileSystemFileHandle;
  nativeFile?: NativeFileReference;
  path?: string;
  sourceFolderId?: string;
  /** Transient tool capability, never copied into track records. */
  parentHandle?: import('$lib/services/media-file-access').MediaDirectoryAccess;
}

const importedFileSources = new WeakMap<File, ImportedFileSource>();

export function normalizePath(path: string | undefined): string | undefined {
  if (!path) {
    return undefined;
  }

  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

export function registerImportedFile(file: File, source: ImportedFileSource): File {
  const existing = importedFileSources.get(file);

  importedFileSources.set(file, {
    fileHandle: source.fileHandle ?? existing?.fileHandle,
    nativeFile: source.nativeFile ?? existing?.nativeFile,
    path: ((source.nativeFile ?? existing?.nativeFile)?.uri.startsWith('file:')
      ? source.path?.replaceAll('\\', '/') : normalizePath(source.path)) ?? existing?.path,
    sourceFolderId: source.sourceFolderId ?? existing?.sourceFolderId,
    parentHandle: source.parentHandle ?? existing?.parentHandle
  });

  return file;
}

export function getImportedFileSource(file: File): ImportedFileSource | undefined {
  return importedFileSources.get(file);
}

