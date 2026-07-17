import type { PlaylistItem } from '$lib/types';
import {
  filesystemFolders,
  queryFilesystemFolderPermission
} from '$lib/services/filesystem-folders';
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

function managedPathParts(item: PlaylistItem, rootName: string): string[] | null {
  const parts = item.path
    ?.replace(/\\/g, '/')
    .split('/')
    .filter((part) => part.length > 0);

  if (!parts?.length || parts.some((part) => part === '.' || part === '..')) return null;
  if (parts[0].localeCompare(rootName, undefined, { sensitivity: 'base' }) === 0) parts.shift();
  return parts.length > 0 ? parts : null;
}

async function resolveManagedFileHandle(
  item: PlaylistItem,
  prompt: boolean
): Promise<FileSystemFileHandle | null> {
  if (!item.sourceFolderId || !item.path) return null;

  await filesystemFolders.ready();
  let folder = filesystemFolders.getSnapshot().find((entry) => entry.id === item.sourceFolderId);

  if (!folder) {
    await filesystemFolders.refresh();
    folder = filesystemFolders.getSnapshot().find((entry) => entry.id === item.sourceFolderId);
  }

  if (!folder) return null;

  let permission = await queryFilesystemFolderPermission(folder.handle, false);
  if (permission !== 'granted' && prompt) {
    permission = await filesystemFolders.requestPermission(folder.id);
  }
  if (permission !== 'granted') return null;

  const parts = managedPathParts(item, folder.handle.name);
  if (!parts) return null;

  try {
    let directory = folder.handle;
    for (const part of parts.slice(0, -1)) {
      directory = await directory.getDirectoryHandle(part);
    }
    return await directory.getFileHandle(parts.at(-1)!);
  } catch {
    return null;
  }
}

export async function materializePlaylistItem(item: PlaylistItem, prompt = false): Promise<PlaylistItem | null> {
  if (item.file && (item.kind !== 'stream' || item.objectUrl)) {
    return item;
  }

  const fileHandle = item.fileHandle ?? (await resolveManagedFileHandle(item, prompt));

  if (!fileHandle) return null;

  const permission = item.fileHandle ? await queryHandlePermission(fileHandle) : 'granted';

  if (permission !== 'granted' && (!prompt || (await requestHandlePermission(fileHandle)) !== 'granted')) {
    return null;
  }

  const file = await fileHandle.getFile();
  const extension = inferExtension(file.name);
  const kind = inferKind(extension);

  if (!kind) {
    return null;
  }

  return {
    ...item,
    file,
    fileHandle,
    name: file.name,
    extension,
    kind,
    size: file.size,
    lastModified: file.lastModified,
    objectUrl: createObjectUrl({ kind }, file)
  };
}
