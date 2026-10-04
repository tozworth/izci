import { nativeFilesystem } from '$platform';
import { readDirectoryFiles } from '$lib/utils/files';
import { filesystemFolders, type FilesystemFolder } from './filesystem-folders';

export async function pickFilesystemFolder(): Promise<FilesystemFolder | null> {
  if (nativeFilesystem) return filesystemFolders.remember(await nativeFilesystem.pickFolder());
  const picker = window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> };
  if (!picker.showDirectoryPicker) return null;
  return filesystemFolders.remember(await picker.showDirectoryPicker());
}

export async function readFilesystemFolderFiles(folder: FilesystemFolder, maxDepth: number): Promise<File[]> {
  if (nativeFilesystem && folder.nativeFolder) return nativeFilesystem.readFolder(folder.nativeFolder, maxDepth);
  if (folder.handle) return readDirectoryFiles(folder.handle, { maxDepth });
  throw new Error('Folder access is unavailable.');
}
