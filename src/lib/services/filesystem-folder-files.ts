import { nativeFilesystem } from '$platform';
import { readDirectoryFiles, registerImportedFile } from '$lib/utils/files';
import { filesystemFolders, type FilesystemFolder } from './filesystem-folders';

export async function pickFilesystemFolder(): Promise<FilesystemFolder | null> {
  if (nativeFilesystem) return filesystemFolders.remember(await nativeFilesystem.pickFolder());
  const picker = window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> };
  if (!picker.showDirectoryPicker) return null;
  return filesystemFolders.remember(await picker.showDirectoryPicker());
}

export async function readFilesystemFolderFiles(folder: FilesystemFolder, maxDepth: number): Promise<File[]> {
  if (nativeFilesystem && folder.nativeFolder) {
    const files = await nativeFilesystem.readFolder(folder.nativeFolder, maxDepth);
    return files.map(file => registerImportedFile(file, { sourceFolderId: folder.id }));
  }
  if (folder.handle) return readDirectoryFiles(folder.handle, { maxDepth });
  throw new Error('Folder access is unavailable.');
}
