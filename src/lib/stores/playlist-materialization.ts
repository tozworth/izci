import type { PlaylistItem } from '$lib/types';
import { inferExtension, inferKind } from '$lib/utils/files';
import { logDebug, logWarning } from '$lib/services/logging';

type FileSystemPermissionState = 'granted' | 'denied' | 'prompt';

function createObjectUrl(item: Pick<PlaylistItem, 'kind'>, file: File): string | undefined {
  return item.kind === 'stream' || item.kind === 'video' ? URL.createObjectURL(file) : undefined;
}

export function revokeObjectUrl(item: Pick<PlaylistItem, 'objectUrl'>): void {
  if (item.objectUrl) {
    logDebug('library', 'revokeObjectUrl', { url: item.objectUrl });
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
    logDebug('library', 'materializePlaylistItem: in-memory file present', {
      id: item.id,
      name: item.name,
      kind: item.kind
    });
    return item;
  }

  if (!item.fileHandle) {
    logWarning('library', 'materializePlaylistItem: no file handle', {
      id: item.id,
      reason: 'item has no fileHandle and no usable in-memory file'
    });
    return null;
  }

  logDebug('library', 'materializePlaylistItem: fileHandle path', {
    id: item.id,
    name: item.name
  });

  const permission = await queryHandlePermission(item.fileHandle);

  if (permission === 'granted') {
    logDebug('library', 'materializePlaylistItem: permission granted', { id: item.id });
  }

  if (permission !== 'granted' && (!prompt || (await requestHandlePermission(item.fileHandle)) !== 'granted')) {
    logWarning('library', 'materializePlaylistItem: file handle permission unavailable', {
      id: item.id,
      reason: `permission '${permission}', prompt=${prompt}, request did not grant read access`
    });
    return null;
  }

  const file = await item.fileHandle.getFile();
  const extension = inferExtension(file.name);
  const kind = inferKind(extension);

  if (!kind) {
    logWarning('library', 'materializePlaylistItem: unrecognized file kind', {
      id: item.id,
      reason: `extension '${extension}'`
    });
    return null;
  }

  const objectUrl = createObjectUrl({ kind }, file);

  if (objectUrl) {
    logDebug('library', 'materializePlaylistItem: object URL created', {
      id: item.id,
      name: file.name
    });
  }

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
