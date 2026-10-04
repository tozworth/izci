import { subscribeToLaunchedFiles as subscribePlatformLaunchedFiles } from '$platform';
import { filesystemFolders, resolveFilesystemFileLocation } from './filesystem-folders';
import { getImportedFileSource, registerImportedFile } from '$lib/utils/file-sources';

export { consumeFileLaunchMarker, setLaunchedHandlesPreviewListener } from '$platform';

/** The platform owns launch delivery; the application owns managed-folder association. */
export function subscribeToLaunchedFiles(listener: (files: File[]) => void | Promise<void>): () => void {
  return subscribePlatformLaunchedFiles(async files => {
    await filesystemFolders.ready();
    const folders = filesystemFolders.getSnapshot();
    await Promise.all(files.map(async file => {
      const source = getImportedFileSource(file);
      if (!source) return;
      const location = await resolveFilesystemFileLocation(source, folders);
      if (location) registerImportedFile(file, { path: location.path, sourceFolderId: location.folderId });
    }));
    await listener(files);
  });
}
