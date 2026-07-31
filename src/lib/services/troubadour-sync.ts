import type { FilesystemFolder, FilesystemFolderPermission } from '$lib/services/filesystem-folders';
import type { PlaylistItem, TrackKind, TrackMetadata } from '$lib/types';
import { getTrackIdentity } from '$lib/utils/files';

export const REQUEST_TROUBADOUR_BATCH_CONTEXT_MESSAGE = 'izci:troubadour:request-batch-context';
export const OPEN_TROUBADOUR_BATCH_CONTEXT_MESSAGE = 'izci:troubadour:open-batch-context';
export const TROUBADOUR_BATCH_CONTEXT_MESSAGE = 'izci:troubadour:batch-context';
export const TROUBADOUR_BATCH_RESULT_MESSAGE = 'izci:troubadour:batch-result';

export type TroubadourCollection = 'current' | 'playlist' | 'library' | 'favorites';

export interface TroubadourTrackReference {
  collection: TroubadourCollection;
  id: string;
}

export interface TroubadourBatchTrack {
  contextId: string;
  references: TroubadourTrackReference[];
  file?: File;
  fileHandle?: FileSystemFileHandle;
  path?: string;
  sourceFolderId?: string;
  name: string;
  extension: string;
  kind: TrackKind;
  size: number;
  lastModified: number;
  metadata?: TrackMetadata;
}

export interface TroubadourRememberedFolder {
  id: string;
  name: string;
  handle: FileSystemDirectoryHandle;
  permission: FilesystemFolderPermission;
  libraryMode: FilesystemFolder['libraryMode'];
}

export interface TroubadourBatchContext {
  tracks: TroubadourBatchTrack[];
  rememberedFolders: TroubadourRememberedFolder[];
}

export interface TroubadourBatchContextSource {
  collection: TroubadourCollection;
  items: PlaylistItem[];
}

export interface TroubadourBatchItemResult {
  success: boolean;
  references?: TroubadourTrackReference[];
  contextId?: string;
  originalPath?: string;
  originalName?: string;
  originalSize?: number;
  originalLastModified?: number;
  originalFileHandle?: FileSystemFileHandle;
  metadata?: TrackMetadata;
  file?: File;
  fileHandle?: FileSystemFileHandle;
  path?: string;
  sourceFolderId?: string;
  name?: string;
  extension?: string;
  kind?: TrackKind;
  size?: number;
  lastModified?: number;
  artworkChanged?: boolean;
}

export interface TroubadourBatchResult {
  results: TroubadourBatchItemResult[];
}

function isTrackKind(value: unknown): value is TrackKind {
  return value === 'stream' || value === 'module' || value === 'video';
}

function isFileHandle(value: unknown): value is FileSystemFileHandle {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<FileSystemFileHandle>;
  return source.kind === 'file' && typeof source.getFile === 'function';
}

function isReference(value: unknown): value is TroubadourTrackReference {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<TroubadourTrackReference>;
  return (
    (source.collection === 'current'
      || source.collection === 'playlist'
      || source.collection === 'library'
      || source.collection === 'favorites')
    && typeof source.id === 'string'
  );
}

function normalizeResultItem(value: unknown): TroubadourBatchItemResult | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Partial<TroubadourBatchItemResult>;

  if (source.success !== true && source.success !== false) return null;

  return {
    success: source.success,
    references: Array.isArray(source.references) ? source.references.filter(isReference) : undefined,
    contextId: typeof source.contextId === 'string' ? source.contextId : undefined,
    originalPath: typeof source.originalPath === 'string' ? source.originalPath : undefined,
    originalName: typeof source.originalName === 'string' ? source.originalName : undefined,
    originalSize: typeof source.originalSize === 'number' && Number.isFinite(source.originalSize)
      ? source.originalSize
      : undefined,
    originalLastModified:
      typeof source.originalLastModified === 'number' && Number.isFinite(source.originalLastModified)
        ? source.originalLastModified
        : undefined,
    originalFileHandle: isFileHandle(source.originalFileHandle) ? source.originalFileHandle : undefined,
    metadata: source.metadata && typeof source.metadata === 'object' ? source.metadata : undefined,
    file: source.file instanceof File ? source.file : undefined,
    fileHandle: isFileHandle(source.fileHandle) ? source.fileHandle : undefined,
    path: typeof source.path === 'string' ? source.path : undefined,
    sourceFolderId: typeof source.sourceFolderId === 'string' ? source.sourceFolderId : undefined,
    name: typeof source.name === 'string' ? source.name : undefined,
    extension: typeof source.extension === 'string' ? source.extension : undefined,
    kind: isTrackKind(source.kind) ? source.kind : undefined,
    size: typeof source.size === 'number' && Number.isFinite(source.size) ? source.size : undefined,
    lastModified:
      typeof source.lastModified === 'number' && Number.isFinite(source.lastModified)
        ? source.lastModified
        : undefined,
    artworkChanged: source.artworkChanged === true
  };
}

