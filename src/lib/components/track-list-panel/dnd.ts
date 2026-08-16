import { prepareImportedFiles } from '$lib/services/file-verification';
import { trackSettings } from '$lib/stores/track-settings';
import { extractDroppedContent } from '$lib/utils/files';

export async function handleDrop(
  event: DragEvent,
  readOnly: boolean,
  onAddFolders: (handles: FileSystemDirectoryHandle[]) => void,
  onAddFiles: (files: File[]) => void
): Promise<void> {
  event.preventDefault();

  if (readOnly) return;

  if (!event.dataTransfer) {
    return;
  }

  const { files: discoveredFiles, directoryHandles } = await extractDroppedContent(event.dataTransfer, {
    maxDepth: trackSettings.getSnapshot().folderNestingLimit
  });

  if (directoryHandles.length > 0) {
    onAddFolders(directoryHandles);
  }

  const files = await prepareImportedFiles(discoveredFiles);

  if (files.length > 0) {
    onAddFiles(files);
  }
}
