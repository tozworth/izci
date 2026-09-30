import { inferExtension, inferKind } from '$lib/utils/files';
import { logDebug, logWarning } from '$lib/services/logging';
import type { TrackItem } from '$lib/types';
import { isDesktop, materializePlatformFile } from '$platform';
import { useAndroidFileSnapshot } from '$lib/utils/file-read-policy';

/**
 * Chromium on Android pays a large fixed cost per blob slice over FSA-backed
 * Files (~150-200 ms measured on S23U), while a single whole-file read is fast.
 * Only small Android streams use this optimization. Desktop streams and all
 * videos stay on direct disk-backed File URLs.
 */

function createObjectUrl(item: Pick<TrackItem, 'kind'>, file: File): Promise<string | undefined> {
  if (item.kind !== 'stream' && item.kind !== 'video' && item.kind !== 'image') {
    return Promise.resolve(undefined);
  }

  if (item.kind === 'stream' && useAndroidFileSnapshot(file.size)) {
    return file
      .arrayBuffer()
      .then((buffer) => URL.createObjectURL(new Blob([buffer])))
      .catch(() => URL.createObjectURL(file));
  }

  return Promise.resolve(URL.createObjectURL(file));
}

export function revokeObjectUrl(item: Pick<TrackItem, 'objectUrl'>): void {
  if (item.objectUrl) {
    logDebug('files', 'Object URL revoked');
    URL.revokeObjectURL(item.objectUrl);
  }
}

async function queryHandlePermission(handle: FileSystemFileHandle): Promise<FileSystemPermissionState> {
  if (typeof handle.queryPermission !== 'function') {
    return 'granted';
  }

  try {
    return await handle.queryPermission({ mode: 'read' });
  } catch {
    return 'prompt';
  }
}

async function requestHandlePermission(handle: FileSystemFileHandle): Promise<FileSystemPermissionState> {
  if (typeof handle.requestPermission !== 'function') {
    return 'granted';
  }

  try {
    return await handle.requestPermission({ mode: 'read' });
  } catch {
    return 'denied';
  }
}

export async function materializeTrackItem(item: TrackItem, prompt = false): Promise<TrackItem | null> {
  if (item.file && (item.kind === 'module' || item.objectUrl)) {
    logDebug('files', 'Track already materialized', { id: item.id, kind: item.kind });
    return item;
  }

  if (isDesktop && item.desktopFile && item.path && !item.fileHandle) {
    const file = await materializePlatformFile(item.path);
    if (!file) return null;
    const extension = inferExtension(file.name);
    const kind = inferKind(extension);
    if (!kind) return null;
    return { ...item, file, extension, kind, size: file.size, lastModified: file.lastModified,
      objectUrl: await createObjectUrl({ kind }, file) };
  }

  if (!item.fileHandle) {
    logWarning('files', 'Track cannot be materialized because it has no file handle', { id: item.id });
    return null;
  }

  const permission = await queryHandlePermission(item.fileHandle);

  if (permission !== 'granted' && (!prompt || (await requestHandlePermission(item.fileHandle)) !== 'granted')) {
    logWarning('files', 'Track materialization permission unavailable', { id: item.id, permission, prompt });
    return null;
  }

  const file = await item.fileHandle.getFile();
  const extension = inferExtension(file.name);
  const kind = inferKind(extension);

  if (!kind) {
    logWarning('files', 'Materialized file has unsupported extension', { id: item.id, extension });
    return null;
  }

  const objectUrl = await createObjectUrl({ kind }, file);
  logDebug('files', 'Track materialized', { id: item.id, kind, bytes: file.size, objectUrl: Boolean(objectUrl) });
  return {
    ...item,
    file,
    name: file.name,
    extension,
    kind,
    size: file.size,
    lastModified: file.lastModified,
    objectUrl
  };
}
