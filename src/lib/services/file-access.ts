import { filesystem } from '$platform';
import type { FileAccessSource, FileReadOptions, SaveFileOptions } from './platform-files-types';
import { createMediaFileUrl, getNativeMediaUrl } from '$lib/utils/native-media-files';
import { getImportedFileSource } from '$lib/utils/file-sources';
import type { DiscoveredMediaFile, FileAccessContext } from './platform-files-types';
export { extractDroppedContent, extractDroppedFiles, getDroppedDirectoryHandles } from '../../platform/web-file-handles';

export async function describeImportedFiles(files: File[], context?: FileAccessContext): Promise<DiscoveredMediaFile[]> {
  return Promise.all(files.map(async currentFile => {
    const source = getImportedFileSource(currentFile) ?? {};
    const access = await filesystem.getMediaAccess(source, context);
    return { file: access.file,
      parent: access.parent ?? source.parentHandle ?? null, reference: filesystem.normalizeFileReference(source),
      path: source.path || currentFile.webkitRelativePath || currentFile.name, currentFile };
  }));
}

/** Refresh reusable handles when requested; retain disk-backed native Files and snapshot fallbacks. */
export async function resolveTrackFile(
  source: FileAccessSource, options: FileReadOptions & { fresh?: boolean } = {}
): Promise<File | null> {
  if (source.file && !options.fresh) return source.file;
  try { return await filesystem.readFile(source, options) ?? source.file ?? null; }
  catch (error) { if (source.file) return source.file; throw error; }
}

export async function createTrackMediaUrl(kind: string, file: File): Promise<string | undefined> {
  if (kind !== 'stream' && kind !== 'video' && kind !== 'image') return undefined;
  if (kind === 'stream' && !getNativeMediaUrl(file) && filesystem.preferSnapshotReads(file.size)) {
    try { return URL.createObjectURL(new Blob([await file.arrayBuffer()])); } catch { /* Use the original disk view. */ }
  }
  return createMediaFileUrl(file);
}

export async function saveFile(blob: Blob, options: SaveFileOptions): Promise<void> {
  const handle = await filesystem.pickSaveFile(options);
  if (handle) {
    const writable = await handle.createWritable?.();
    if (!writable) throw new Error('The selected file cannot be written.');
    try { await writable.write(blob); await writable.close(); }
    catch (error) { await writable.abort().catch(() => undefined); throw error; }
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = options.suggestedName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
