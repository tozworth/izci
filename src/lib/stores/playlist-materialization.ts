import type { PlaylistItem } from '$lib/types';
import { inferExtension, inferKind } from '$lib/utils/files';

type FileSystemPermissionState = 'granted' | 'denied' | 'prompt';

function createObjectUrl(item: Pick<PlaylistItem, 'kind'>, file: File): string | undefined {
  return item.kind === 'stream' ? URL.createObjectURL(file) : undefined;
}

export function revokeObjectUrl(item: Pick<PlaylistItem, 'objectUrl'>): void {
  if (item.objectUrl) {
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
  if (item.file && (item.kind !== 'stream' || item.objectUrl)) {
    return item;
  }

  if (!item.fileHandle) {
    return null;
  }

  const permission = await queryHandlePermission(item.fileHandle);

  if (permission !== 'granted' && (!prompt || (await requestHandlePermission(item.fileHandle)) !== 'granted')) {
    return null;
  }

  const file = await item.fileHandle.getFile();
  const extension = inferExtension(file.name);
  const kind = inferKind(extension);

  if (!kind) {
    return null;
  }

  return {
    ...item,
    file,
    name: file.name,
    extension,
    kind,
    size: file.size,
    lastModified: file.lastModified,
    objectUrl: createObjectUrl({ kind }, file)
  };
}
