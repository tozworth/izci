import { filesystem } from '$platform';
import { registerImportedFile } from '$lib/utils/file-sources';
import { filesystemFolders, type FilesystemFolder } from './filesystem-folders';

export async function pickFilesystemFolder(): Promise<FilesystemFolder | null> {
  const folder = await filesystem.pickFolder();
  return folder ? filesystemFolders.remember(folder) : null;
}

export async function readFilesystemFolderFiles(folder: FilesystemFolder, maxDepth: number): Promise<File[]> {
  const files = await filesystem.readFolder(folder, { maxDepth });
  return files.map(file => registerImportedFile(file, { sourceFolderId: folder.id }));
}
