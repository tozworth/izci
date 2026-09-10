import { inferExtension, inferKind } from '$lib/utils/files';
import { logDebug, logWarning } from '$lib/services/logging';
import type { TrackItem } from '$lib/types';

/**
 * Chromium on Android pays a large fixed cost per blob slice over FSA-backed
 * Files (~150-200 ms measured on S23U), while a single whole-file read is fast.
 * Streams small enough to hold in memory are therefore snapshotted once and
 * played from the snapshot; videos stay on direct FSA-backed URLs.
 */
const STREAM_INLINE_MAX_BYTES = 128 * 1024 * 1024;

function createObjectUrl(item: Pick<TrackItem, 'kind'>, file: File): Promise<string | undefined> {
  if (item.kind !== 'stream' && item.kind !== 'video' && item.kind !== 'image') {
    return Promise.resolve(undefined);
  }

  if (item.kind === 'stream' && file.size <= STREAM_INLINE_MAX_BYTES) {
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
