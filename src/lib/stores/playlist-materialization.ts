import type { PlaylistItem } from '$lib/contracts/catalog';
import { inferExtension, inferKind } from '$lib/utils/files';
import { logDebug, logWarning } from '$lib/logging/api';

type FileSystemPermissionState = 'granted' | 'denied' | 'prompt';

function createObjectUrl(item: Pick<PlaylistItem, 'kind'>, file: File): string | undefined {
  return item.kind === 'stream' || item.kind === 'video' ? URL.createObjectURL(file) : undefined;
}

export function revokeObjectUrl(item: Pick<PlaylistItem, 'objectUrl'>): void {
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

export async function materializePlaylistItem(item: PlaylistItem, prompt = false): Promise<PlaylistItem | null> {
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

  const objectUrl = createObjectUrl({ kind }, file);
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