function withoutHandles(context: TroubadourBatchContext): TroubadourBatchContext {
  return {
    tracks: context.tracks.map(({ fileHandle: _fileHandle, ...track }) => track),
    rememberedFolders: []
  };
}

function postContext(target: Window, context: TroubadourBatchContext, targetOrigin: string): void {
  try {
    target.postMessage({ type: TROUBADOUR_BATCH_CONTEXT_MESSAGE, context }, targetOrigin);
  } catch {
    // A partial File System Access implementation may reject structured-cloned
    // handles. Files still make the one-shot handoff useful in that environment.
    target.postMessage(
      { type: TROUBADOUR_BATCH_CONTEXT_MESSAGE, context: withoutHandles(context) },
      targetOrigin
    );
  }
}

export function buildTroubadourBatchContext(
  sources: TroubadourBatchContextSource[],
  folders: FilesystemFolder[]
): TroubadourBatchContext {
  const tracksByIdentity = new Map<string, TroubadourBatchTrack>();

  for (const source of sources) {
    for (const item of source.items) {
      const identity = getTrackIdentity(item);
      const existing = tracksByIdentity.get(identity);
      const reference: TroubadourTrackReference = { collection: source.collection, id: item.id };

      if (existing) {
        if (!existing.references.some((candidate) => (
          candidate.collection === reference.collection && candidate.id === reference.id
        ))) {
          existing.references.push(reference);
        }
        existing.file ??= item.file;
        existing.fileHandle ??= item.fileHandle;
        existing.path ??= item.path;
        existing.sourceFolderId ??= item.sourceFolderId;
        continue;
      }

      tracksByIdentity.set(identity, {
        contextId: crypto.randomUUID(),
        references: [reference],
        file: item.file,
        fileHandle: item.fileHandle,
        path: item.path,
        sourceFolderId: item.sourceFolderId,
        name: item.name,
        extension: item.extension,
        kind: item.kind,
        size: item.size,
        lastModified: item.lastModified,
        metadata: item.metadata
      });
    }
  }

  return {
    tracks: [...tracksByIdentity.values()],
    rememberedFolders: folders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      handle: folder.handle,
      permission: folder.permission,
      libraryMode: folder.libraryMode
    }))
  };
}

export function respondToTroubadourBatchContextRequest(
  event: MessageEvent,
  expectedSource: Window | null,
  context: TroubadourBatchContext
): boolean {
  if (
    expectedSource === null
    || event.origin !== window.location.origin
    || event.source !== expectedSource
    || event.data?.type !== REQUEST_TROUBADOUR_BATCH_CONTEXT_MESSAGE
  ) {
    return false;
  }

  postContext(expectedSource, context, event.origin);
  return true;
}

export function readTroubadourBatchResult(
  event: MessageEvent,
  expectedSource: Window | null
): TroubadourBatchResult | null {
  if (
    expectedSource === null
    || event.origin !== window.location.origin
    || event.source !== expectedSource
    || event.data?.type !== TROUBADOUR_BATCH_RESULT_MESSAGE
    || !Array.isArray(event.data.result?.results)
  ) {
    return null;
  }

  return {
    results: event.data.result.results
      .map(normalizeResultItem)
      .filter((item: TroubadourBatchItemResult | null): item is TroubadourBatchItemResult => item !== null)
  };
}

export function listenForTroubadourBatchContext(
  onContext: (context: TroubadourBatchContext) => void
): () => void {
  const handleMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== window.opener) return;

    if (event.data?.type === OPEN_TROUBADOUR_BATCH_CONTEXT_MESSAGE) {
      requestTroubadourBatchContext();
      return;
    }

    if (event.data?.type !== TROUBADOUR_BATCH_CONTEXT_MESSAGE) return;
    const context = event.data.context as Partial<TroubadourBatchContext> | undefined;

    if (!context || !Array.isArray(context.tracks) || !Array.isArray(context.rememberedFolders)) {
      return;
    }

    onContext(context as TroubadourBatchContext);
  };

  window.addEventListener('message', handleMessage);
  requestTroubadourBatchContext();

  return () => window.removeEventListener('message', handleMessage);
}

export function requestTroubadourBatchContext(): boolean {
  if (!window.opener || window.opener.closed) return false;
  window.opener.postMessage(
    { type: REQUEST_TROUBADOUR_BATCH_CONTEXT_MESSAGE },
    window.location.origin
  );
  return true;
}

export function publishTroubadourBatchResult(result: TroubadourBatchResult): boolean {
  if (!window.opener || window.opener.closed) return false;
  window.opener.postMessage({ type: TROUBADOUR_BATCH_RESULT_MESSAGE, result }, window.location.origin);
  return true;
}
